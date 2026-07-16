-- AlterTable
ALTER TABLE "jwt_sessions" ADD COLUMN     "previous_jti" TEXT,
ADD COLUMN     "rotated_at" TIMESTAMP(3);
