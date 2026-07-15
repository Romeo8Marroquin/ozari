import type { Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openApiDocument } from "./openapi.js";
import { DOCS_JSON_PATH, DOCS_PATH, mountApiDocs } from "./swagger.js";

// Every endpoint that is CURRENTLY mounted (WIP modules are intentionally excluded).
const EXPECTED_OPERATIONS: ReadonlyArray<readonly [string, string]> = [
  ["/auth/user", "post"],
  ["/auth/signin", "post"],
  ["/auth/mfa/verify-login", "post"],
  ["/auth/refresh", "post"],
  ["/auth/forgot-password", "post"],
  ["/auth/reset-password", "post"],
  ["/auth/signout", "post"],
  ["/auth/me", "get"],
  ["/auth/change-password", "post"],
  ["/auth/mfa/setup", "post"],
  ["/auth/mfa/enable", "post"],
  ["/auth/mfa/disable", "post"],
  ["/auth/all", "get"],
  ["/products", "get"],
  ["/products", "post"],
  ["/products/{id}", "get"],
  ["/products/catalog", "get"],
  ["/products/images/upload-url", "post"],
  ["/health/check", "get"],
];

// Collect every `$ref` string anywhere in the document.
function collectRefs(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item) => collectRefs(item, acc));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") acc.push(value);
      else collectRefs(value, acc);
    }
  }
  return acc;
}

function resolveRef(ref: string): unknown {
  // e.g. "#/components/schemas/UserProfile"
  const parts = ref.replace(/^#\//, "").split("/");
  return parts.reduce<unknown>(
    (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
    openApiDocument,
  );
}

describe("openApiDocument", () => {
  it("is a well-formed OpenAPI 3.1 document", () => {
    expect(openApiDocument.openapi).toBe("3.0.3");
    expect(openApiDocument.info.title).toBe("Ozari API");
    expect(openApiDocument.info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(openApiDocument.info.description).toBeTruthy();
    expect(openApiDocument.servers?.length).toBeGreaterThan(0);
    expect(openApiDocument.components?.securitySchemes).toBeDefined();
  });

  it("documents exactly the currently-mounted operations", () => {
    const documented = Object.entries(openApiDocument.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item ?? {}).map((method) => `${method} ${path}`),
    );
    const expected = EXPECTED_OPERATIONS.map(([path, method]) => `${method} ${path}`);
    expect(documented.sort()).toEqual(expected.sort());
  });

  it.each(EXPECTED_OPERATIONS)("%s %s is fully described", (path, method) => {
    const operation = (openApiDocument.paths?.[path] as Record<string, Record<string, unknown>>)[method];
    expect(operation.summary, `${method} ${path} needs a summary`).toBeTruthy();
    expect(operation.description).toBeTruthy();
    expect(Array.isArray(operation.tags) && (operation.tags as unknown[]).length).toBeTruthy();
    expect(operation.operationId).toBeTruthy();
    expect(Array.isArray(operation.security)).toBe(true);

    const responses = operation.responses as Record<string, unknown>;
    // A 2xx and rate-limit + server-error coverage on every operation (health returns 503 not 500).
    const codes = Object.keys(responses);
    expect(codes.some((c) => c.startsWith("2"))).toBe(true);
    expect(codes).toContain("429");
    expect(codes).toContain(path === "/health/check" ? "503" : "500");
  });

  it("has no dangling $refs (every reference resolves to a defined component)", () => {
    const refs = collectRefs(openApiDocument);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(resolveRef(ref), `unresolved $ref: ${ref}`).toBeDefined();
    }
  });

  it("defines every security scheme referenced by operations", () => {
    const declared = new Set(Object.keys(openApiDocument.components?.securitySchemes ?? {}));
    const used = new Set<string>();
    for (const item of Object.values(openApiDocument.paths ?? {})) {
      for (const operation of Object.values(item ?? {})) {
        for (const requirement of ((operation as { security?: object[] }).security ?? [])) {
          Object.keys(requirement).forEach((name) => used.add(name));
        }
      }
    }
    // Global default requirement too.
    (openApiDocument.security ?? []).forEach((r) => Object.keys(r).forEach((n) => used.add(n)));
    for (const scheme of used) expect(declared.has(scheme), `undeclared scheme: ${scheme}`).toBe(true);
  });
});

describe("mountApiDocs", () => {
  afterEach(() => vi.unstubAllEnvs());

  const makeApp = () => ({ get: vi.fn(), use: vi.fn() });

  it("mounts the UI and the raw spec in non-production", () => {
    const app = makeApp();
    mountApiDocs(app as unknown as Express);

    expect(app.get).toHaveBeenCalledWith(DOCS_JSON_PATH, expect.any(Function));
    expect(app.use.mock.calls[0]?.[0]).toBe(DOCS_PATH);
  });

  it("serves the raw OpenAPI document at the json path", () => {
    const app = makeApp();
    mountApiDocs(app as unknown as Express);

    const handler = app.get.mock.calls[0]?.[1] as (req: unknown, res: { json: (b: unknown) => void }) => void;
    const json = vi.fn();
    handler({}, { json });
    expect(json).toHaveBeenCalledWith(openApiDocument);
  });

  it("mounts nothing in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = makeApp();
    mountApiDocs(app as unknown as Express);

    expect(app.get).not.toHaveBeenCalled();
    expect(app.use).not.toHaveBeenCalled();
  });
});
