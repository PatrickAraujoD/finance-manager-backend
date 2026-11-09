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
import { CreateLoan } from '../../../application/use-cases/loans/create-loan';
import { DeleteLoan } from '../../../application/use-cases/loans/delete-loan';
import { GetLoan } from '../../../application/use-cases/loans/get-loan';
import { ListLoanPayments } from '../../../application/use-cases/loans/list-loan-payments';
import { ListLoans } from '../../../application/use-cases/loans/list-loans';
import { RegisterLoanPayment } from '../../../application/use-cases/loans/register-loan-payment';
import { UpdateLoan } from '../../../application/use-cases/loans/update-loan';
import { AuthenticatedUser, CurrentUser } from '../decorators/current-user.decorator';
import {
  CreateLoanDto,
  ListLoansQueryDto,
  RegisterLoanPaymentDto,
  UpdateLoanDto,
} from '../dtos/loans.dto';
import { LoanPaymentView, LoanView, toLoanPaymentView, toLoanView } from '../views';

interface LoanPageView {
  items: LoanView[];
  total: number;
  limit: number;
  offset: number;
}

/** Every route works on the authenticated user's own loans; admins get no wider access. */
@Controller('loans')
export class LoansController {
  constructor(
    private readonly createLoan: CreateLoan,
    private readonly updateLoan: UpdateLoan,
    private readonly deleteLoan: DeleteLoan,
    private readonly getLoan: GetLoan,
    private readonly listLoans: ListLoans,
    private readonly registerPayment: RegisterLoanPayment,
    private readonly listPayments: ListLoanPayments,
  ) {}

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateLoanDto,
  ): Promise<{ id: string }> {
    return this.createLoan.execute(actor, dto);
  }

  @Get()
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListLoansQueryDto,
  ): Promise<LoanPageView> {
    const page = await this.listLoans.execute(actor, query);
    return { ...page, items: page.items.map(toLoanView) };
  }

  @Get(':id')
  async get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LoanView> {
    return toLoanView(await this.getLoan.execute(actor, id));
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLoanDto,
  ): Promise<LoanView> {
    return toLoanView(await this.updateLoan.execute(actor, id, dto));
  }

  /** The loan comes from the path, never from the body; a payment over the balance is a 400. */
  @Post(':id/payments')
  registerLoanPayment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterLoanPaymentDto,
  ): Promise<{ id: string }> {
    return this.registerPayment.execute(actor, { ...dto, loanId: id });
  }

  @Get(':id/payments')
  async payments(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LoanPaymentView[]> {
    return (await this.listPayments.execute(actor, id)).map(toLoanPaymentView);
  }

  /** The expense the loan came from, if any, is kept and becomes free to back another loan. */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteLoan.execute(actor, id);
  }
}
