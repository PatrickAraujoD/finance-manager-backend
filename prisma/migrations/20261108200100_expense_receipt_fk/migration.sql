-- Expense.receiptId was a plain column until the Receipt table existed. No code path wrote it
-- yet (expenses arrive in a later task), so it must be empty; fail loudly if it is not instead
-- of silently dropping data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Expense" WHERE "receiptId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Expense.receiptId has values but no Receipt table existed before this migration';
  END IF;
END $$;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
