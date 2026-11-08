-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "suggestedAmountCents" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_storageKey_key" ON "Receipt"("storageKey");

-- CreateIndex
CREATE INDEX "Receipt_userId_idx" ON "Receipt"("userId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A suggestion is either absent or a positive amount of cents; sizes are positive.
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_suggestedAmountCents_positive" CHECK ("suggestedAmountCents" IS NULL OR "suggestedAmountCents" > 0);
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_sizeBytes_positive" CHECK ("sizeBytes" > 0);
