import { Module } from '@nestjs/common';
import { IncomeRepository } from '../../../application/ports/income-repository';
import { GetMonthlyIncome } from '../../../application/use-cases/income/get-monthly-income';
import { SetMonthlyIncome } from '../../../application/use-cases/income/set-monthly-income';
import { IncomeController } from '../controllers/income.controller';
import { INCOME_REPOSITORY } from '../tokens';

@Module({
  controllers: [IncomeController],
  providers: [
    {
      provide: SetMonthlyIncome,
      inject: [INCOME_REPOSITORY],
      useFactory: (incomes: IncomeRepository) => new SetMonthlyIncome(incomes),
    },
    {
      provide: GetMonthlyIncome,
      inject: [INCOME_REPOSITORY],
      useFactory: (incomes: IncomeRepository) => new GetMonthlyIncome(incomes),
    },
  ],
})
export class IncomeModule {}
