import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestApiData } from './apiClient';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requestApiData', () => {
  it('returns data from a valid success envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { id: 'ok' },
      meta: { requestId: 'req-ok', timestamp: new Date().toISOString() },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(requestApiData<{ id: string }>('/ok')).resolves.toEqual({ id: 'ok' });
  });

  it('turns an HTML gateway response into a safe typed error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', {
      status: 502,
      headers: { 'x-request-id': 'edge-123', 'content-type': 'text/html' },
    })));

    await expect(requestApiData('/gateway')).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
      requestId: 'edge-123',
    });
  });

  it('aborts a request at the configured timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })));

    const pending = expect(requestApiData('/slow', undefined, 25)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(25);
    await pending;
  });
});
