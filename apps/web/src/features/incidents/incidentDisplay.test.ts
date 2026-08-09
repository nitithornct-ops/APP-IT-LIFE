import { describe, expect, it } from 'vitest';
import { riskCellClass, riskTone } from './incidentDisplay';

describe('Incident risk display', () => {
  it('uses the four legacy risk bands at 4/9/14/25 boundaries', () => {
    expect(riskCellClass(4)).toContain('emerald');
    expect(riskCellClass(9)).toContain('amber');
    expect(riskCellClass(14)).toContain('orange');
    expect(riskCellClass(25)).toContain('red');
  });

  it('renders high and critical risk as danger badges', () => {
    expect(riskTone['สูง']).toBe('danger');
    expect(riskTone['วิกฤต']).toBe('danger');
  });
});
