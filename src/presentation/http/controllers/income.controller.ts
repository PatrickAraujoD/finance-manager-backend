import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { GetMonthlyIncome } from '../../../application/use-cases/income/get-monthly-income';
import {
  MonthlyIncomeView,
  SetMonthlyIncome,
} from '../../../application/use-cases/income/set-monthly-income';
import { NotFoundError } from '../../../domain/errors';
import { AuthenticatedUser, CurrentUser } from '../decorators/current-user.decorator';
import { SetIncomeDto } from '../dtos/income.dto';

/**
 * The income always belongs to the authenticated user (no user id in the route). `:month` is a
 * strict YYYY-MM, validated by the domain (invalid -> 400).
 */
@Controller('income')
export class IncomeController {
  constructor(
    private readonly setIncome: SetMonthlyIncome,
    private readonly getIncome: GetMonthlyIncome,
  ) {}

  @Put(':month')
  async set(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('month') month: string,
    @Body() dto: SetIncomeDto,
  ): Promise<MonthlyIncomeView> {
    const saved = await this.setIncome.execute(actor, { month, amountCents: dto.amountCents });
    return { month: saved.month, amountCents: saved.amountCents };
  }

  /** 404 when no income is registered for the month (reports treat that as `null`). */
  @Get(':month')
  async get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('month') month: string,
  ): Promise<MonthlyIncomeView> {
    const income = await this.getIncome.execute(actor, month);
    if (!income) throw new NotFoundError('No income registered for this month');
    return { month: income.month, amountCents: income.amountCents };
  }
}
