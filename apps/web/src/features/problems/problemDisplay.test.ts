import { describe, expect, it } from 'vitest';
import { knownErrorStatusTone, priorityTone, problemStatusTone } from './problemDisplay';

describe('Problem display mappings', () => {
  it('maps active and closed Problem statuses', () => {
    expect(problemStatusTone['กำลังวิเคราะห์']).toBe('warning');
    expect(problemStatusTone['ปิด']).toBe('success');
  });

  it('maps critical priority and published Known Error', () => {
    expect(priorityTone['วิกฤต']).toBe('danger');
    expect(knownErrorStatusTone['เผยแพร่']).toBe('info');
  });
});
