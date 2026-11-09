import { ValidationError } from './errors';

export type PaymentMethod = 'CREDIT' | 'DEBIT' | 'PIX';

export function parsePaymentMethod(v: string): PaymentMethod {
  if (v === 'CREDIT' || v === 'DEBIT' || v === 'PIX') return v;
  throw new ValidationError('paymentMethod must be CREDIT, DEBIT or PIX');
}
