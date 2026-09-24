/**
 * Base application error with HTTP status and machine-readable code.
 * Controllers and services throw subclasses; the global error middleware
 * maps them to a consistent JSON response shape.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Resource was not found (HTTP 404). */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

/** Request failed validation (HTTP 400). */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

/** Authentication or authorization failure (HTTP 401 / 403). */
export class AuthError extends AppError {
  constructor(
    message = 'Authentication required',
    statusCode: 401 | 403 = 401,
    code = 'AUTH_ERROR'
  ) {
    super(message, statusCode, code);
  }
}
