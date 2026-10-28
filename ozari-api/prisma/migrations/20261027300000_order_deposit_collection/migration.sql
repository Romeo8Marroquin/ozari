-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DepositEventKind" ADD VALUE 'RECEIVED';
ALTER TYPE "DepositEventKind" ADD VALUE 'WAIVED';
ALTER TYPE "DepositEventKind" ADD VALUE 'COLLECTION_CLEARED';

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "deposit_received_at" TIMESTAMP(3),
ADD COLUMN     "deposit_waived_at" TIMESTAMP(3),
ADD COLUMN     "deposit_waived_reason" TEXT;

-- AlterTable
ALTER TABLE "service_deposit_history" ADD COLUMN     "note" TEXT;
