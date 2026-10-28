-- CreateEnum
CREATE TYPE "DepositEventKind" AS ENUM ('RECORDED', 'CORRECTED', 'UNDONE');

-- CreateTable
CREATE TABLE "service_deposit_history" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "kind" "DepositEventKind" NOT NULL,
    "deposit_total" DECIMAL(15,2),
    "claims_total" DECIMAL(15,2),
    "refund_amount" DECIMAL(15,2),
    "balance_due" DECIMAL(15,2),
    "by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_deposit_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_deposit_history_service_id_idx" ON "service_deposit_history"("service_id");

-- AddForeignKey
ALTER TABLE "service_deposit_history" ADD CONSTRAINT "service_deposit_history_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_deposit_history" ADD CONSTRAINT "service_deposit_history_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
