import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateBuildBudgets,
  extractEntryAssets,
  formatBytes,
  isLazyJsBudgetCandidate,
} from './check-build-budgets.mjs';

describe('build budgets', () => {
  it('accepts measurements at or below their limits', () => {
    assert.deepEqual(evaluateBuildBudgets({ entry: 100, lazy: 200 }, { entry: 100, lazy: 250 }), []);
  });

  it('reports every measurement above its limit', () => {
    const failures = evaluateBuildBudgets({ entry: 101, lazy: 251 }, { entry: 100, lazy: 250 });
    assert.equal(failures.length, 2);
    assert.match(failures[0], /entry/);
    assert.match(failures[1], /lazy/);
  });

  it('formats KiB and MiB for readable CI output', () => {
    assert.equal(formatBytes(20 * 1024), '20.0 KiB');
    assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MiB');
  });

  it('does not mistake module preloads for the entry script', () => {
    const html = [
      '<script type="module" src="/assets/index-123.js"></script>',
      '<link rel="modulepreload" href="/assets/vendor-123.js">',
      '<link rel="stylesheet" href="/assets/index-123.css">',
    ].join('\n');
    assert.deepEqual(extractEntryAssets(html), {
      entryJs: ['assets/index-123.js'],
      entryCss: ['assets/index-123.css'],
    });
  });

  it('budgets copied worker assets as raw assets instead of lazy app chunks', () => {
    assert.equal(isLazyJsBudgetCandidate('ReportPage-123.js', 'index-123.js'), true);
    assert.equal(isLazyJsBudgetCandidate('index-123.js', 'index-123.js'), false);
    assert.equal(isLazyJsBudgetCandidate('pdf.worker.min-123.mjs', 'index-123.js'), false);
  });
});
