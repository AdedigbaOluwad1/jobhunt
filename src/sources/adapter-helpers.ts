import { z } from 'zod';
import { AppError } from '../common/errors';
import { HttpError } from '../common/http';

export function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function toDate(value?: string | number | null): Date | undefined {
  if (value === null || value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Turns a failed fetch into the uniform AppError the sync summary and `sources check` print. */
export function fetchFailure(label: string, err: unknown, notFoundHint: string): AppError {
  if (err instanceof HttpError && err.status === 404) {
    return new AppError('SOURCE_FETCH_FAILED', `${label} — ${notFoundHint} (404)`);
  }
  return new AppError('SOURCE_FETCH_FAILED', `${label} — ${err instanceof Error ? err.message : String(err)}`);
}

export function shapeFailure(label: string, error: z.ZodError): AppError {
  const issue = error.issues[0];
  return new AppError(
    'SOURCE_FETCH_FAILED',
    `${label} — unexpected response shape at ${issue?.path.join('.')}: ${issue?.message}`,
  );
}
