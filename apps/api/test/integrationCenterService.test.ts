import { describe, expect, it } from 'vitest';
import { buildIntegrationCenter } from '../src/services/integrationCenterService';
import type { Bindings } from '../src/types';

function env(overrides: Partial<Bindings> = {}): Bindings {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

describe('Integration Center summary', () => {
  it('reports only fully configured deployment channels as active without exposing secrets', () => {
    const result = buildIntegrationCenter({
      env: env({
        LINE_LOGIN_ENABLED: 'true', LINE_LOGIN_CHANNEL_ID: 'channel', LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
        LINE_LOGIN_CALLBACK_URL: 'https://app.example.com/line/callback', LINE_SESSION_SECRET: 'session-secret',
        NOTIFY_LINE_ENABLED: 'true', LINE_CHANNEL_ACCESS_TOKEN: 'messaging-secret',
      }),
      now: new Date('2026-08-23T08:00:00.000Z'), canManage: true,
      outboxCounts: { PENDING: 1, PROCESSING: 0, COMPLETED: 10, ERROR: 0, DEAD: 0, CANCELLED: 0 },
      notifications24h: 12, lineSuccess24h: 5, lineFailure24h: 0, activeLineUsers: 3,
      outboxRows: [], lineRows: [],
    });

    expect(result.summary).toMatchObject({ activeChannels: 3, delivered24h: 17, outboxWaiting: 1, outboxFailed: 0 });
    expect(result.channels.find((channel) => channel.id === 'line-login')?.status).toBe('active');
    expect(result.channels.find((channel) => channel.id === 'webhook')?.status).toBe('unavailable');
    expect(result.rules.find((rule) => rule.id === 'line-link-approval')).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('login-secret');
    expect(JSON.stringify(result)).not.toContain('messaging-secret');
  });

  it('marks partial LINE configuration and exposes safe retry actions only for manageable outbox states', () => {
    const result = buildIntegrationCenter({
      env: env({ LINE_LOGIN_ENABLED: 'true', LINE_LOGIN_CHANNEL_ID: 'channel', NOTIFY_LINE_ENABLED: 'false' }),
      canManage: true, outboxCounts: { ERROR: 1, DEAD: 1 }, notifications24h: 0, lineSuccess24h: 0, lineFailure24h: 1, activeLineUsers: 0,
      outboxRows: [{
        id: 'out-1', integration_code: 'INT-001', event_type: 'NOTIFICATION', target_module: 'notifications', status: 'ERROR',
        attempt_count: 2, max_attempts: 5, next_attempt_at: '2026-08-23T09:00:00Z', last_error: 'temporary failure token=do-not-return',
        created_at: '2026-08-23T08:00:00Z', processed_at: null,
      }],
      lineRows: [{ id: 'line-1', to_target: 'U1234567890ABCDEF', success: false, error: 'HTTP 500', created_at: '2026-08-23T07:00:00Z' }],
    });

    expect(result.channels.find((channel) => channel.id === 'line-login')?.status).toBe('incomplete');
    expect(result.channels.find((channel) => channel.id === 'in-app')?.status).toBe('degraded');
    expect(result.recentEvents.find((event) => event.source === 'outbox')?.actions).toEqual(['retry', 'cancel']);
    expect(result.recentEvents.find((event) => event.source === 'outbox')?.error).toBe('temporary failure token=[redacted]');
    expect(result.recentEvents.find((event) => event.source === 'line')?.channel).toBe('LINE · U123••••CDEF');
  });
});
