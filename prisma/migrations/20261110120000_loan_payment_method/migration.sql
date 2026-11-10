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
