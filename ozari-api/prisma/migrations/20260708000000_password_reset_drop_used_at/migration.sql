-- Drop the unused `used_at` column: reset tokens are hard-deleted on use (fail-secure, no garbage),
-- so a "used" tombstone was never written. Keeps the schema free of non-useful data.
-- AlterTable
ALTER TABLE "password_reset_tokens" DROP COLUMN "used_at";
