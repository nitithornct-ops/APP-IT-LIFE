import { beforeEach, describe, expect, it } from 'vitest';
import { DENSITY_KEY, initializeDensity, readDensity, setDensity } from './density';

describe('density preference', () => {
  beforeEach(() => { localStorage.clear(); initializeDensity(); });
  it('validates saved values and defaults to standard', () => {
    localStorage.setItem(DENSITY_KEY, 'unexpected');
    expect(readDensity()).toBe('standard');
    initializeDensity();
    expect(document.documentElement.dataset.density).toBe('standard');
  });
  it('persists spacing independently of text size', () => {
    document.documentElement.style.setProperty('--font-scale', '1.2');
    setDensity('compact');
    expect(readDensity()).toBe('compact');
    expect(document.documentElement.dataset.density).toBe('compact');
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.2');
    initializeDensity();
    expect(document.documentElement.dataset.density).toBe('compact');
  });
});
