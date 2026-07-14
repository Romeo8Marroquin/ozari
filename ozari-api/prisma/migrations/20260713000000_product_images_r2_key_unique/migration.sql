-- One R2 object belongs to exactly ONE image row: prevents two products from referencing (and a
-- future delete flow from double-deleting) the same object, even if an admin replays a used key.
-- Engine-generated via `prisma migrate diff --from-config-datasource --to-schema --script`.

-- CreateIndex
CREATE UNIQUE INDEX "product_images_r2_key_key" ON "product_images"("r2_key");
