export const KNOWLEDGE_STATUSES = ['เผยแพร่', 'ร่าง'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export interface KnowledgeCategoryRef { id: string; name: string }
export interface KnowledgeAuthorRef { id: string; full_name: string; email: string }

export interface KnowledgeArticle {
  id: string;
  article_code: string;
  title: string;
  category_id: string | null;
  symptom: string | null;
  solution: string;
  tags: string[];
  status: KnowledgeStatus;
  views_count: number;
  helpful_count: number;
  published_at: string | null;
  last_reviewed_at: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
  category: KnowledgeCategoryRef | null;
  author: KnowledgeAuthorRef | null;
  has_voted?: boolean;
}

export interface KnowledgeOverview {
  articles: KnowledgeArticle[];
  categories: KnowledgeCategoryRef[];
  canManage: boolean;
}

export interface PublicKnowledgeArticle {
  id: string;
  article_code: string;
  title: string;
  category: string | null;
  symptom: string | null;
  solution: string;
  tags: string[];
  views: number;
  helpful: number;
}
