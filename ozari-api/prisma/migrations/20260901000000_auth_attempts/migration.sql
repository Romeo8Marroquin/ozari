-- CreateTable
CREATE TABLE "auth_attempts" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "first_attempt_at" TIMESTAMP(3) NOT NULL,
    "reset_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_attempts_reset_at_idx" ON "auth_attempts"("reset_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_attempts_scope_subject_key" ON "auth_attempts"("scope", "subject");
