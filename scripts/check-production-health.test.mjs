import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkProductionHealth, productionHealthConfig, validateReadyPayload } from './check-production-health.mjs';

describe('production health check', () => {
  it('requires production origins to use HTTPS', () => {
    assert.throws(() => productionHealthConfig({ PRODUCTION_WEB_URL: 'http://example.com', PRODUCTION_API_URL: 'https://api.example.com' }), /HTTPS/);
  });

  it('rejects degraded or slow database readiness', () => {
    assert.match(validateReadyPayload({ success: true, data: { status: 'degraded', responseTimeMs: 1 } }, 100), /success\/ok/);
    assert.match(validateReadyPayload({ success: true, data: { status: 'ok', responseTimeMs: 101 } }, 100), /SLO/);
  });

  it('checks the web shell, liveness and readiness contracts', async () => {
    const responses = new Map([
      ['https://web.example.com/', new Response('<div id="root"></div>', { status: 200 })],
      ['https://api.example.com/api/v1/health/live', Response.json({ success: true, data: { status: 'ok' } })],
      ['https://api.example.com/api/v1/health', Response.json({ success: true, data: { status: 'ok', responseTimeMs: 12 } })],
    ]);
    const result = await checkProductionHealth({
      webOrigin: 'https://web.example.com', apiOrigin: 'https://api.example.com', timeoutMs: 1_000,
      webMaxMs: 1_000, liveMaxMs: 1_000, readyMaxMs: 1_000, databaseMaxMs: 100,
    }, async (url) => responses.get(url).clone());
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 3);
  });
});
