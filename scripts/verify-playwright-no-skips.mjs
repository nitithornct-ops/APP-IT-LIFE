import { readFile } from 'node:fs/promises';

const resultPath = process.argv[2];
if (!resultPath) {
  console.error('Playwright result verification failed: a JSON result path is required.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(await readFile(resultPath, 'utf8'));
} catch (error) {
  console.error(`Playwright result verification failed: could not read ${resultPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let total = 0;
const skipped = [];

function inspectSuite(suite, parents = []) {
  const path = suite.title ? [...parents, suite.title] : parents;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      total += 1;
      const wasSkipped = test.expectedStatus === 'skipped'
        || (test.results ?? []).some((result) => result.status === 'skipped');
      if (wasSkipped) skipped.push([...path, spec.title, test.projectName].filter(Boolean).join(' > '));
    }
  }
  for (const child of suite.suites ?? []) inspectSuite(child, path);
}

for (const suite of report.suites ?? []) inspectSuite(suite);
if (total === 0) {
  console.error('Playwright result verification failed: the report contains no tests.');
  process.exit(1);
}
if (skipped.length > 0) {
  console.error(`Playwright result verification failed: ${skipped.length} test(s) were skipped:\n${skipped.join('\n')}`);
  process.exit(1);
}

console.log(`Playwright result verification passed: ${total} tests, 0 skipped.`);
