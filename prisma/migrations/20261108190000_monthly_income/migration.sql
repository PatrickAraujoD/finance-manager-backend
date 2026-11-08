-- CreateTable
CREATE TABLE "MonthlyIncome" (
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyIncome_pkey" PRIMARY KEY ("userId","month")
);

-- AddForeignKey
ALTER TABLE "MonthlyIncome" ADD CONSTRAINT "MonthlyIncome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Strict YYYY-MM (month 01 to 12) and positive integer cents.
ALTER TABLE "MonthlyIncome" ADD CONSTRAINT "MonthlyIncome_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "MonthlyIncome" ADD CONSTRAINT "MonthlyIncome_amountCents_positive" CHECK ("amountCents" > 0);
