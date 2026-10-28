import { z } from 'zod';

/** PATCH inputs must leave omitted fields untouched, including fields with create defaults. */
export function partialObject<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [
    key, z.union([z.undefined(), field]).optional(),
  ])) as { [K in keyof T]: z.ZodOptional<z.ZodUnion<[z.ZodUndefined, T[K]]>> };
  return z.object(shape);
}
