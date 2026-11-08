-- Database-level ceilings that mirror the domain (MAX_EXPENSE_CENTS, MAX_INCOME_CENTS), so a
-- value written behind the domain's back can never make a report SUM overflow.
-- ADD CONSTRAINT validates existing rows: it fails (and nothing is applied) if any row is above
-- the ceiling, so no violating data is silently accepted.
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amountCents_max" CHECK ("amountCents" <= 1000000000);
ALTER TABLE "MonthlyIncome" ADD CONSTRAINT "MonthlyIncome_amountCents_max" CHECK ("amountCents" <= 100000000000);
