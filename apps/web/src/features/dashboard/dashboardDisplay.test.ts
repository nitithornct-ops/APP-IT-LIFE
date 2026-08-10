import { describe, expect, it } from 'vitest';
import { dashboardBarWidth, dashboardDueLabel, dashboardToneForDue } from './dashboardDisplay';

describe('dashboard display helpers', () => {
  it('describes overdue, today and upcoming dates', () => {
    expect(dashboardDueLabel(-3)).toBe('เกิน 3 วัน');
    expect(dashboardDueLabel(0)).toBe('วันนี้');
    expect(dashboardDueLabel(12)).toBe('อีก 12 วัน');
  });

  it('maps due urgency to a visual tone', () => {
    expect(dashboardToneForDue(-1)).toBe('danger');
    expect(dashboardToneForDue(7)).toBe('amber');
    expect(dashboardToneForDue(8)).toBe('primary');
  });

  it('normalizes bars and keeps zero values visible', () => {
    expect(dashboardBarWidth(5, [5, 10])).toBe(50);
    expect(dashboardBarWidth(0, [5, 10])).toBe(4);
  });
});
