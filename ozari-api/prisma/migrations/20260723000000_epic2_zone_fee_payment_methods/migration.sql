-- AlterTable
ALTER TABLE "client_registries" ADD COLUMN     "preferred_payment_method_id" INTEGER;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "payment_method_id" INTEGER;

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "delivery_fee" DECIMAL(15,2);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "client_registries" ADD CONSTRAINT "client_registries_preferred_payment_method_id_fkey" FOREIGN KEY ("preferred_payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
