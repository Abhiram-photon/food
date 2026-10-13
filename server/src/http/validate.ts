import type { ZodType } from 'zod';
import { AppError } from '../lib/errors';

function zodToAppError(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): AppError {
  const details = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  const first = details[0];
  const message = first
    ? `${first.path ? `${first.path}: ` : ''}${first.message}`
    : 'Request validation failed.';
  return new AppError(400, 'VALIDATION_ERROR', message, { issues: details });
}

/** Validates `value` against a Zod schema, throwing a 400 AppError on failure. */
export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw zodToAppError(result.error);
  return result.data;
}
