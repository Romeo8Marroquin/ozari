-- DropForeignKey
ALTER TABLE "services" DROP CONSTRAINT "services_address_id_fkey";

-- DropForeignKey
ALTER TABLE "services" DROP CONSTRAINT "services_user_id_fkey";

-- DropForeignKey
ALTER TABLE "services" DROP CONSTRAINT "services_user_phone_id_fkey";

-- AlterTable
ALTER TABLE "service_details" ADD COLUMN     "is_rental" BOOLEAN NOT NULL;

-- AlterTable
ALTER TABLE "services" DROP COLUMN "address_id",
DROP COLUMN "user_phone_id",
ADD COLUMN     "assigned_user_id" INTEGER,
ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "client_registry_id" INTEGER,
ADD COLUMN     "collected_at" TIMESTAMP(3),
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "delivery_address_kms" TEXT NOT NULL,
ADD COLUMN     "delivery_amount" DECIMAL(15,2),
ADD COLUMN     "delivery_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "delivery_contact_kms" TEXT NOT NULL,
ADD COLUMN     "deposit_amount" DECIMAL(15,2),
ADD COLUMN     "discount_amount" DECIMAL(15,2),
ADD COLUMN     "discount_reason" TEXT,
ADD COLUMN     "event_type_id" INTEGER NOT NULL,
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "pickup_at" TIMESTAMP(3),
ADD COLUMN     "ready_at" TIMESTAMP(3),
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "event_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "min_lead_hours" INTEGER NOT NULL DEFAULT 24,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_registries" (
    "id" SERIAL NOT NULL,
    "name_kms" TEXT NOT NULL,
    "notes_kms" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_registries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_registry_contacts" (
    "id" SERIAL NOT NULL,
    "client_registry_id" INTEGER NOT NULL,
    "contact_type_id" INTEGER NOT NULL,
    "value_kms" TEXT NOT NULL,
    "is_principal" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_registry_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_registry_addresses" (
    "id" SERIAL NOT NULL,
    "client_registry_id" INTEGER NOT NULL,
    "zone_id" INTEGER,
    "address_kms" TEXT NOT NULL,
    "coords_kms" TEXT,
    "instructions_kms" TEXT,
    "domicile_price" DECIMAL(15,2),
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_registry_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_status_history" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "from_status_id" INTEGER,
    "to_status_id" INTEGER NOT NULL,
    "by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_evidence" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "service_status_id" INTEGER NOT NULL,
    "r2_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_preferences" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "value_type" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_registry_contacts_client_registry_id_idx" ON "client_registry_contacts"("client_registry_id");

-- CreateIndex
CREATE INDEX "client_registry_addresses_client_registry_id_idx" ON "client_registry_addresses"("client_registry_id");

-- CreateIndex
CREATE INDEX "service_status_history_service_id_idx" ON "service_status_history"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_evidence_r2_key_key" ON "service_evidence"("r2_key");

-- CreateIndex
CREATE INDEX "service_evidence_service_id_idx" ON "service_evidence"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_preferences_key_key" ON "app_preferences"("key");

-- CreateIndex
CREATE INDEX "services_delivery_at_idx" ON "services"("delivery_at");

-- CreateIndex
CREATE INDEX "services_pickup_at_idx" ON "services"("pickup_at");

-- CreateIndex
CREATE INDEX "services_user_id_idx" ON "services"("user_id");

-- CreateIndex
CREATE INDEX "services_client_registry_id_idx" ON "services"("client_registry_id");

-- CreateIndex
CREATE INDEX "services_assigned_user_id_idx" ON "services"("assigned_user_id");

-- AddForeignKey
ALTER TABLE "client_registry_contacts" ADD CONSTRAINT "client_registry_contacts_client_registry_id_fkey" FOREIGN KEY ("client_registry_id") REFERENCES "client_registries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_registry_contacts" ADD CONSTRAINT "client_registry_contacts_contact_type_id_fkey" FOREIGN KEY ("contact_type_id") REFERENCES "contact_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_registry_addresses" ADD CONSTRAINT "client_registry_addresses_client_registry_id_fkey" FOREIGN KEY ("client_registry_id") REFERENCES "client_registries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_registry_addresses" ADD CONSTRAINT "client_registry_addresses_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_client_registry_id_fkey" FOREIGN KEY ("client_registry_id") REFERENCES "client_registries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_status_history" ADD CONSTRAINT "service_status_history_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_status_history" ADD CONSTRAINT "service_status_history_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "service_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_status_history" ADD CONSTRAINT "service_status_history_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "service_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_status_history" ADD CONSTRAINT "service_status_history_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_evidence" ADD CONSTRAINT "service_evidence_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_evidence" ADD CONSTRAINT "service_evidence_service_status_id_fkey" FOREIGN KEY ("service_status_id") REFERENCES "service_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
