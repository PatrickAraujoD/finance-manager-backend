import {
  ExtractionResult,
  ReceiptExtractor,
} from '../../application/ports/receipt-extractor';

const NO_AMOUNT: ExtractionResult = { amount: null, confidence: 0 };

/**
 * Picks the extractor by mime type. The mime has already been checked against the file's magic
 * bytes by the use case, so this only routes.
 */
export class CompositeReceiptExtractor implements ReceiptExtractor {
  constructor(
    private readonly pdf: ReceiptExtractor,
    private readonly image: ReceiptExtractor,
  ) {}

  async extract(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
    if (mimeType === 'application/pdf') return this.pdf.extract(buffer, mimeType);
    if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
      return this.image.extract(buffer, mimeType);
    }
    return NO_AMOUNT;
  }
}
