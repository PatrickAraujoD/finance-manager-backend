import { Module } from '@nestjs/common';
import { IncomeRepository } from '../../../application/ports/income-repository';
import { ReportRepository } from '../../../application/ports/report-repository';
import { ByCategory } from '../../../application/use-cases/reports/by-category';
import { ByDay } from '../../../application/use-cases/reports/by-day';
import { IncomeVsSpent } from '../../../application/use-cases/reports/income-vs-spent';
import { MonthlyEvolution } from '../../../application/use-cases/reports/monthly-evolution';
import { ReportsController } from '../controllers/reports.controller';
import { INCOME_REPOSITORY, REPORT_REPOSITORY } from '../tokens';

@Module({
  controllers: [ReportsController],
  providers: [
    {
      provide: ByCategory,
      inject: [REPORT_REPOSITORY],
      useFactory: (reports: ReportRepository) => new ByCategory(reports),
    },
    {
      provide: ByDay,
      inject: [REPORT_REPOSITORY],
      useFactory: (reports: ReportRepository) => new ByDay(reports),
    },
    {
      provide: MonthlyEvolution,
      inject: [REPORT_REPOSITORY],
      useFactory: (reports: ReportRepository) => new MonthlyEvolution(reports),
    },
    {
      provide: IncomeVsSpent,
      inject: [REPORT_REPOSITORY, INCOME_REPOSITORY],
      useFactory: (reports: ReportRepository, incomes: IncomeRepository) =>
        new IncomeVsSpent(reports, incomes),
    },
  ],
})
export class ReportsModule {}
