import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { fail } from '../utils/response';

interface Bucket {
  count: number;
  resetAt: number;
}

// จำกัดในระดับ isolate เดียว (ไม่ persist ข้าม edge node) — เป็น defense in depth สำหรับ endpoint
// สาธารณะ ส่วน route ที่มีความเสี่ยงสูงควรใช้ edgeRateLimit ร่วมกับ binding ของ Cloudflare ด้วย
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
const PRUNE_INTERVAL_MS = 60_000;
let nextPruneAt = 0;

function pruneBuckets(now: number): void {
  if (now < nextPruneAt && buckets.size <= MAX_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  if (buckets.size > MAX_BUCKETS) {
    const oldest = [...buckets.entries()]
      .sort((left, right) => left[1].resetAt - right[1].resetAt)
      .slice(0, buckets.size - MAX_BUCKETS);
    for (const [key] of oldest) buckets.delete(key);
  }
  nextPruneAt = now + PRUNE_INTERVAL_MS;
}

export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyFn: (c: Context<AppEnv>) => string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = options.keyFn(c);
    const now = Date.now();
    pruneBuckets(now);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
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

/**
 * Cloudflare-backed burst limiting for public routes. The binding is optional so unit tests
 * and local development still work; the existing isolate limiter remains defense in depth.
 */
export function edgeRateLimit(options: {
  keyFn: (c: Context<AppEnv>) => string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env.PUBLIC_RATE_LIMITER;
    if (limiter) {
      const outcome = await limiter.limit({ key: options.keyFn(c) });
      if (!outcome.success) {
        return c.json(fail(c.get('requestId'), 'RATE_LIMITED', 'มีการร้องขอมากเกินไป กรุณาลองใหม่ภายหลัง'), 429);
      }
    }
    await next();
  };
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
}
