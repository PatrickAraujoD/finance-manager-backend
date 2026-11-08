import { Controller, Get, Query } from '@nestjs/common';
import { ByCategory } from '../../../application/use-cases/reports/by-category';
import { ByDay } from '../../../application/use-cases/reports/by-day';
import { IncomeVsSpent } from '../../../application/use-cases/reports/income-vs-spent';
import { MonthlyEvolution } from '../../../application/use-cases/reports/monthly-evolution';
import { AuthenticatedUser, CurrentUser } from '../decorators/current-user.decorator';
import { MonthQueryDto, MonthRangeQueryDto } from '../dtos/reports.dto';
import {
  CategoryReportView,
  DayReportView,
  EvolutionReportView,
  IncomeVsSpentView,
  toCategoryReportView,
  toDayReportView,
  toEvolutionReportView,
  toIncomeVsSpentView,
} from '../views';

/**
 * Chart data for the authenticated user's own spending. There is no user id anywhere in the
 * request: admins get no wider access, and every use case is scoped to the actor.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly byCategory: ByCategory,
    private readonly byDay: ByDay,
    private readonly monthlyEvolution: MonthlyEvolution,
    private readonly incomeVsSpent: IncomeVsSpent,
  ) {}

  @Get('by-category')
  async category(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: MonthQueryDto,
  ): Promise<CategoryReportView> {
    return toCategoryReportView(await this.byCategory.execute(actor, query.month));
  }

  @Get('by-day')
  async day(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: MonthQueryDto,
  ): Promise<DayReportView> {
    return toDayReportView(await this.byDay.execute(actor, query.month));
  }

  @Get('monthly-evolution')
  async evolution(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: MonthRangeQueryDto,
  ): Promise<EvolutionReportView> {
    return toEvolutionReportView(
      await this.monthlyEvolution.execute(actor, { from: query.from, to: query.to }),
    );
  }

  @Get('income-vs-spent')
  async income(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: MonthQueryDto,
  ): Promise<IncomeVsSpentView> {
    return toIncomeVsSpentView(await this.incomeVsSpent.execute(actor, query.month));
  }
}
