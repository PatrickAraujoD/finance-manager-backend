import { ValidationError } from '../errors';
import { Money } from '../money';
import { requireCleanText, requireNonBlank } from '../validation';

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
    requireNonBlank(input.id, 'id');
    requireNonBlank(input.userId, 'userId');
    if (!input.storageKey) throw new ValidationError('storageKey is required');
    requireCleanText(input.storageKey, 'storageKey');
    if (!input.mimeType) throw new ValidationError('mimeType is required');
    requireCleanText(input.mimeType, 'mimeType');
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
