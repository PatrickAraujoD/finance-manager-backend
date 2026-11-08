export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {}
export class NotFoundError extends DomainError {}
export class ForbiddenError extends DomainError {}
export class ConflictError extends DomainError {}
export class UnauthorizedError extends DomainError {}

/** A NotFound for a record whose backing file is gone: answered like any 404, but worth a log. */
export class StoredFileMissingError extends NotFoundError {}
