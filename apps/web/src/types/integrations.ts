export type IntegrationStatus = 'active' | 'disabled' | 'incomplete' | 'unavailable' | 'degraded';

export interface IntegrationChannel {
  id: string;
  name: string;
  status: IntegrationStatus;
  description: string;
  delivered24h: number | null;
  detail: string;
}

export interface IntegrationRule {
  id: string;
  event: string;
  channel: string;
  recipients: string;
  status: IntegrationStatus;
  managedBy: 'code';
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
}
