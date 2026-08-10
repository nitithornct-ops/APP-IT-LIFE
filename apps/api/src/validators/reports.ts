import { z } from 'zod';

const rangeDays = z.coerce.number().int().min(0).max(3650).default(30);

export const reportRangeQuerySchema = z.object({ rangeDays });
export const reportExportSchema = z.object({ rangeDays }).strict();
