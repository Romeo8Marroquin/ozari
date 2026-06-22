-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "code_sha" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_code_sha_key" ON "mfa_recovery_codes"("code_sha");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "blacklist_user_id_is_active_idx" ON "blacklist"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "jwt_sessions_jti_key" ON "jwt_sessions"("jti");

-- CreateIndex
CREATE INDEX "jwt_sessions_user_id_is_active_idx" ON "jwt_sessions"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "jwt_sessions_device_uuid_is_active_idx" ON "jwt_sessions"("device_uuid", "is_active");

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
