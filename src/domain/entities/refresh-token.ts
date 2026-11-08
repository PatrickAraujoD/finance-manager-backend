import { ValidationError } from '../errors';

export interface RefreshTokenProps {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type CreateRefreshTokenInput = Omit<RefreshTokenProps, 'revokedAt'> & {
  revokedAt?: Date | null;
};

export class RefreshToken {
  private constructor(private readonly props: RefreshTokenProps) {}

  static create(input: CreateRefreshTokenInput): RefreshToken {
    if (!input.tokenHash) throw new ValidationError('tokenHash is required');
    if (Number.isNaN(input.expiresAt.getTime())) throw new ValidationError('Invalid expiresAt');
    return new RefreshToken({ ...input, revokedAt: input.revokedAt ?? null });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get familyId(): string {
    return this.props.familyId;
  }
  get tokenHash(): string {
    return this.props.tokenHash;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  revoke(now: Date): RefreshToken {
    return new RefreshToken({ ...this.props, revokedAt: now });
  }
}
