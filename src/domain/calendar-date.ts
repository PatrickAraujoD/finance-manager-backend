import { ValidationError } from './errors';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1900;

/**
 * Parses a strict `YYYY-MM-DD` real calendar date into a `Date` at 00:00 UTC. `2026-02-30`,
 * `2026-13-01`, `26-1-1`, timestamps and padded strings are rejected. Years before 1900 are
 * rejected as typos.
 */
export function parseCalendarDate(value: string, field: string): Date {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (!match) throw new ValidationError(`${field} must be a date in YYYY-MM-DD format`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    year >= MIN_YEAR &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!real) throw new ValidationError(`${field} must be a real calendar date`);
  return date;
}

/** The UTC day of `date` as `YYYY-MM-DD`. */
export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
