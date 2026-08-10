import type { KnowledgeArticle } from '../../types/knowledge';

export function knowledgeSearchText(article: Pick<KnowledgeArticle, 'title' | 'symptom' | 'solution' | 'tags' | 'category'>): string {
  return [article.title, article.symptom, article.solution, article.tags.join(' '), article.category?.name]
    .filter(Boolean).join(' ').toLocaleLowerCase('th');
}

export function knowledgeMatches(article: Pick<KnowledgeArticle, 'title' | 'symptom' | 'solution' | 'tags' | 'category'>, query: string, categoryId = ''): boolean {
  if (categoryId && article.category?.id !== categoryId) return false;
  const normalized = query.trim().toLocaleLowerCase('th');
  return !normalized || knowledgeSearchText(article).includes(normalized);
}

export function helpfulRate(article: Pick<KnowledgeArticle, 'views_count' | 'helpful_count'>): number {
  if (!article.views_count) return 0;
  return Math.min(100, Math.round((article.helpful_count / article.views_count) * 100));
}

export function normalizeKnowledgeTags(raw: string): string[] {
  return [...new Set(raw.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}
