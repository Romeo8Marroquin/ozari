-- The NO-TRASH policy (owner decision, 2026-07-15): product gallery/detail rows are HARD-deleted
-- by the update/delete flows, never tombstoned — their `is_active` columns are dead weight.
--
-- Purge FIRST: any row previously soft-deleted (is_active = false) must not resurrect when the
-- flag disappears. Purged image rows may leave stray R2 objects behind — those are swept by the
-- orphan-reconcile job (EPIC-1 §5), same as any interrupted upload.
DELETE FROM "product_images" WHERE "is_active" = false;
DELETE FROM "product_details" WHERE "is_active" = false;

-- DropIndex
DROP INDEX "product_images_product_id_is_active_idx";

-- AlterTable
ALTER TABLE "product_details" DROP COLUMN "is_active";

-- AlterTable
ALTER TABLE "product_images" DROP COLUMN "is_active";

-- CreateIndex
CREATE INDEX "product_images_product_id_idx" ON "product_images"("product_id");
