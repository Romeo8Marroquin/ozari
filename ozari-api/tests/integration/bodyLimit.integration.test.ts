import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "@/app.js";
import { appConfig } from "@/config/app.js";
import type { Express } from "express";

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn().mockResolvedValue({}),
  disconnectPrisma: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  },
}));

vi.mock("@/config/i18n.js", () => ({
  i18next: {
    t: vi.fn((key: string) => key),
    init: vi.fn().mockResolvedValue(undefined),
    use: vi.fn().mockReturnThis(),
  },
  i18nmiddleware: {
    handle: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
  },
}));

vi.mock("@/config/context.js", () => ({
  asyncLocalStorage: {
    run: vi.fn((store: unknown, callback: () => void) => callback()),
    getStore: vi.fn().mockReturnValue({}),
  },
}));

/** A JSON body of roughly `kb` kilobytes. */
const bodyOf = (kb: number) => ({ padding: "x".repeat(kb * 1024) });

/** The parser limits in BYTES (`express.json`'s "kb" is 1024 bytes). */
const kb = (limit: string): number => Number.parseInt(limit, 10) * 1024;
const GLOBAL_LIMIT = kb("10kb");
const PRODUCT_WRITE_LIMIT = kb(appConfig.productWriteBodyLimit);

const byteLength = (body: unknown): number => Buffer.byteLength(JSON.stringify(body), "utf8");

/** Largest id an `Int` column hands back — every id in the fixture is at full width. */
const MAX_ID = 2_147_483_647;
/** The longest money a body can carry (`maxGlobalAmount` with cents is no longer than this). */
const MAX_MONEY = 999_999.99;
/** A minted key at full width (`<prefix>/<uuid>.<ext>`) — the longest photo reference. */
const imageKey = (index: number): string =>
  `${appConfig.storage.keyPrefixes.product}/${String(index).padStart(8, "0")}-aaaa-bbbb-cccc-${String(index).padStart(12, "0")}.avif`;

/**
 * The WORST-CASE product update body — every collection at its cap and every text at its maximum
 * length, written with `char` (`"é"` = a 2-byte UTF-8 letter both text regexes accept, the heaviest
 * character a person can type into these fields). It is the PUT shape (ids everywhere), which is the
 * longer of the two doors: 3 options × 20 values (40-character names), the photo TOTAL as new key
 * references (showcase full, the rest filling value sets), the variant cap with every Alquiler
 * override and a 500-character description each, 5 details (one per seeded type) at 255 characters,
 * and a 255-character name + 500-character description on the product itself.
 */
function worstCaseProductBody(char: string) {
  const { maxImagesPerProduct, maxImagesPerOptionValue, maxImagesTotalPerProduct } =
    appConfig.storage;
  let photo = 0;
  const nextPhoto = () => ({ key: imageKey((photo += 1)), isPrimary: false });
  const images = Array.from({ length: maxImagesPerProduct }, nextPhoto);
  const options = Array.from({ length: appConfig.maxProductOptions }, (_, optionIndex) => ({
    id: MAX_ID - optionIndex,
    name: char.repeat(40),
    values: Array.from({ length: appConfig.maxOptionValues }, (_, valueIndex) => ({
      id: MAX_ID - 100 - optionIndex * 100 - valueIndex,
      key: `v${MAX_ID - 100 - optionIndex * 100 - valueIndex}`,
      name: char.repeat(40),
      images: [] as Array<{ key: string; isPrimary: boolean }>,
    })),
  }));
  for (const value of options.flatMap((option) => option.values)) {
    while (value.images.length < maxImagesPerOptionValue && photo < maxImagesTotalPerProduct) {
      value.images.push(nextPhoto());
    }
  }
  const variants = Array.from({ length: appConfig.maxProductVariants }, (_, index) => ({
    id: MAX_ID - 1000 - index,
    valueKeys: options.map(
      (option, optionIndex) => option.values[(index + optionIndex) % option.values.length].key,
    ),
    quantity: appConfig.maxGlobalQuantity,
    rentPrice: MAX_MONEY,
    replacementPrice: MAX_MONEY,
    securityDeposit: MAX_MONEY,
    description: char.repeat(500),
    ...(index === 0 && { isDefault: true }),
  }));
  return {
    body: {
      name: char.repeat(255),
      description: char.repeat(500),
      businessTypeId: 1,
      categoryId: 1,
      currencyId: 1,
      rentPrice: MAX_MONEY,
      rentTimeUnitId: 1,
      replacementPrice: MAX_MONEY,
      securityDeposit: MAX_MONEY,
      productDetails: Array.from({ length: 5 }, (_, index) => ({
        id: MAX_ID - 5000 - index,
        detailTypeId: index + 1,
        detail: char.repeat(255),
      })),
      images,
      options,
      variants,
    },
    photoCount: photo,
  };
}

/** The worst-case presign body: the per-call cap, every file at the 7-digit 5 MB ceiling. */
const worstCaseUploadBody = () => ({
  files: Array.from({ length: appConfig.storage.maxImagesTotalPerProduct }, () => ({
    contentType: "image/jpeg",
    contentLength: appConfig.storage.maxUploadBytes,
  })),
});

/**
 * The body-size policy (AUTH-AND-SECURITY.md §1 item 4): 10kb everywhere, except the product
 * full-state create/update (POST /products, PUT /products/:id) at `productWriteBodyLimit`. A body
 * the parser accepts reaches the API-key gate (401 without a key); one it refuses never does (413).
 *
 * The two worst-case fixtures are what the limits were SIZED from (2026-10-30, when the photo caps
 * rose to 10 showcase / 6 per value / 150 total): the product body measured 60.6 kB in ASCII and
 * 95.2 kB fully accented — so the old 32kb was raised to 100kb; the 150-file presign body is 7.96 kB,
 * inside the global 10kb, so that route keeps it.
 */
describe("JSON body limits", () => {
  let app: Express;

  beforeAll(() => {
    process.env["API_KEY"] = "test-api-key-integration";
    process.env["APP_HOST"] = "http://localhost:5173";
    app = createApp();
  });

  it("parses a 20kb product create (reaches the API-key gate)", async () => {
    const response = await request(app).post("/api/products").send(bodyOf(20));
    expect(response.status).toBe(401);
  });

  it("parses a 20kb product update (reaches the API-key gate)", async () => {
    const response = await request(app).put("/api/products/12").send(bodyOf(20));
    expect(response.status).toBe(401);
  });

  it("parses the WORST-CASE product body, even fully accented", async () => {
    const ascii = worstCaseProductBody("x");
    const accented = worstCaseProductBody("é");
    expect(ascii.photoCount).toBe(appConfig.storage.maxImagesTotalPerProduct);
    expect(byteLength(ascii.body)).toBeGreaterThan(GLOBAL_LIMIT * 3);
    expect(byteLength(accented.body)).toBeLessThan(PRODUCT_WRITE_LIMIT);
    const create = await request(app).post("/api/products").send(accented.body);
    expect(create.status).toBe(401);
    const update = await request(app).put(`/api/products/${MAX_ID}`).send(accented.body);
    expect(update.status).toBe(401);
  });

  it("refuses a product write above its limit", async () => {
    const response = await request(app)
      .post("/api/products")
      .send(bodyOf(PRODUCT_WRITE_LIMIT / 1024 + 4));
    expect(response.status).toBe(413);
  });

  it("parses the WORST-CASE presign body under the global 10kb", async () => {
    const body = worstCaseUploadBody();
    expect(byteLength(body)).toBeLessThan(GLOBAL_LIMIT);
    const response = await request(app).post("/api/products/images/upload-url").send(body);
    expect(response.status).toBe(401);
  });

  it("keeps 10kb on every other route — even under /products", async () => {
    const orders = await request(app).post("/api/orders").send(bodyOf(20));
    expect(orders.status).toBe(413);
    const arrangement = await request(app).put("/api/products/display-order").send(bodyOf(20));
    expect(arrangement.status).toBe(413);
    const uploads = await request(app).post("/api/products/images/upload-url").send(bodyOf(20));
    expect(uploads.status).toBe(413);
  });
});
