#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};

const baseUrl = valueAfter('--url');
const chromePath = valueAfter('--chrome') || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const publicWaitMs = Number(valueAfter('--public-wait-ms') || 25000);
const adminWaitMs = Number(valueAfter('--admin-wait-ms') || 5000);
const expectedBuild = String(valueAfter('--expected-build') || '').trim();
const expectedSchemaRaw = String(valueAfter('--expected-schema') || '').trim();
let expectedSchema = null;

if (expectedSchemaRaw) {
  expectedSchema = Number(expectedSchemaRaw);
  if (!Number.isInteger(expectedSchema) || expectedSchema < 1) {
    console.error('--expected-schema must be a positive integer.');
    process.exit(2);
  }
}

const verifyRelease = Boolean(expectedBuild || expectedSchema !== null);

if (!baseUrl) {
  console.error(
    'Usage: node scripts/live-browser-check.mjs --url <deployment-url> [--chrome <path>] ' +
    '[--expected-build <build-id>] [--expected-schema <positive-integer>]'
  );
  process.exit(2);
}

const qaRoot = await mkdtemp(join(tmpdir(), 'codex-isms-cdp-'));
const profileDir = join(qaRoot, 'profile');
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDir}`,
  '--window-size=1440,1100',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

let devToolsUrl = '';
let chromeStderr = '';
chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', chunk => {
  chromeStderr += chunk;
  const match = chromeStderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
  if (match) devToolsUrl = match[1];
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitForDevTools = async () => {
  const deadline = Date.now() + 15000;
  while (!devToolsUrl && Date.now() < deadline) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before DevTools was ready (${chrome.exitCode}).`);
    await delay(100);
  }
  if (!devToolsUrl) throw new Error('Chrome DevTools endpoint did not become ready.');
};

await waitForDevTools();

const browserWs = new WebSocket(devToolsUrl);
await new Promise((resolve, reject) => {
  browserWs.addEventListener('open', resolve, { once: true });
  browserWs.addEventListener('error', reject, { once: true });
});

let browserMessageId = 0;
const browserPending = new Map();
const browserEvents = [];
browserWs.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && browserPending.has(message.id)) {
    const pending = browserPending.get(message.id);
    browserPending.delete(message.id);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message.result || {});
    return;
  }
  if (message.method) browserEvents.push(message);
});

const browserSend = (method, params = {}, sessionId = '') => new Promise((resolve, reject) => {
  const id = ++browserMessageId;
  browserPending.set(id, { resolve, reject });
  browserWs.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetId } = await browserSend('Target.createTarget', { url: 'about:blank' });
const targets = await browserSend('Target.getTargets');
const target = targets.targetInfos.find(item => item.targetId === targetId);
if (!target) throw new Error('Chrome page target was not created.');

const targetListUrl = new URL(devToolsUrl);
targetListUrl.pathname = '/json/list';
targetListUrl.search = '';
targetListUrl.protocol = 'http:';
const pageTargets = await fetch(targetListUrl).then(response => response.json());
const pageTarget = pageTargets.find(item => item.id === targetId);
if (!pageTarget?.webSocketDebuggerUrl) throw new Error('Chrome page WebSocket was not found.');

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const events = [];
const defaultContextsByFrame = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result || {});
    return;
  }
  if (!message.method) return;
  events.push(message);
  if (message.method === 'Runtime.executionContextCreated') {
    const context = message.params.context;
    const frameId = context.auxData?.frameId;
    if (frameId && context.auxData?.isDefault) defaultContextsByFrame.set(frameId, context.id);
  }
  if (message.method === 'Runtime.executionContextsCleared') defaultContextsByFrame.clear();
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

const evaluate = async (expression, contextId) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    ...(contextId ? { contextId } : {})
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed.');
  }
  return result.result?.value;
};

const waitReady = async (timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyState = await evaluate('document.readyState');
    if (readyState === 'complete') return readyState;
    await delay(250);
  }
  return evaluate('document.readyState');
};

const summarizeEvents = pageEvents => {
  const errors = [];
  const warnings = [];
  for (const event of pageEvents) {
    if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails || {};
      errors.push(`exception: ${details.exception?.description || details.text || 'unknown'}`);
      continue;
    }
    if (event.method === 'Log.entryAdded') {
      const entry = event.params.entry || {};
      const line = `${entry.level || 'log'}: ${entry.text || ''}`;
      if (entry.level === 'error') errors.push(line);
      if (entry.level === 'warning') warnings.push(line);
      continue;
    }
    if (event.method === 'Runtime.consoleAPICalled') {
      const level = event.params.type || 'log';
      const line = (event.params.args || []).map(item => item.value ?? item.description ?? '').join(' ');
      if (level === 'error') errors.push(`console: ${line}`);
      if (level === 'warning' || level === 'warn') warnings.push(`console: ${line}`);
    }
  }
  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)]
  };
};

const inspect = async (label, url, settleMs) => {
  const eventStart = events.length;
  const browserEventStart = browserEvents.length;
  await send('Page.navigate', { url });
  await waitReady();
  const iframeSearchDeadline = Date.now() + 8000;
  let iframeTarget;
  while (!iframeTarget && Date.now() < iframeSearchDeadline) {
    const discovered = await browserSend('Target.getTargets');
    iframeTarget = discovered.targetInfos.find(item =>
      item.targetId !== targetId &&
      item.url.includes('script.googleusercontent.com') &&
      item.url.includes('/userCodeAppPanel')
    );
    if (!iframeTarget) await delay(250);
  }
  let iframeSessionId = '';
  if (iframeTarget) {
    const attached = await browserSend('Target.attachToTarget', {
      targetId: iframeTarget.targetId,
      flatten: true
    });
    iframeSessionId = attached.sessionId;
    await browserSend('Runtime.enable', {}, iframeSessionId);
    await browserSend('Page.enable', {}, iframeSessionId);
    await browserSend('Log.enable', {}, iframeSessionId);
  }
  await delay(settleMs);
  const { frameTree } = await send('Page.getFrameTree');
  const frames = [];
  const collectFrames = (node, depth = 0) => {
    frames.push({ ...node.frame, depth });
    for (const child of node.childFrames || []) collectFrames(child, depth + 1);
  };
  collectFrames(frameTree);
  let contentFrame = [...frames]
    .filter(frame => frame.depth > 0)
    .sort((left, right) => right.depth - left.depth)[0] || frames[0];
  let contextId;
  let contextType = 'default';
  let contentEvaluate;
  let iframeContextCount = 0;
  if (iframeSessionId) {
    contentFrame = { id: iframeTarget.targetId, url: iframeTarget.url, depth: 1 };
    const contexts = browserEvents
      .filter(event => event.sessionId === iframeSessionId && event.method === 'Runtime.executionContextCreated')
      .map(event => event.params.context)
      .filter((context, index, all) => all.findIndex(item => item.id === context.id) === index);
    iframeContextCount = contexts.length;
    let selectedContext;
    for (const candidate of contexts) {
      try {
        const probe = await browserSend('Runtime.evaluate', {
          expression: `(() => ({
            title: document.title,
            url: location.href,
            bodyTextLength: document.body ? document.body.innerText.length : 0,
            htmlLength: document.documentElement ? document.documentElement.outerHTML.length : 0
          }))()`,
          contextId: candidate.id,
          returnByValue: true
        }, iframeSessionId);
        const value = probe.result?.value || {};
        const score = Number(value.bodyTextLength || 0) * 1000 + Number(value.htmlLength || 0);
        if (!selectedContext || score > selectedContext.score) {
          selectedContext = { id: candidate.id, score, ...value };
        }
      } catch {
        // Context may be replaced while the sandbox initializes; ignore stale candidates.
      }
    }
    contextType = selectedContext ? 'oopif-richest-context' : 'oopif-default';
    contentEvaluate = async expression => {
      const result = await browserSend('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        ...(selectedContext ? { contextId: selectedContext.id } : {})
      }, iframeSessionId);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Iframe runtime evaluation failed.');
      }
      return result.result?.value;
    };
  } else {
    contextId = defaultContextsByFrame.get(contentFrame.id);
    if (!contextId) {
      const world = await send('Page.createIsolatedWorld', {
        frameId: contentFrame.id,
        worldName: `codex-inspect-${label}`,
        grantUniveralAccess: true
      });
      contextId = world.executionContextId;
      contextType = 'isolated';
    }
    contentEvaluate = expression => evaluate(expression, contextId);
  }
  const state = await contentEvaluate(`(() => {
    const text = document.body ? document.body.innerText : '';
    const html = document.documentElement.outerHTML;
    const visible = element => Boolean(
      element &&
      element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden' &&
      getComputedStyle(element).display !== 'none'
    );
    return {
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      bodyTextLength: text.length,
      htmlLength: html.length,
      hasGoogleScriptRun: Boolean(window.google && google.script && google.script.run),
      hasHelpdesk: text.includes('IT Helpdesk'),
      hasReportNav: text.includes('แจ้งซ่อม'),
      hasStatusNav: text.includes('ติดตามสถานะ'),
      hasReportForm: text.includes('แจ้งปัญหา IT') && text.includes('ชื่อผู้แจ้ง'),
      reportStillLoading: text.includes('กำลังเตรียมแบบฟอร์มแจ้งซ่อม'),
      hasAdminLogin: text.includes('เข้าสู่ระบบ') && Boolean(document.getElementById('loginEmail')) && Boolean(document.getElementById('loginPassword')),
      loginVisible: visible(document.getElementById('loginOverlay')),
      hasBuildMarker: html.includes('2026.07.21.1-workflow-integration'),
      hasCmdbRenderer: html.includes('function renderCmdb'),
      hasServiceCatalogRenderer: html.includes('function renderServiceCatalog'),
      hasWorkflowRenderer: html.includes('function renderWorkflow'),
      bodyPreview: text.slice(0, 1200)
    };
  })()`);
  let buildInfoRpc;
  if (label === 'public-live' && verifyRelease) {
    try {
      buildInfoRpc = await contentEvaluate(`new Promise(function (resolve) {
        var settled = false;
        var finish = function (payload) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(payload);
        };
        var timer = setTimeout(function () {
          finish({ transportOk: false, error: 'getAppBuildInfo timed out after 30000ms' });
        }, 30000);
        try {
          if (!(window.google && google.script && google.script.run)) {
            finish({ transportOk: false, error: 'google.script.run is unavailable' });
            return;
          }
          google.script.run
            .withSuccessHandler(function (response) {
              finish({ transportOk: true, response: response });
            })
            .withFailureHandler(function (error) {
              finish({
                transportOk: false,
                error: String(error && error.message ? error.message : error || 'unknown transport error')
              });
            })
            .getAppBuildInfo();
        } catch (error) {
          finish({
            transportOk: false,
            error: String(error && error.message ? error.message : error || 'unknown invocation error')
          });
        }
      })`);
    } catch (error) {
      buildInfoRpc = {
        transportOk: false,
        error: error && error.message ? error.message : String(error)
      };
    }
  }
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  });
  const screenshotPath = join(qaRoot, `${label}.png`);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  return {
    label,
    settleMs,
    frameCount: frames.length + (iframeTarget ? 1 : 0),
    iframeContextCount,
    contentFrameUrl: contentFrame.url,
    contextType,
    ...state,
    ...(buildInfoRpc ? { buildInfoRpc } : {}),
    ...summarizeEvents([
      ...events.slice(eventStart),
      ...browserEvents.slice(browserEventStart)
    ]),
    screenshot: screenshotPath
  };
};

let result;
try {
  const publicResult = await inspect('public-live', baseUrl, publicWaitMs);
  const adminResult = await inspect('admin-live', `${baseUrl}?page=admin`, adminWaitMs);
  result = { qaRoot, public: publicResult, admin: adminResult };
} finally {
  ws.close();
  try {
    await browserSend('Browser.close');
  } catch {
    chrome.kill();
  }
  browserWs.close();
}

if (verifyRelease) {
  const failures = [];
  const rpc = result?.public?.buildInfoRpc;
  const response = rpc?.response;
  const envelopeOk = Boolean(
    rpc?.transportOk === true &&
    response && typeof response === 'object' &&
    response.success === true &&
    response.ok === true &&
    response.data && typeof response.data === 'object'
  );
  const data = envelopeOk ? response.data : null;

  if (!rpc) failures.push('getAppBuildInfo RPC result is missing');
  else if (rpc.transportOk !== true) failures.push(`getAppBuildInfo transport failed: ${rpc.error || 'unknown error'}`);
  if (rpc?.transportOk === true && !envelopeOk) failures.push('getAppBuildInfo returned an invalid or unsuccessful response envelope');
  if (data && expectedBuild && data.buildId !== expectedBuild) {
    failures.push(`buildId mismatch: expected ${expectedBuild}, received ${String(data.buildId || '')}`);
  }
  if (data && expectedSchema !== null && data.schemaVersion !== expectedSchema) {
    failures.push(`schemaVersion mismatch: expected ${expectedSchema}, received ${String(data.schemaVersion)}`);
  }
  if (data && expectedSchema !== null && data.installedSchemaVersion !== expectedSchema) {
    failures.push(
      `installedSchemaVersion mismatch: expected ${expectedSchema}, received ${String(data.installedSchemaVersion)}`
    );
  }
  if (data && data.schemaReady !== true) failures.push('physical schema is not ready');
  if (data && (!Array.isArray(data.missingSchema) || data.missingSchema.length !== 0)) {
    failures.push('physical schema reports missing sheets or columns');
  }

  result.releaseVerification = {
    passed: failures.length === 0,
    expected: {
      buildId: expectedBuild || null,
      schemaVersion: expectedSchema
    },
    transportOk: rpc?.transportOk === true,
    envelopeOk,
    physicalSchemaReady: Boolean(
      data && data.schemaReady === true && Array.isArray(data.missingSchema) && data.missingSchema.length === 0
    ),
    actual: data,
    failures
  };
}

console.log(JSON.stringify(result, null, 2));
if (verifyRelease && !result.releaseVerification.passed) process.exitCode = 1;
