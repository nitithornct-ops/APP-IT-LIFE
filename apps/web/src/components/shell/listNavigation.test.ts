import { describe, expect, it } from 'vitest';
import { getListReturnTo } from './listNavigation';

describe('module list return navigation', () => {
  it('keeps the list filters, pagination and ordering when returning from a detail', () => {
    const returnTo = '/assets?status=Active&search=printer&page=3&sort=asset_code&order=asc';
    expect(getListReturnTo({ listReturnTo: returnTo }, '/assets')).toBe(returnTo);
  });

  it('gives a deep link a safe list fallback', () => {
    expect(getListReturnTo(null, '/problems')).toBe('/problems');
    expect(getListReturnTo({ listReturnTo: '/problems' }, '/problems')).toBe('/problems');
  });

  it.each([
    '/assets/other-record', '/assets-borrow', '//example.com', 'https://example.com/assets',
    '/tickets?search=printer', 1, null, {},
  ])('does not follow an unrelated or malformed return destination: %s', (listReturnTo) => {
    expect(getListReturnTo({ listReturnTo }, '/assets')).toBe('/assets');
  });
});
