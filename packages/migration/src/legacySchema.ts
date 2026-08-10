/**
 * Parse the DB_SCHEMA object in legacy-gas/Config.gs without executing Apps Script.
 * The schema contains only unquoted property names and arrays of quoted strings.
 */
export function parseLegacySchema(source: string): Record<string, string[]> {
  const marker = 'const DB_SCHEMA = {';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('DB_SCHEMA declaration was not found');

  const bodyStart = start + marker.length;
  const bodyEnd = findObjectEnd(source, bodyStart);
  const body = source.slice(bodyStart, bodyEnd);
  const schema: Record<string, string[]> = {};
  const entryPattern = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*\[([\s\S]*?)\]\s*,?/gm;

  for (const match of body.matchAll(entryPattern)) {
    const columns: string[] = [];
    const arrayBody = match[2] ?? '';
    const stringPattern = /(['"])((?:\\.|(?!\1).)*)\1/g;
    for (const columnMatch of arrayBody.matchAll(stringPattern)) {
      columns.push((columnMatch[2] ?? '').replace(/\\(['"\\])/g, '$1'));
    }
    schema[match[1]!] = columns;
  }

  if (Object.keys(schema).length === 0) throw new Error('DB_SCHEMA contains no parsable sheets');
  return schema;
}

function findObjectEnd(source: string, bodyStart: number): number {
  let depth = 1;
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('DB_SCHEMA closing brace was not found');
}
