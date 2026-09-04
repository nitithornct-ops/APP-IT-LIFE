import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const workflowDirectory = new URL('../.github/workflows/', import.meta.url);
const files = (await readdir(workflowDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && ['.yml', '.yaml'].includes(extname(entry.name)))
  .map((entry) => entry.name);

const unpinned = [];
let externalActionCount = 0;
for (const file of files) {
  const source = await readFile(new URL(file, workflowDirectory), 'utf8');
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = line.match(/\buses:\s*([^\s#]+)@([^\s#]+)/);
    if (!match || match[1].startsWith('./')) continue;
    externalActionCount += 1;
    if (!/^[0-9a-f]{40}$/.test(match[2])) unpinned.push(`${join('.github', 'workflows', file)}:${index + 1} (${match[0]})`);
  }
}

if (externalActionCount === 0) {
  console.error('GitHub Actions pin gate failed: no external actions were found.');
  process.exit(1);
}
if (unpinned.length > 0) {
  console.error(`GitHub Actions pin gate failed:\n${unpinned.join('\n')}`);
  process.exit(1);
}
console.log(`GitHub Actions pin gate passed: ${externalActionCount} references use full commit SHAs.`);
