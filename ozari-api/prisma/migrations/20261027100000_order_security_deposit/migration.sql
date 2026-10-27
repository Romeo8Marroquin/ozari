-- AlterTable
ALTER TABLE "products" ADD COLUMN     "security_deposit" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "deposit_retained_amount" DECIMAL(15,2),
ADD COLUMN     "deposit_retained_reason" TEXT,
ADD COLUMN     "deposit_settled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "service_details" ADD COLUMN     "damage_note" TEXT,
ADD COLUMN     "damaged_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replacement_price" DECIMAL(15,2),
ADD COLUMN     "security_deposit" DECIMAL(15,2);
