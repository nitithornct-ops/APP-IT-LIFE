import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { fail } from '../utils/response';

interface Bucket {
  count: number;
  resetAt: number;
  lastSeenAt: number;
}

// จำกัดในระดับ isolate เดียว (ไม่ persist ข้าม edge node) — เป็นแนวป้องกันชั้นแรกสำหรับ
// endpoint สาธารณะที่ยังไม่ต้อง login (เช่น login-log) ของ Phase 3 นี้ ความแม่นยำข้าม edge node
// จะดีขึ้นถ้าย้ายไป Cloudflare Rate Limiting/KV ในรอบ Security Hardening (Phase 8)
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
let nextSweepAt = 0;

function sweepExpired(now: number): void {
  if (now < nextSweepAt && buckets.size < MAX_BUCKETS) return;
  nextSweepAt = now + 30_000;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function evictOldestIfFull(): void {
  if (buckets.size < MAX_BUCKETS) return;
  let oldestKey: string | undefined;
  let oldestSeen = Number.POSITIVE_INFINITY;
  for (const [key, bucket] of buckets) {
    if (bucket.lastSeenAt < oldestSeen) {
      oldestKey = key;
      oldestSeen = bucket.lastSeenAt;
    }
  }
  if (oldestKey) buckets.delete(oldestKey);
}

export function rateLimit(options: {
  windowMs: number;
  max: number | ((c: Context<AppEnv>) => number);
  keyFn: (c: Context<AppEnv>) => string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = options.keyFn(c);
    const max = typeof options.max === 'function' ? options.max(c) : options.max;
    const now = Date.now();
    sweepExpired(now);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      evictOldestIfFull();
      buckets.set(key, { count: 1, resetAt: now + options.windowMs, lastSeenAt: now });
    } else {
      bucket.count += 1;
      bucket.lastSeenAt = now;
      if (bucket.count > max) {
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
  keyFn: (c: Context<AppEnv>) => string | Promise<string>;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env.PUBLIC_RATE_LIMITER;
    if (limiter) {
      const outcome = await limiter.limit({ key: await options.keyFn(c) });
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

/** Test-only observability keeps production callers from depending on Map internals. */
export function rateLimitBucketCountForTest(): number {
  return buckets.size;
}

export function resetRateLimitBucketsForTest(): void {
  buckets.clear();
  nextSweepAt = 0;
}
