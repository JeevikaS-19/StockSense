import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.ts';

// Parses data with a zod schema, throwing a 400 VALIDATION_ERROR that names the first bad field.
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue.path.join('.') || 'field';
  throw new HttpError(400, 'VALIDATION_ERROR', `${field}: ${issue.message}`);
}

export function validateBody(schema: z.ZodType): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = parse(schema, req.body ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Wraps an async route handler so rejected promises reach the error handler (Express 4 does not do this itself).
export function asyncHandler(fn: (req: any, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Optional whole number where blank, null or missing all mean "none". Needed because z.coerce turns null into 0.
export const nullableInt = (min = 1) =>
  z.preprocess(
    (value) => (value === null || value === undefined || value === '' ? null : value),
    z.coerce.number().int().min(min).nullable()
  );

export const positiveInt = z.coerce.number().int().positive();

export const idParam = z.coerce.number().int().positive('A valid id is required.');

export const moneyInput = z.coerce.number().min(0, 'Amount cannot be negative.').max(9999999999.99, 'Amount is too large.');
