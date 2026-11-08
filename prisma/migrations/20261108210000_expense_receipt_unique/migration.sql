-- One receipt backs at most one expense. Postgres treats NULLs as distinct in a unique index, so
-- manual expenses (receiptId NULL) are unaffected: no partial predicate is needed.
-- No code path wrote Expense.receiptId before this release, so existing data cannot collide.
CREATE UNIQUE INDEX "Expense_receiptId_key" ON "Expense"("receiptId");
