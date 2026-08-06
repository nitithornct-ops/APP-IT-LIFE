import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { fail } from '../utils/response';

interface Bucket {
  count: number;
  resetAt: number;
}

// จำกัดในระดับ isolate เดียว (ไม่ persist ข้าม edge node) — เป็นแนวป้องกันชั้นแรกสำหรับ
// endpoint สาธารณะที่ยังไม่ต้อง login (เช่น login-log) ของ Phase 3 นี้ ความแม่นยำข้าม edge node
// จะดีขึ้นถ้าย้ายไป Cloudflare Rate Limiting/KV ในรอบ Security Hardening (Phase 8)
const buckets = new Map<string, Bucket>();

export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyFn: (c: Context<AppEnv>) => string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = options.keyFn(c);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > options.max) {
        return c.json(fail(c.get('requestId'), 'RATE_LIMITED', 'มีการร้องขอมากเกินไป กรุณาลองใหม่ภายหลัง'), 429);
      }
    }

    await next();
  };
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
}
