-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "refresh_token_kms" TEXT NOT NULL,
    "access_token_kms" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "account_email_kms" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_feeds" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_sha" TEXT NOT NULL,
    "token_kms" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_user_id_provider_key" ON "calendar_connections"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_user_id_key" ON "calendar_feeds"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_token_sha_key" ON "calendar_feeds"("token_sha");

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
