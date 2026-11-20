-- AlterTable
ALTER TABLE "services" ADD COLUMN     "billed_days" INTEGER;

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" INTEGER NOT NULL,
    "order_billed_days" INTEGER,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
