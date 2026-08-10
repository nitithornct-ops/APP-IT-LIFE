import { z } from 'zod';

export const dashboardSummaryQuerySchema = z.object({
  leadDays: z.coerce.number().int().min(7).max(90).default(30),
});

