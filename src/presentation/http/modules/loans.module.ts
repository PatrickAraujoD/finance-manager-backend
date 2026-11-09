import { Module } from '@nestjs/common';
import { Clock } from '../../../application/ports/clock';
import { ExpenseRepository } from '../../../application/ports/expense-repository';
import { IdGenerator } from '../../../application/ports/id-generator';
import { ReceiptRepository } from '../../../application/ports/receipt-repository';
import { LoanPaymentRepository } from '../../../application/ports/loan-payment-repository';
import { LoanRepository } from '../../../application/ports/loan-repository';
import { CreateLoan } from '../../../application/use-cases/loans/create-loan';
import { DeleteLoan } from '../../../application/use-cases/loans/delete-loan';
import { GetLoan } from '../../../application/use-cases/loans/get-loan';
import { ListLoans } from '../../../application/use-cases/loans/list-loans';
import { ListLoanPayments } from '../../../application/use-cases/loans/list-loan-payments';
import { RegisterLoanPayment } from '../../../application/use-cases/loans/register-loan-payment';
import { UpdateLoan } from '../../../application/use-cases/loans/update-loan';
import { LoansController } from '../controllers/loans.controller';
import {
  CLOCK,
  EXPENSE_REPOSITORY,
  ID_GENERATOR,
  LOAN_PAYMENT_REPOSITORY,
  LOAN_REPOSITORY,
  RECEIPT_REPOSITORY,
} from '../tokens';

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
      inject: [LOAN_REPOSITORY, LOAN_PAYMENT_REPOSITORY, CLOCK],
      useFactory: (loans: LoanRepository, payments: LoanPaymentRepository, clock: Clock) =>
        new UpdateLoan(loans, payments, clock),
    },
    {
      provide: DeleteLoan,
      inject: [LOAN_REPOSITORY, LOAN_PAYMENT_REPOSITORY],
      useFactory: (loans: LoanRepository, payments: LoanPaymentRepository) =>
        new DeleteLoan(loans, payments),
    },
    {
      provide: GetLoan,
      inject: [LOAN_REPOSITORY, LOAN_PAYMENT_REPOSITORY, CLOCK],
      useFactory: (loans: LoanRepository, payments: LoanPaymentRepository, clock: Clock) =>
        new GetLoan(loans, payments, clock),
    },
    {
      provide: ListLoans,
      inject: [LOAN_REPOSITORY, LOAN_PAYMENT_REPOSITORY, CLOCK],
      useFactory: (loans: LoanRepository, payments: LoanPaymentRepository, clock: Clock) =>
        new ListLoans(loans, payments, clock),
    },
    {
      provide: RegisterLoanPayment,
      inject: [
        LOAN_REPOSITORY,
        LOAN_PAYMENT_REPOSITORY,
        RECEIPT_REPOSITORY,
        EXPENSE_REPOSITORY,
        ID_GENERATOR,
        CLOCK,
      ],
      useFactory: (
        loans: LoanRepository,
        payments: LoanPaymentRepository,
        receipts: ReceiptRepository,
        expenses: ExpenseRepository,
        ids: IdGenerator,
        clock: Clock,
      ) => new RegisterLoanPayment(loans, payments, receipts, expenses, ids, clock),
    },
    {
      provide: ListLoanPayments,
      inject: [LOAN_REPOSITORY, LOAN_PAYMENT_REPOSITORY],
      useFactory: (loans: LoanRepository, payments: LoanPaymentRepository) =>
        new ListLoanPayments(loans, payments),
    },
  ],
})
export class LoansModule {}
