import { formatCalendarDate, parseCalendarDate } from '../../../src/domain/calendar-date';
import { ValidationError } from '../../../src/domain/errors';

describe('parseCalendarDate', () => {
  it('parses a real date as 00:00 UTC of that day', () => {
    expect(parseCalendarDate('2026-11-08', 'spentAt').toISOString()).toBe(
      '2026-11-08T00:00:00.000Z',
    );
  });

  it('accepts a leap day only in leap years', () => {
    expect(parseCalendarDate('2028-02-29', 'd').toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(() => parseCalendarDate('2026-02-29', 'd')).toThrow(ValidationError);
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-01-00',
    '26-1-1',
    '2026-1-1',
    '2026/01/01',
    '20260101',
    '2026-01-01T00:00:00Z',
    ' 2026-01-01',
    '2026-01-01 ',
    '',
    'nope',
    '1800-01-01',
    '0000-01-01',
    '2026-01-01\n',
  ])('rejects %p', (value) => {
    expect(() => parseCalendarDate(value, 'spentAt')).toThrow(ValidationError);
  });

  it('rejects non strings', () => {
    expect(() => parseCalendarDate(20260101 as unknown as string, 'd')).toThrow(ValidationError);
    expect(() => parseCalendarDate(null as unknown as string, 'd')).toThrow(ValidationError);
  });
});

describe('formatCalendarDate', () => {
  it('formats the UTC day as YYYY-MM-DD', () => {
    expect(formatCalendarDate(new Date('2026-03-05T00:00:00Z'))).toBe('2026-03-05');
    expect(formatCalendarDate(new Date('2026-03-05T23:59:59Z'))).toBe('2026-03-05');
  });
});
