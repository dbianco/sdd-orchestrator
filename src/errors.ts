export const ERROR_PRECEDENCE = [
  'VALIDATION_ERROR',
  'APP_NOT_FOUND',
  'FEATURE_NOT_FOUND',
  'UNKNOWN_FRAMEWORK',
  'FEATURE_ARCHIVED',
  'STALE_STATE',
  'FEATURE_BLOCKED',
  'PHASE_ORDER_VIOLATION',
  'EMBEDDING_MODEL_MISMATCH',
] as const;
export type ErrorCode = (typeof ERROR_PRECEDENCE)[number];

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: ErrorCode; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function firstByPrecedence(errors: DomainError[]): DomainError {
  if (errors.length === 0) throw new Error('firstByPrecedence called with no errors');
  return [...errors].sort(
    (a, b) => ERROR_PRECEDENCE.indexOf(a.code) - ERROR_PRECEDENCE.indexOf(b.code),
  )[0]!;
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
