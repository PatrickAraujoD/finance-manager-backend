-- Marks an expense that pays the credit card bill. The default is meaningful (an ordinary
-- expense), so it stays. "Not paid with CREDIT" is a domain rule, not a database CHECK.
ALTER TABLE "Expense" ADD COLUMN "isCardPayment" BOOLEAN NOT NULL DEFAULT false;
