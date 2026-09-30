import { describe, expect, it } from 'vitest';
import { sortNewestFirst } from './recordOrder';

describe('sortNewestFirst', () => {
  it('sorts valid timestamps without mutating the source array', () => {
    const items = [
      { id: 'old', created_at: '2026-01-01T00:00:00Z' },
      { id: 'new', created_at: '2026-02-01T00:00:00Z' },
    ];

    expect(sortNewestFirst(items).map((item) => item.id)).toEqual(['new', 'old']);
    expect(items.map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('places missing and invalid timestamps last', () => {
    const items = [
      { id: 'missing', created_at: null },
      { id: 'invalid', created_at: 'not-a-date' },
      { id: 'valid', created_at: '2026-02-01T00:00:00Z' },
    ];

    expect(sortNewestFirst(items).map((item) => item.id)).toEqual(['valid', 'missing', 'invalid']);
  });
});
