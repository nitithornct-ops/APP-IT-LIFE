import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIB = 1024;
const MIB = 1024 * KIB;

export const DEFAULT_BUILD_BUDGETS = Object.freeze({
  webEntryJsGzip: 120 * KIB,
  webEntryCssGzip: 30 * KIB,
  webLargestLazyJsGzip: 210 * KIB,
  webLargestAssetRaw: 1.35 * MIB,
  apiWorkerGzip: 1.5 * MIB,
});

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function configuredBuildBudgets(env = process.env) {
  return {
    webEntryJsGzip: positiveNumber(env.BUDGET_WEB_ENTRY_JS_GZIP, DEFAULT_BUILD_BUDGETS.webEntryJsGzip),
    webEntryCssGzip: positiveNumber(env.BUDGET_WEB_ENTRY_CSS_GZIP, DEFAULT_BUILD_BUDGETS.webEntryCssGzip),
    webLargestLazyJsGzip: positiveNumber(env.BUDGET_WEB_LAZY_JS_GZIP, DEFAULT_BUILD_BUDGETS.webLargestLazyJsGzip),
    webLargestAssetRaw: positiveNumber(env.BUDGET_WEB_LARGEST_ASSET_RAW, DEFAULT_BUILD_BUDGETS.webLargestAssetRaw),
    apiWorkerGzip: positiveNumber(env.BUDGET_API_WORKER_GZIP, DEFAULT_BUILD_BUDGETS.apiWorkerGzip),
  };
}

export function evaluateBuildBudgets(measurements, budgets) {
  const failures = [];
  for (const [name, value] of Object.entries(measurements)) {
    const limit = budgets[name];
    if (typeof limit !== 'number') continue;
    if (value > limit) failures.push(`${name} is ${formatBytes(value)}; budget is ${formatBytes(limit)}`);
  }
  return failures;
}

export function formatBytes(bytes) {
  return bytes >= MIB ? `${(bytes / MIB).toFixed(2)} MiB` : `${(bytes / KIB).toFixed(1)} KiB`;
}

export function extractEntryAssets(html) {
  const entryJs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*assets\/[^"]+\.(?:js|mjs))"[^>]*>/g)]
    .map((match) => match[1].replace(/^\//, ''));
  const entryCss = [...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="([^"]*assets\/[^"]+\.css)")[^>]*>/g)]
    .map((match) => match[1].replace(/^\//, ''));
  return { entryJs, entryCss };
}

export function isLazyJsBudgetCandidate(name, entryJsName) {
  return /\.(?:js|mjs)$/.test(name) && name !== entryJsName && !name.includes('.worker.');
}

async function gzipBytes(path) {
  return gzipSync(await readFile(path), { level: 9 }).byteLength;
}

async function collectMeasurements(root = process.cwd()) {
  const webDist = resolve(root, 'apps/web/dist');
  const apiWorker = resolve(root, 'apps/api/dist/worker.js');
  const html = await readFile(resolve(webDist, 'index.html'), 'utf8');
  const { entryJs, entryCss } = extractEntryAssets(html);
  if (entryJs.length !== 1 || entryCss.length !== 1) {
    throw new Error(`Expected one entry JS and one entry CSS in apps/web/dist/index.html; found ${entryJs.length} JS and ${entryCss.length} CSS.`);
  }

  const assetsDir = resolve(webDist, 'assets');
  const assetNames = await readdir(assetsDir);
  const entryJsName = entryJs[0].split('/').at(-1);
  const lazyJsNames = assetNames.filter((name) => isLazyJsBudgetCandidate(name, entryJsName));
  const lazyGzipSizes = await Promise.all(lazyJsNames.map((name) => gzipBytes(resolve(assetsDir, name))));
  const rawSizes = await Promise.all(assetNames.map(async (name) => (await stat(resolve(assetsDir, name))).size));

  return {
    webEntryJsGzip: await gzipBytes(resolve(webDist, entryJs[0])),
    webEntryCssGzip: await gzipBytes(resolve(webDist, entryCss[0])),
    webLargestLazyJsGzip: Math.max(0, ...lazyGzipSizes),
    webLargestAssetRaw: Math.max(0, ...rawSizes),
    apiWorkerGzip: await gzipBytes(apiWorker),
  };
}

export async function checkBuildBudgets(root = process.cwd(), env = process.env) {
  const measurements = await collectMeasurements(root);
  const budgets = configuredBuildBudgets(env);
  const failures = evaluateBuildBudgets(measurements, budgets);
  for (const [name, value] of Object.entries(measurements)) {
    console.log(`${name}: ${formatBytes(value)} / ${formatBytes(budgets[name])}`);
  }
  if (failures.length) throw new Error(`Build budget exceeded:\n- ${failures.join('\n- ')}`);
  console.log('Build budget passed.');
  return measurements;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkBuildBudgets().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
