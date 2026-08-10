import { z } from 'zod';

export const updateSystemSettingSchema = z.object({
  value: z.string().max(4000),
}).strict();

