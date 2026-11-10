-- Money lent directly now says how it left (PaymentMethod) and the day it left. Both columns are
-- NULL for a loan born from an expense: it inherits them from the expense, so nothing is counted
-- twice. Nullable first so the existing rows can be filled in.
ALTER TABLE "Loan" ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "Loan" ADD COLUMN "lentAt" DATE;

-- Direct loans that already exist have no real answer; PIX and the creation day are the least
-- surprising guess. There is no default afterwards: new rows must say it.
UPDATE "Loan"
SET "paymentMethod" = 'PIX', "lentAt" = "createdAt"::date
WHERE "expenseId" IS NULL;

-- A direct loan (no expense) always says how and when the money left; a loan born from an expense
-- never does (it inherits both from the expense). Guards the data against writers that bypass the
-- domain.
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_lending_fields_check" CHECK (
  ("expenseId" IS NULL AND "paymentMethod" IS NOT NULL AND "lentAt" IS NOT NULL)
  OR ("expenseId" IS NOT NULL AND "paymentMethod" IS NULL AND "lentAt" IS NULL)
);
