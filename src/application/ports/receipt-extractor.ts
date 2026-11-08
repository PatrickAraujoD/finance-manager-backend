import { Money } from '../../domain/money';

export interface ExtractionResult {
  /** null when no amount could be read reliably. */
  amount: Money | null;
  confidence: number;
}

export interface ReceiptExtractor {
  extract(buffer: Buffer, mimeType: string): Promise<ExtractionResult>;
}
