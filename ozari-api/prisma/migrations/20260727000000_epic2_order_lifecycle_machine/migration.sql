-- AlterTable
ALTER TABLE "service_status" ADD COLUMN     "applies_to" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "color_key" TEXT,
ADD COLUMN     "inventory_hold" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "is_disruptive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_initial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "max_evidence" INTEGER,
ADD COLUMN     "min_evidence" INTEGER,
ADD COLUMN     "requires_evidence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sort_order" INTEGER,
ADD COLUMN     "tracks_event" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "service_status_sort_order_key" ON "service_status"("sort_order");
