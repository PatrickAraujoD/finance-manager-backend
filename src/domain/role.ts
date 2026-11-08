import { ValidationError } from './errors';

export type Role = 'A' | 'N';

export function parseRole(v: string): Role {
  if (v === 'A' || v === 'N') return v;
  throw new ValidationError('Invalid role');
}
