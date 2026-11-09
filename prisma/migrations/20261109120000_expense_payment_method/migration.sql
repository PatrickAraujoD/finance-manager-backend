-- How an expense was paid. Existing rows are backfilled with PIX through the temporary default,
-- which is dropped right after so new rows must always state the method explicitly.
CREATE TYPE "PaymentMethod" AS ENUM ('CREDIT', 'DEBIT', 'PIX');

ALTER TABLE "Expense" ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'PIX';
ALTER TABLE "Expense" ALTER COLUMN "paymentMethod" DROP DEFAULT;
