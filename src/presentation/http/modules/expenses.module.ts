import { Module } from '@nestjs/common';
import { CategoryRepository } from '../../../application/ports/category-repository';
import { Clock } from '../../../application/ports/clock';
import { ExpenseRepository } from '../../../application/ports/expense-repository';
import { IdGenerator } from '../../../application/ports/id-generator';
import { LoanPaymentRepository } from '../../../application/ports/loan-payment-repository';
import { ReceiptRepository } from '../../../application/ports/receipt-repository';
import { CreateExpense } from '../../../application/use-cases/expenses/create-expense';
import { DeleteExpense } from '../../../application/use-cases/expenses/delete-expense';
import { GetExpense } from '../../../application/use-cases/expenses/get-expense';
import { ListExpenses } from '../../../application/use-cases/expenses/list-expenses';
import { UpdateExpense } from '../../../application/use-cases/expenses/update-expense';
import { ExpensesController } from '../controllers/expenses.controller';
import {
  CATEGORY_REPOSITORY,
  CLOCK,
  EXPENSE_REPOSITORY,
  ID_GENERATOR,
  LOAN_PAYMENT_REPOSITORY,
  RECEIPT_REPOSITORY,
} from '../tokens';

@Module({
  controllers: [ExpensesController],
  providers: [
    {
      provide: CreateExpense,
      inject: [
        EXPENSE_REPOSITORY,
        CATEGORY_REPOSITORY,
        RECEIPT_REPOSITORY,
        ID_GENERATOR,
        CLOCK,
        LOAN_PAYMENT_REPOSITORY,
      ],
      useFactory: (
        expenses: ExpenseRepository,
        categories: CategoryRepository,
        receipts: ReceiptRepository,
        ids: IdGenerator,
        clock: Clock,
        loanPayments: LoanPaymentRepository,
      ) => new CreateExpense(expenses, categories, receipts, ids, clock, loanPayments),
    },
    {
      provide: UpdateExpense,
      inject: [EXPENSE_REPOSITORY, CATEGORY_REPOSITORY, CLOCK],
      useFactory: (expenses: ExpenseRepository, categories: CategoryRepository, clock: Clock) =>
        new UpdateExpense(expenses, categories, clock),
    },
    {
      provide: DeleteExpense,
      inject: [EXPENSE_REPOSITORY],
      useFactory: (expenses: ExpenseRepository) => new DeleteExpense(expenses),
    },
    {
      provide: GetExpense,
      inject: [EXPENSE_REPOSITORY],
      useFactory: (expenses: ExpenseRepository) => new GetExpense(expenses),
    },
    {
      provide: ListExpenses,
      inject: [EXPENSE_REPOSITORY],
      useFactory: (expenses: ExpenseRepository) => new ListExpenses(expenses),
    },
  ],
})
export class ExpensesModule {}
