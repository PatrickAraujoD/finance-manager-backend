import { ValidationError } from '../errors';
import { requireCleanText, requireNonBlank } from '../validation';

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
    requireNonBlank(input.id, 'id');
    requireNonBlank(input.userId, 'userId');
    requireCleanText(input.familyId, 'familyId');
    if (!input.tokenHash) throw new ValidationError('tokenHash is required');
    requireCleanText(input.tokenHash, 'tokenHash');
    if (Number.isNaN(input.expiresAt.getTime())) throw new ValidationError('Invalid expiresAt');
    return new RefreshToken({
      ...input,
      expiresAt: new Date(input.expiresAt.getTime()),
      revokedAt: input.revokedAt ? new Date(input.revokedAt.getTime()) : null,
    });
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
    return new Date(this.props.expiresAt.getTime());
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt ? new Date(this.props.revokedAt.getTime()) : null;
  }

  revoke(now: Date): RefreshToken {
    return new RefreshToken({ ...this.props, revokedAt: new Date(now.getTime()) });
  }
}
