import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function productionHealthConfig(env = process.env) {
  return {
    webOrigin: requiredHttpsOrigin('PRODUCTION_WEB_URL', env.PRODUCTION_WEB_URL, env.ALLOW_HTTP_HEALTHCHECK === '1'),
    apiOrigin: requiredHttpsOrigin('PRODUCTION_API_URL', env.PRODUCTION_API_URL, env.ALLOW_HTTP_HEALTHCHECK === '1'),
    attempts: positiveInteger(env.HEALTHCHECK_ATTEMPTS, 3),
    timeoutMs: positiveInteger(env.HEALTHCHECK_TIMEOUT_MS, 8_000),
    webMaxMs: positiveInteger(env.SLO_WEB_MAX_MS, 3_000),
    liveMaxMs: positiveInteger(env.SLO_API_LIVE_MAX_MS, 1_500),
    readyMaxMs: positiveInteger(env.SLO_API_READY_MAX_MS, 3_000),
    databaseMaxMs: positiveInteger(env.SLO_DATABASE_MAX_MS, 1_500),
  };
}

function requiredHttpsOrigin(name, value, allowHttp) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  const parsed = new URL(value.trim());
  if (!allowHttp && parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== parsed.href.replace(/\/$/, '')) {
    throw new Error(`${name} must be an origin without a path.`);
  }
  return parsed.origin;
}

export function validateReadyPayload(payload, databaseMaxMs) {
  if (!payload || payload.success !== true || payload.data?.status !== 'ok') {
    return 'readiness payload did not report success/ok';
  }
  const databaseMs = Number(payload.data.responseTimeMs);
  if (!Number.isFinite(databaseMs)) return 'readiness payload did not include responseTimeMs';
  if (databaseMs > databaseMaxMs) return `database readiness took ${databaseMs}ms; SLO is ${databaseMaxMs}ms`;
  return null;
}

async function timedFetch(url, timeoutMs, fetchImpl) {
  const startedAt = performance.now();
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json,text/html;q=0.9', 'user-agent': 'itlife-production-health/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  return { response, elapsedMs: Math.round(performance.now() - startedAt) };
}

export async function checkProductionHealth(config, fetchImpl = fetch) {
  const checks = [
    { name: 'web', url: `${config.webOrigin}/`, maxMs: config.webMaxMs, kind: 'web' },
    { name: 'api-live', url: `${config.apiOrigin}/api/v1/health/live`, maxMs: config.liveMaxMs, kind: 'live' },
    { name: 'api-ready', url: `${config.apiOrigin}/api/v1/health`, maxMs: config.readyMaxMs, kind: 'ready' },
  ];
  const failures = [];
  const results = [];

  for (const check of checks) {
    try {
      const { response, elapsedMs } = await timedFetch(check.url, config.timeoutMs, fetchImpl);
      let detail = '';
      if (!response.ok) detail = `HTTP ${response.status}`;
      if (!detail && elapsedMs > check.maxMs) detail = `${elapsedMs}ms exceeds ${check.maxMs}ms SLO`;
      if (!detail && check.kind === 'web') {
        const html = await response.text();
        if (!/<div\s+id=["']root["']/.test(html)) detail = 'web response is missing the application root';
      }
      if (!detail && check.kind !== 'web') {
        const payload = await response.json();
        if (check.kind === 'live' && (payload?.success !== true || payload.data?.status !== 'ok')) {
          detail = 'liveness payload did not report success/ok';
        }
        if (check.kind === 'ready') detail = validateReadyPayload(payload, config.databaseMaxMs) ?? '';
      }
      results.push({ name: check.name, elapsedMs, ok: !detail });
      if (detail) failures.push(`${check.name}: ${detail}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ name: check.name, elapsedMs: null, ok: false });
      failures.push(`${check.name}: ${detail}`);
    }
  }
  return { ok: failures.length === 0, failures, results };
}

export async function runProductionHealthCheck(env = process.env, fetchImpl = fetch) {
  const config = productionHealthConfig(env);
  let lastResult;
  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    lastResult = await checkProductionHealth(config, fetchImpl);
    const summary = lastResult.results.map((result) => `${result.name}=${result.ok ? `${result.elapsedMs}ms` : 'failed'}`).join(', ');
    console.log(`Production health attempt ${attempt}/${config.attempts}: ${summary}`);
    if (lastResult.ok) {
      console.log('Production health check passed.');
      return lastResult;
    }
    if (attempt < config.attempts) await sleep(2_000 * attempt);
  }
  throw new Error(`Production health check failed after ${config.attempts} attempts:\n- ${lastResult.failures.join('\n- ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProductionHealthCheck().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
