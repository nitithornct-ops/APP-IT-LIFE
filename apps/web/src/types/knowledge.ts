export const KNOWLEDGE_STATUSES = ['เผยแพร่', 'ร่าง'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export interface KnowledgeCategoryRef { id: string; name: string }
export interface KnowledgeTaxonomyRef { id: string; code: string; name: string; parent_id: string | null }
export interface KnowledgeAuthorRef { id: string; full_name: string; email: string }
export interface KnowledgeIncidentRef { id: string; incident_number: string; title: string; status: string }
export interface KnowledgeProblemRef { id: string; problem_number: string; title: string; status: string }
export interface KnowledgeKnownErrorRef { id: string; known_error_number: string; title: string; status: string }
export interface KnowledgeServiceRef { id: string; service_code: string; service_name: string; status: string }

export interface KnowledgeArticleVersion {
  id: string;
  article_id: string;
  version_number: number;
  title: string;
  taxonomy_id: string | null;
  symptom: string | null;
  solution: string;
  tags: string[];
  synonyms: string[];
  status: KnowledgeStatus;
  is_deprecated: boolean;
  review_due_date: string | null;
  expiry_date: string | null;
  search_rank: number;
  article_owner_id: string | null;
  reviewer_id: string | null;
  change_note: string | null;
  snapshot_at: string;
}

export interface KnowledgeArticle {
  id: string;
  article_code: string;
  title: string;
  category_id: string | null;
  taxonomy_id: string | null;
  symptom: string | null;
  solution: string;
  tags: string[];
  synonyms: string[];
  status: KnowledgeStatus;
  views_count: number;
  helpful_count: number;
  not_helpful_count: number;
  search_rank: number;
  version_number: number;
  is_deprecated: boolean;
  deprecated_at: string | null;
  deprecated_reason: string | null;
  review_due_date: string | null;
  expiry_date: string | null;
  article_owner_id: string | null;
  reviewer_id: string | null;
  last_change_note: string | null;
  published_at: string | null;
  last_reviewed_at: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
  category: KnowledgeCategoryRef | null;
  taxonomy: KnowledgeTaxonomyRef | null;
  author: KnowledgeAuthorRef | null;
  article_owner: KnowledgeAuthorRef | null;
  reviewer: KnowledgeAuthorRef | null;
  article_incidents: Array<{ incident: KnowledgeIncidentRef | null }>;
  article_problems: Array<{ problem: KnowledgeProblemRef | null }>;
  article_known_errors: Array<{ known_error: KnowledgeKnownErrorRef | null }>;
  article_services: Array<{ service: KnowledgeServiceRef | null }>;
  versions?: KnowledgeArticleVersion[];
  has_voted?: boolean;
}

export interface KnowledgeOverview {
  articles: KnowledgeArticle[];
  categories: KnowledgeCategoryRef[];
  taxonomies: KnowledgeTaxonomyRef[];
  canManage: boolean;
}

export interface KnowledgeReferenceData {
  owners: KnowledgeAuthorRef[];
  reviewers: KnowledgeAuthorRef[];
  taxonomies: KnowledgeTaxonomyRef[];
  incidents: KnowledgeIncidentRef[];
  problems: KnowledgeProblemRef[];
  knownErrors: KnowledgeKnownErrorRef[];
  services: KnowledgeServiceRef[];
}

export interface PublicKnowledgeArticle {
  id: string;
  article_code: string;
  title: string;
  category: string | null;
  symptom: string | null;
  solution: string;
  tags: string[];
  synonyms?: string[];
  views: number;
  helpful: number;
  notHelpful?: number;
  searchRank?: number;
}
