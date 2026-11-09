import { Module } from '@nestjs/common';
import { Clock } from '../../../application/ports/clock';
import { ExpenseRepository } from '../../../application/ports/expense-repository';
import { IdGenerator } from '../../../application/ports/id-generator';
import { LoanRepository } from '../../../application/ports/loan-repository';
import { CreateLoan } from '../../../application/use-cases/loans/create-loan';
import { DeleteLoan } from '../../../application/use-cases/loans/delete-loan';
import { GetLoan } from '../../../application/use-cases/loans/get-loan';
import { ListLoans } from '../../../application/use-cases/loans/list-loans';
import { UpdateLoan } from '../../../application/use-cases/loans/update-loan';
import { LoansController } from '../controllers/loans.controller';
import { CLOCK, EXPENSE_REPOSITORY, ID_GENERATOR, LOAN_REPOSITORY } from '../tokens';

@Module({
  controllers: [LoansController],
  providers: [
    {
      provide: CreateLoan,
      inject: [LOAN_REPOSITORY, EXPENSE_REPOSITORY, ID_GENERATOR],
      useFactory: (loans: LoanRepository, expenses: ExpenseRepository, ids: IdGenerator) =>
        new CreateLoan(loans, expenses, ids),
    },
    {
      provide: UpdateLoan,
      inject: [LOAN_REPOSITORY, CLOCK],
      useFactory: (loans: LoanRepository, clock: Clock) => new UpdateLoan(loans, clock),
    },
    {
      provide: DeleteLoan,
      inject: [LOAN_REPOSITORY],
      useFactory: (loans: LoanRepository) => new DeleteLoan(loans),
    },
    {
      provide: GetLoan,
      inject: [LOAN_REPOSITORY, CLOCK],
      useFactory: (loans: LoanRepository, clock: Clock) => new GetLoan(loans, clock),
    },
    {
      provide: ListLoans,
      inject: [LOAN_REPOSITORY, CLOCK],
      useFactory: (loans: LoanRepository, clock: Clock) => new ListLoans(loans, clock),
    },
  ],
})
export class LoansModule {}
