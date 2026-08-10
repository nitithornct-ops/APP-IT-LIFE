import { describe, expect, it } from 'vitest';
import { createKnowledgeArticleSchema, publicKnowledgeViewSchema } from '../src/validators/knowledge';

describe('knowledge validators', () => {
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
});
