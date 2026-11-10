import { ValidationError } from './errors';

/** CASH is physical money typed by hand; PIX needs a receipt. */
export type LoanPaymentMethod = 'CASH' | 'PIX';

export function parseLoanPaymentMethod(v: string): LoanPaymentMethod {
  if (v === 'CASH' || v === 'PIX') return v;
  throw new ValidationError('method must be CASH or PIX');
}
