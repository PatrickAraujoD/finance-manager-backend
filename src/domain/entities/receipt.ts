import { ValidationError } from '../errors';
import { Money } from '../money';

export interface ReceiptProps {
  id: string;
  userId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  suggestedAmount: Money | null;
}

export class Receipt {
  private constructor(private readonly props: ReceiptProps) {}

  static create(input: ReceiptProps): Receipt {
    if (!input.storageKey) throw new ValidationError('storageKey is required');
    if (!input.mimeType) throw new ValidationError('mimeType is required');
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new ValidationError('sizeBytes must be a positive integer');
    }
    return new Receipt({ ...input });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get storageKey(): string {
    return this.props.storageKey;
  }
  get mimeType(): string {
    return this.props.mimeType;
  }
  get sizeBytes(): number {
    return this.props.sizeBytes;
  }
  get suggestedAmount(): Money | null {
    return this.props.suggestedAmount;
  }
}
