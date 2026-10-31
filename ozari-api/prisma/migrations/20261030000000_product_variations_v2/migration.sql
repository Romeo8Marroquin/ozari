-- CreateEnum
CREATE TYPE "ProductOptionKind" AS ENUM ('GENERIC', 'COLOR');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "shared_stock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product_options" ADD COLUMN     "kind" "ProductOptionKind" NOT NULL DEFAULT 'GENERIC';

-- AlterTable
ALTER TABLE "product_option_values" ADD COLUMN     "color_hex" TEXT;
