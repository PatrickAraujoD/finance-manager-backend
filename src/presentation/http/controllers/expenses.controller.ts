import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateExpense } from '../../../application/use-cases/expenses/create-expense';
import { DeleteExpense } from '../../../application/use-cases/expenses/delete-expense';
import { GetExpense } from '../../../application/use-cases/expenses/get-expense';
import { ListExpenses } from '../../../application/use-cases/expenses/list-expenses';
import { UpdateExpense } from '../../../application/use-cases/expenses/update-expense';
import { AuthenticatedUser, CurrentUser } from '../decorators/current-user.decorator';
import {
  CreateExpenseDto,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from '../dtos/expenses.dto';
import { ExpenseView, toExpenseView } from '../views';

interface ExpensePageView {
  items: ExpenseView[];
  total: number;
  limit: number;
  offset: number;
}

/** Every route works on the authenticated user's own expenses; admins get no wider access. */
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly createExpense: CreateExpense,
    private readonly updateExpense: UpdateExpense,
    private readonly deleteExpense: DeleteExpense,
    private readonly getExpense: GetExpense,
    private readonly listExpenses: ListExpenses,
  ) {}

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateExpenseDto,
  ): Promise<{ id: string }> {
    return this.createExpense.execute(actor, dto);
  }

  @Get()
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListExpensesQueryDto,
  ): Promise<ExpensePageView> {
    const page = await this.listExpenses.execute(actor, query);
    return { ...page, items: page.items.map(toExpenseView) };
  }

  @Get(':id')
  async get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExpenseView> {
    return toExpenseView(await this.getExpense.execute(actor, id));
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseView> {
    return toExpenseView(await this.updateExpense.execute(actor, id, dto));
  }

  /** The receipt and its stored file are kept; the receipt just becomes free to be reused. */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteExpense.execute(actor, id);
  }
}
