import { ExtractionResult } from '../../application/ports/receipt-extractor';
import { Money } from '../../domain/money';

export type TextSource = 'native' | 'ocr';

// Native PDF text is exact; OCR can misread characters, so it is trusted less.
const CONFIDENCE: Record<TextSource, number> = { native: 0.9, ocr: 0.6 };

// Receipts are a page or two; anything past this is not a receipt and only costs CPU.
const MAX_TEXT_LENGTH = 200_000;

const LABEL =
  '(?:valor(?:\\s+(?:pago|total|do\\s+pagamento|da\\s+transferencia))?|total(?:\\s+pago)?)';
// Label and amount may be split by spaces, a colon and up to two line breaks, nothing else.
const GAP = '[ \\t:]*(?:\\r?\\n[ \\t:]*){0,2}';
// BRL with exactly two decimals: 1.234,56 or 1234,56. Not followed by more digits or another
// separator group, so 10,999 and 10,99,88 never match.
const AMOUNT = '((?:R\\$[ \\t]*)?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2})(?![\\d]|[.,]\\d)';
// The label must not continue a sentence ("saldo total", "pagamento valor"): the previous
// character on the line may not be a letter.
const PATTERN = new RegExp(`(?<!\\p{L}[ \\t]*)\\b${LABEL}\\b${GAP}${AMOUNT}`, 'giu');

const NONE: ExtractionResult = { amount: null, confidence: 0 };

/**
 * Reads the paid amount from receipt text, only when a clear amount label ("Valor", "Total", ...)
 * is immediately followed by a BRL amount. Loose amounts (balance, fee), conflicting labels and
 * malformed numbers yield null: a wrong amount is worse than none.
 */
export function amountFromText(text: string, source: TextSource): ExtractionResult {
  // Drop accents so "transferência" and "transferencia" are the same label.
  const normalized = text
    .slice(0, MAX_TEXT_LENGTH)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  const found = new Set<number>();
  for (const match of normalized.matchAll(PATTERN)) {
    const money = Money.parseBRL(match[1].replace(/^r\$/i, 'R$'));
    if (money === null) return NONE;
    found.add(money.cents);
  }

  if (found.size !== 1) return NONE;
  const [cents] = [...found];
  if (cents <= 0) return NONE;
  return { amount: Money.fromCents(cents), confidence: CONFIDENCE[source] };
}
