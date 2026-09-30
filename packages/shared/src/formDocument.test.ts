import { describe, expect, it } from 'vitest';
import { formDocumentHtml } from './formDocument';

describe('formDocumentHtml', () => {
  it('keeps immutable snapshot metadata visible and escaped in exported documents', () => {
    const html = formDocumentHtml('<p>เนื้อหา</p>', 'FRM-001', {
      documentNumber: 'FRM-001',
      sourceModule: 'tickets',
      sourceRecordId: '<record>',
      issuedAt: '2026-09-30T10:00:00.000Z',
      snapshotHash: 'abc123',
    });

    expect(html).toContain('Document metadata');
    expect(html).toContain('FRM-001');
    expect(html).toContain('&lt;record&gt;');
    expect(html).not.toContain('<record>');
    expect(html).toContain('abc123');
  });
});
