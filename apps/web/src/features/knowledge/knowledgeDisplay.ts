import type { KnowledgeArticle } from '../../types/knowledge';

type SearchableKnowledgeArticle = Pick<KnowledgeArticle, 'title' | 'symptom' | 'solution' | 'tags' | 'category'> & {
  synonyms?: string[];
  taxonomy?: { id: string; name: string } | null;
};

export function knowledgeSearchText(article: SearchableKnowledgeArticle): string {
  return [article.title, article.symptom, article.solution, article.tags.join(' '), article.synonyms?.join(' '), article.category?.name, article.taxonomy?.name]
    .filter(Boolean).join(' ').toLocaleLowerCase('th');
}

export function knowledgeMatches(article: SearchableKnowledgeArticle, query: string, categoryId = ''): boolean {
  if (categoryId && article.category?.id !== categoryId && article.taxonomy?.id !== categoryId) return false;
  const normalized = query.trim().toLocaleLowerCase('th');
  return !normalized || knowledgeSearchText(article).includes(normalized);
}

export function helpfulRate(article: Pick<KnowledgeArticle, 'views_count' | 'helpful_count'> & { not_helpful_count?: number }): number {
  const totalFeedback = article.not_helpful_count === undefined
    ? article.views_count
    : (article.helpful_count + article.not_helpful_count) || article.views_count;
  if (!totalFeedback) return 0;
  return Math.min(100, Math.round((article.helpful_count / totalFeedback) * 100));
}

export function normalizeKnowledgeTags(raw: string): string[] {
  return [...new Set(raw.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

export function normalizeKnowledgeSynonyms(raw: string): string[] {
  return [...new Set(raw.split(',').map((item) => item.trim().toLocaleLowerCase('th')).filter(Boolean))].slice(0, 30);
}
