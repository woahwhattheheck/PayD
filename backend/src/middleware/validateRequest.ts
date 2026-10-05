import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

export interface RequestValidationSchemas {
  body?: z.ZodType<unknown>;
  query?: z.ZodType<unknown>;
  params?: z.ZodType<unknown>;
}

type RequestLocation = keyof RequestValidationSchemas;

export function validateRequest(schemas: RequestValidationSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const fields: Array<{
      location: RequestLocation;
      field: string;
      message: string;
      code: string;
    }> = [];

    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location]);
      if (result.success) continue;

      for (const issue of result.error.issues) {
        const nestedPath = issue.path.map(String).join('.');
        fields.push({
          location,
          field: nestedPath ? `${location}.${nestedPath}` : location,
          message: issue.message,
          code: issue.code,
        });
      }
    }

    if (fields.length > 0) {
      res.status(400).json({ error: 'Validation failed', fields });
      return;
    }

    next();
  };
}
