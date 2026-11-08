import { ExtractionResult } from '../../application/ports/receipt-extractor';
import { Money } from '../../domain/money';

export type TextSource = 'native' | 'ocr';

// Native PDF text is exact; OCR can misread characters, so it is trusted less. A weak label (a
// bare "Valor" or "Total") says less than a specific one ("Valor pago"), so it is trusted less
// still: the amount is only accepted with an R$ next to it.
const CONFIDENCE: Record<TextSource, { strong: number; weak: number }> = {
  native: { strong: 0.9, weak: 0.75 },
  ocr: { strong: 0.6, weak: 0.45 },
};

// Receipts are a page or two; anything past this is not a receipt and only costs CPU.
const MAX_TEXT_LENGTH = 200_000;
// Nobody pays more than this through a personal finance app, so a bigger number is a misread
// (or an attack), never a suggestion: R$ 1.000.000,00.
export const MAX_SUGGESTED_CENTS = 100_000_000;
// Real receipts have a handful of labelled amounts; refusing past this bounds the work done
// per match below and keeps the whole parse linear.
const MAX_CANDIDATES = 50;
// How far back (characters) the surrounding-context checks look. Bounded so that a huge
// single-line text cannot make each match cost O(n).
const CONTEXT_WINDOW = 300;
const SUFFIX_WINDOW = 24;

const LABEL =
  '(valor(?:\\s+(pago|total|do\\s+pagamento|da\\s+transferencia))?|total(?:\\s+(pago))?)';
// Label and amount may be split by spaces, a colon and up to two line breaks, nothing else.
const GAP = '[ \\t:]*(?:\\r?\\n[ \\t:]*){0,2}';
// BRL with exactly two decimals: 1.234,56 or 1234,56. Not followed by more digits or another
// separator group, so 10,999 and 10,99,88 never match.
const AMOUNT = '((?:r\\$[ \\t]*)?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2})(?![\\d]|[.,]\\d)';
// The label must not continue a sentence ("saldo total", "pagamento valor"): the previous
// character on the line may not be a letter.
const PATTERN = new RegExp(`(?<!\\p{L}[ \\t]*)\\b${LABEL}\\b${GAP}${AMOUNT}`, 'giu');

// A payment that did not (or not yet) happen: nothing in the text can be called "paid".
const NOT_PAID =
  /estorn|cancel|agendad|nao\s+(?:foi\s+)?(?:realiz|efetiv|conclu)|negad|recus|falh|pendente|devolv|devoluc|reembols|expirad|processamento|aguardando|analise|previst|orcamento|proposta|gerado/;

// Section labels: an amount under them is a fee, a balance, an installment... not the payment.
const SECTION_WORD =
  '(?:desconto|juros|multa|tarifa|encargo|saldo|limite|parcela|abatimento|mora|iof|taxa|sub-?total|pre-?total)';
const SECTION = new RegExp(`\\b${SECTION_WORD}s?\\b`);
const SECTION_RIGHT_AFTER = new RegExp(`^[ \\t]*[(-]*[ \\t]*${SECTION_WORD}s?\\b`);
// Words that change the amount of a bill; if one is present a bare "Valor" is ambiguous.
const ADJUSTMENT = /\b(?:desconto|abatimento|juros|multa|mora|encargo|acrescimo|minimo)s?\b/;
// A label right after another label ("Valor Total: Valor R$ 5,00") is a column heading or a
// repeated caption; which of the two the number belongs to is unknowable.
const LABEL_JUST_BEFORE = /\b(?:valor|total)(?:[ \t]+(?:pago|total))?[ \t:]*$/;
// A number with decimals on a line: that line is a complete entry of its own.
const HAS_AMOUNT = /\d,\d{2}/;

// What may follow the number on the same line without changing its meaning is "nothing" or
// a word that is not one of these: a percentage, a foreign currency, a unit, a quantity or a
// debit/credit marker.
const ADJACENT_BAD = /^[\p{L}\p{N}%$€-]/u;
const SPACED_BAD =
  /^[ \t]+(?:usd|eur|gbp|us\$|€|\$|d|c|db|cr|h|hs|hr|hrs|min|kg|g|mg|l|ml|km|m|cm|un|und|unid|unidade|unidades|item|itens|items|x|pc|pcs|peca|pecas|dia|dias|mes|meses|vez|vezes|parcela|parcelas|ano|anos)(?![\p{L}\p{N}])/u;

const NONE: ExtractionResult = { amount: null, confidence: 0 };

interface Candidate {
  cents: number;
  /** A specific label ("Valor pago", "Valor total", ...) or an R$ next to the amount. */
  reliable: boolean;
  /** The label itself says it is the paid amount ("pago", "do pagamento", "da transferencia"). */
  paid: boolean;
  /** Label strength, for the confidence. */
  strong: boolean;
}

/**
 * Reads the paid amount from receipt text, only when a clear amount label ("Valor", "Total", ...)
 * is immediately followed by a BRL amount. Loose amounts (balance, fee), conflicting labels,
 * malformed numbers, quantities, percentages, foreign currency, discounts, payments that did
 * not happen and implausibly large amounts yield null: a wrong amount is worse than none.
 */
export function amountFromText(text: string, source: TextSource): ExtractionResult {
  // Drop accents so "transferência" and "transferencia" are the same label.
  const normalized = text
    .slice(0, MAX_TEXT_LENGTH)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  if (NOT_PAID.test(normalized)) return NONE;

  const candidates: Candidate[] = [];
  for (const match of normalized.matchAll(PATTERN)) {
    if (candidates.length >= MAX_CANDIDATES) return NONE;
    const candidate = readCandidate(normalized, match);
    if (candidate === null) return NONE;
    candidates.push(candidate);
  }

  // With a discount or fee in the text only an explicitly "paid" label can be trusted.
  const usable = ADJUSTMENT.test(normalized) ? candidates.filter((c) => c.paid) : candidates;

  const amounts = new Set(usable.map((c) => c.cents));
  if (amounts.size !== 1 || !usable.some((c) => c.reliable)) return NONE;
  const [cents] = [...amounts];
  if (cents <= 0 || cents > MAX_SUGGESTED_CENTS) return NONE;

  const best = usable.some((c) => c.reliable && c.strong) ? 'strong' : 'weak';
  return { amount: Money.fromCents(cents), confidence: CONFIDENCE[source][best] };
}

/** One labelled amount, or null when its surroundings make the whole text untrustworthy. */
function readCandidate(text: string, match: RegExpMatchArray): Candidate | null {
  const label = match[1];
  const strongLabel = match[2] !== undefined || match[3] !== undefined;
  const raw = match[4];
  const start = match.index ?? 0;
  const end = start + match[0].length;

  const money = Money.parseBRL(raw.replace(/^r\$/, 'R$'));
  if (money === null) return null;

  if (changesMeaning(text.slice(end, end + SUFFIX_WINDOW))) return null;
  if (inSectionContext(text, start, label.length)) return null;

  return {
    cents: money.cents,
    reliable: strongLabel || raw.startsWith('r$'),
    paid: match[2] === 'pago' || /pagamento|transferencia/.test(match[2] ?? '') || match[3] === 'pago',
    strong: strongLabel,
  };
}

/** True when what follows the number on its line turns it into something else. */
function changesMeaning(after: string): boolean {
  const sameLine = after.split('\n', 1)[0];
  return (
    ADJACENT_BAD.test(sameLine) || SPACED_BAD.test(sameLine) || SECTION_RIGHT_AFTER.test(sameLine)
  );
}

/**
 * True when a section label (fee, balance, installment...) or another label sits before the
 * label on its line
 * (including the label's own text, for "Sub-total") or alone on one of the two lines above.
 * A line above that carries an amount of its own is a finished entry and says nothing.
 */
function inSectionContext(text: string, labelStart: number, labelLength: number): boolean {
  const windowStart = Math.max(0, labelStart - CONTEXT_WINDOW);
  const before = text.slice(windowStart, labelStart);
  const lineBreak = before.lastIndexOf('\n');
  const sameLine = before.slice(lineBreak + 1);
  const labelText = text.slice(labelStart, labelStart + labelLength);
  if (SECTION.test(sameLine + labelText) || LABEL_JUST_BEFORE.test(sameLine)) return true;

  const above = lineBreak < 0 ? [] : before.slice(0, lineBreak).split('\n').slice(-2);
  return above.some((line) => !HAS_AMOUNT.test(line) && SECTION.test(line));
}
