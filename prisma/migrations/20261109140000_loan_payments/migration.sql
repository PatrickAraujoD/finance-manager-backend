-- How a loan payment was made: CASH is physical money typed by hand, PIX needs a receipt.
CREATE TYPE "LoanPaymentMethod" AS ENUM ('CASH', 'PIX');

-- A payment toward one specific loan. receiptId is UNIQUE: one receipt backs at most one payment.
-- NULLs are distinct in Postgres, so any number of cash payments is fine.
CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "method" "LoanPaymentMethod" NOT NULL,
    "receiptId" TEXT,
    "paidAt" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoanPayment_receiptId_key" ON "LoanPayment"("receiptId");
CREATE INDEX "LoanPayment_loanId_paidAt_idx" ON "LoanPayment"("loanId", "paidAt");
CREATE INDEX "LoanPayment_userId_idx" ON "LoanPayment"("userId");

ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same rules as the domain (MAX_EXPENSE_CENTS): a positive amount, at most R$ 10,000,000.00.
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_amountCents_positive" CHECK ("amountCents" > 0);
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_amountCents_max" CHECK ("amountCents" <= 1000000000);

-- Method and proof go together: PIX needs a receipt, CASH cannot have one.
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_method_receipt" CHECK (
    ("method" = 'PIX' AND "receiptId" IS NOT NULL) OR ("method" = 'CASH' AND "receiptId" IS NULL)
);
