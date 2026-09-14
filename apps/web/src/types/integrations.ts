export type IntegrationStatus = 'active' | 'disabled' | 'incomplete' | 'unavailable' | 'degraded';

export interface IntegrationChannel {
  id: string;
  name: string;
  status: IntegrationStatus;
  description: string;
  delivered24h: number | null;
  detail: string;
  testable?: boolean;
  secretReference?: string | null;
  webhookSigningEnabled?: boolean;
  idempotencyEnabled?: boolean;
  rateLimitPerMinute?: number | null;
  latencyMs?: number | null;
  lastSuccessfulDeliveryAt?: string | null;
  lastTestedAt?: string | null;
  lastTestStatus?: string | null;
  lastTestError?: string | null;
}

export interface IntegrationRule {
  id: string;
  event: string;
  channel: string;
  recipients: string;
  status: IntegrationStatus;
  managedBy: 'code' | 'database';
  ruleCode?: string;
  module?: string;
  severity?: string;
  channelKey?: string;
  template?: string | null;
  enabled?: boolean;
  quietHours?: Record<string, unknown>;
  retryPolicy?: Record<string, unknown>;
  fallbackChannel?: string | null;
  escalationAfterMinutes?: number | null;
  escalationRecipient?: string | null;
  priority?: number;
}

export interface NotificationTemplate {
  id: string;
  template_key: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  version: number;
  status: string;
}

export interface IntegrationEvent {
  id: string;
  source: 'outbox' | 'line';
  code: string;
  channel: string;
  eventType: string;
  status: string;
  attempt: string;
  error: string | null;
  occurredAt: string;
  nextAttemptAt: string | null;
  actions: string[];
}

export interface IntegrationCenterResponse {
  generatedAt: string;
  canManage: boolean;
  retention: {
    days: number;
    scope: string;
  };
  summary: {
    activeChannels: number;
    delivered24h: number;
    failed24h: number;
    outboxWaiting: number;
    outboxFailed: number;
  };
  outbox: {
    pending: number;
    processing: number;
    completed: number;
    error: number;
    dead: number;
    cancelled: number;
  };
  channels: IntegrationChannel[];
  rules: IntegrationRule[];
  recentEvents: IntegrationEvent[];
  templates?: NotificationTemplate[];
  observability?: {
    idempotency: string;
    deadLetterCount: number;
    configuredChannels: number;
  };
}
