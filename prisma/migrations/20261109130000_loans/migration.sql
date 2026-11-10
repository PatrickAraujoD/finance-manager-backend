-- Money lent to someone. expenseId is UNIQUE: an expense turns into at most one loan. NULLs are
-- distinct in Postgres, so any number of loans without an expense is fine.
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "borrowerName" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "dueDate" DATE NOT NULL,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Loan_expenseId_key" ON "Loan"("expenseId");
CREATE INDEX "Loan_userId_dueDate_idx" ON "Loan"("userId", "dueDate");
CREATE INDEX "Loan_userId_borrowerName_idx" ON "Loan"("userId", "borrowerName");

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same rules as the domain (MAX_EXPENSE_CENTS): a positive amount, at most R$ 10,000,000.00.
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_amountCents_positive" CHECK ("amountCents" > 0);
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_amountCents_max" CHECK ("amountCents" <= 1000000000);
