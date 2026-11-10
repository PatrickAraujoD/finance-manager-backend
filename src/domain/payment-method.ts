import { ValidationError } from './errors';

export type PaymentMethod = 'CREDIT' | 'DEBIT' | 'PIX' | 'CASH';

export function parsePaymentMethod(v: string): PaymentMethod {
  if (v === 'CREDIT' || v === 'DEBIT' || v === 'PIX' || v === 'CASH') return v;
  throw new ValidationError('paymentMethod must be CREDIT, DEBIT, PIX or CASH');
}
