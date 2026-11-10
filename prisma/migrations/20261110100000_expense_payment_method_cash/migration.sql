-- Physical cash as a fourth way to pay an expense. This is the only statement of the migration:
-- Postgres does not let a value added to an enum be used in the same transaction.
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';
