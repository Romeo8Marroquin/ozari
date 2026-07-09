-- Epic 1 (Inventory) Step 0 — refine the Product shape everything downstream depends on:
--   * retire the single `products.image_url` in favour of a `product_images` gallery relation
--     (multiple images per product, ordered by `sort_order`, one flagged `is_primary`);
--   * add `products.replacement_price` (what a lost/damaged rental is billed "as new"; always
--     captured even though billing consumes it later);
--   * add `products.rent_time_unit_id` -> the new seeded `rent_time_units` lookup
--     (Hora/Día/Semana/Mes/Evento) — the period an Alquiler product's `rent_price` is quoted
--     against. Nullable: a Venta product has no rent period (mirrors `rent_price`/`sell_price`).

-- AlterTable
ALTER TABLE "products" DROP COLUMN "image_url",
ADD COLUMN     "rent_time_unit_id" INTEGER,
ADD COLUMN     "replacement_price" DECIMAL(15,2);

-- CreateTable
CREATE TABLE "rent_time_units" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_time_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "r2_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_images_product_id_is_active_idx" ON "product_images"("product_id", "is_active");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_rent_time_unit_id_fkey" FOREIGN KEY ("rent_time_unit_id") REFERENCES "rent_time_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
