import { describe, expect, it } from 'vitest';
import { createKnowledgeArticleSchema, notHelpfulSchema, publicKnowledgeViewSchema, updateKnowledgeArticleSchema } from '../src/validators/knowledge';

const id = '00000000-0000-4000-8000-000000000001';

describe('Knowledge Base governance validators', () => {
  it('accepts a valid article and normalizes duplicate tags', () => {
    const result = createKnowledgeArticleSchema.parse({ title: 'แก้ Wi-Fi', solution: 'Restart adapter', tags: ['WiFi', 'wifi'], status: 'เผยแพร่' });
    expect(result.tags).toEqual(['wifi']);
  });

  it('requires a title and solution', () => {
    expect(createKnowledgeArticleSchema.safeParse({ title: '', solution: '', tags: [] }).success).toBe(false);
  });

  it('limits article tags', () => {
    expect(createKnowledgeArticleSchema.safeParse({ title: 'KB', solution: 'Fix', tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`) }).success).toBe(false);
  });

  it('accepts only a safe public client identifier', () => {
    expect(publicKnowledgeViewSchema.safeParse({ clientId: 'public-client-1234' }).success).toBe(true);
    expect(publicKnowledgeViewSchema.safeParse({ clientId: '<script>alert(1)</script>' }).success).toBe(false);
  });

  it('accepts governance metadata, synonyms and cross-module links', () => {
    const result = createKnowledgeArticleSchema.safeParse({
      title: 'แก้ปัญหา Wi-Fi',
      taxonomyId: id,
      solution: 'เปิดอะแดปเตอร์ใหม่',
      synonyms: ['wifi', 'wi-fi', 'wireless'],
      articleOwnerId: id,
      reviewerId: id,
      reviewDueDate: '2026-12-01',
      expiryDate: '2027-01-01',
      searchRank: 80,
      incidentIds: [id],
      problemIds: [id],
      knownErrorIds: [id],
      serviceIds: [id],
      status: 'ร่าง',
    });
    expect(result.success).toBe(true);
  });

  it('requires a reason for Deprecated and keeps it out of Published', () => {
    expect(updateKnowledgeArticleSchema.safeParse({ title: 'บทความ', solution: 'วิธีแก้', isDeprecated: true, status: 'ร่าง' }).success).toBe(false);
    expect(updateKnowledgeArticleSchema.safeParse({ title: 'บทความ', solution: 'วิธีแก้', isDeprecated: true, deprecatedReason: 'แทนที่ด้วยคู่มือใหม่', status: 'เผยแพร่' }).success).toBe(false);
    expect(updateKnowledgeArticleSchema.safeParse({ title: 'บทความ', solution: 'วิธีแก้', isDeprecated: true, deprecatedReason: 'แทนที่ด้วยคู่มือใหม่', status: 'ร่าง' }).success).toBe(true);
  });

  it('accepts only a known not-helpful reason', () => {
    expect(notHelpfulSchema.safeParse({ reason: 'ข้อมูลล้าสมัย' }).success).toBe(true);
    expect(notHelpfulSchema.safeParse({ reason: '' }).success).toBe(false);
  });
});
