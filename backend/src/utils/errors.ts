/**
 * Centralized error handling utilities
 * Provides consistent error formatting and handling across the application
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Custom application error with HTTP status code
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(
    message: string,
    statusCode: number = 500,
    options?: { code?: string; isOperational?: boolean }
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = options?.isOperational ?? true;
    this.code = options?.code;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Common HTTP error factory functions
 */
export const HttpErrors = {
  badRequest: (message: string, code?: string) => 
    new AppError(message, 400, { code }),
  
  unauthorized: (message: string = 'Unauthorized', code?: string) => 
    new AppError(message, 401, { code }),
  
  forbidden: (message: string = 'Forbidden', code?: string) => 
    new AppError(message, 403, { code }),
  
  notFound: (message: string = 'Not Found', code?: string) => 
    new AppError(message, 404, { code }),
  
  conflict: (message: string, code?: string) => 
    new AppError(message, 409, { code }),
  
  tooManyRequests: (message: string = 'Too Many Requests', code?: string) => 
    new AppError(message, 429, { code }),
  
  internal: (message: string = 'Internal Server Error', code?: string) => 
    new AppError(message, 500, { code, isOperational: false }),
  
  serviceUnavailable: (message: string = 'Service Unavailable', code?: string) => 
    new AppError(message, 503, { code }),
};

/**
 * Error response interface for consistent API responses
 */
export interface ErrorResponse {
  error: string;
  message?: string;
  code?: string;
  statusCode: number;
}

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'An unknown error occurred';
}

/**
 * Extract error status code from unknown error type
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (typeof err.statusCode === 'number') return err.statusCode;
    if (typeof err.status === 'number') return err.status;
    if (err.response && typeof err.response === 'object') {
      const resp = err.response as Record<string, unknown>;
      if (typeof resp.status === 'number') return resp.status;
    }
  }
  return 500;
}

/**
 * Format error for API response
 */
export function formatErrorResponse(error: unknown): ErrorResponse {
  const message = getErrorMessage(error);
  const statusCode = getErrorStatusCode(error);
  const code = error instanceof AppError ? error.code : undefined;

  return {
    error: statusCode >= 500 ? 'Internal Server Error' : message,
    message: statusCode >= 500 ? 'An unexpected error occurred' : undefined,
    code,
    statusCode,
  };
}

/**
 * Log error with appropriate detail level
 */
export function logError(error: unknown, context?: string): void {
  const message = getErrorMessage(error);
  const statusCode = getErrorStatusCode(error);
  const prefix = context ? `[${context}]` : '';

  if (statusCode >= 500) {
    // Log full error for server errors
    console.error(`${prefix} Error (${statusCode}):`, message);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  } else {
    // Log minimal info for client errors
    console.warn(`${prefix} Client error (${statusCode}):`, message);
  }
}

/**
 * Express error handling middleware
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logError(error, `${req.method} ${req.path}`);

  const { error: errorMsg, message, code, statusCode } = formatErrorResponse(error);

  res.status(statusCode).json({
    error: errorMsg,
    ...(message && { message }),
    ...(code && { code }),
  });
}

/**
 * Async route handler wrapper to catch errors
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Wrap async operations with consistent error handling
 */
export async function tryCatch<T>(
  operation: () => Promise<T>,
  context?: string
): Promise<[T, null] | [null, Error]> {
  try {
    const result = await operation();
    return [result, null];
  } catch (error) {
    logError(error, context);
    return [null, error instanceof Error ? error : new Error(getErrorMessage(error))];
  }
}
