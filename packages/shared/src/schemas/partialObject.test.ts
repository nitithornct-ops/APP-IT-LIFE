import { expect, it } from 'vitest';
import { z } from 'zod';
import { partialObject } from './partialObject';

it('preserves omitted PATCH fields while validating supplied values', () => {
  const create = z.object({ title: z.string().min(1), status: z.enum(['active', 'inactive']).default('active'), count: z.number().default(1) });
  const patch = partialObject(create);
  expect(create.parse({ title: 'Item' })).toEqual({ title: 'Item', status: 'active', count: 1 });
  expect(patch.parse({ title: 'Updated' })).toEqual({ title: 'Updated' });
  expect(patch.parse({})).toEqual({});
  expect(patch.parse({ status: 'inactive', count: 0 })).toEqual({ status: 'inactive', count: 0 });
  expect(patch.safeParse({ status: 'unknown' }).success).toBe(false);
});
