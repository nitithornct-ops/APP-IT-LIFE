import { describe, expect, it } from 'vitest';
import { renderAssetBorrowForm } from '../src/services/assetBorrowForm';

describe('asset borrowing master form', () => {
  it('fills the persisted borrower and asset, escaping input and leaving missing fields blank', () => {
    const html = renderAssetBorrowForm('<p>{{asset_code}} {{asset_name}} {{borrower_name}} {{department}} {{due_date}} {{unknown}}</p>', {
      asset_code: 'NB-001', name: '<script>alert(1)</script>', loan_date: null, loan_due_date: null, location: null,
      owner: { first_name_th: 'สมชาย', last_name_th: 'ใจดี', employee_code: 'EMP-1' }, department: null,
    });
    expect(html).toContain('NB-001');
    expect(html).toContain('สมชาย ใจดี');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('{{');
    expect(html).toContain('— — —');
  });
});
