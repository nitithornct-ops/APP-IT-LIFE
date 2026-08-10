import { describe, expect, it } from 'vitest';
import { helpfulRate, knowledgeMatches, normalizeKnowledgeTags } from './knowledgeDisplay';

const article = { title: 'แก้ปัญหา Wi-Fi', symptom: 'ต่ออินเทอร์เน็ตไม่ได้', solution: 'เปิดอะแดปเตอร์ใหม่', tags: ['network', 'wifi'], category: { id: 'cat-1', name: 'Network' } };

describe('knowledge display helpers', () => {
  it('searches across title, symptom, solution, tags and category', () => {
    expect(knowledgeMatches(article, 'wifi')).toBe(true);
    expect(knowledgeMatches(article, 'อินเทอร์เน็ต', 'cat-1')).toBe(true);
    expect(knowledgeMatches(article, 'wifi', 'cat-2')).toBe(false);
  });

  it('calculates a bounded helpful rate', () => {
    expect(helpfulRate({ views_count: 10, helpful_count: 7 })).toBe(70);
    expect(helpfulRate({ views_count: 0, helpful_count: 0 })).toBe(0);
    expect(helpfulRate({ views_count: 1, helpful_count: 2 })).toBe(100);
  });

  it('normalizes and deduplicates comma-separated tags', () => {
    expect(normalizeKnowledgeTags('wifi, network, wifi,  ')).toEqual(['wifi', 'network']);
  });
});
