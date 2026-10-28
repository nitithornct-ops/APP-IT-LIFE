import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IntegrationCenterResponse } from '../../types/integrations';
import { IntegrationCenterPanel } from './IntegrationCenterPage';

afterEach(cleanup);

const data: IntegrationCenterResponse = {
  generatedAt: '2026-08-23T08:00:00.000Z', canManage: true,
  retention: { days: 90, scope: 'ลบอัตโนมัติเฉพาะเหตุการณ์ที่จบงานแล้ว ไม่รวม Audit Log และข้อมูลธุรกิจ' },
  summary: { activeChannels: 2, delivered24h: 17, failed24h: 1, outboxWaiting: 1, outboxFailed: 1 },
  outbox: { pending: 1, processing: 0, completed: 12, error: 1, dead: 0, cancelled: 0 },
  channels: [
    { id: 'in-app', name: 'In-app Notification', status: 'degraded', description: 'แจ้งเตือนภายในระบบ', delivered24h: 12, detail: 'มีคิวผิดพลาด 1 รายการ' },
    { id: 'line-messaging', name: 'LINE Messaging API', status: 'active', description: 'แจ้งผู้ร้อง', delivered24h: 5, detail: 'เชื่อมต่อแล้ว' },
    { id: 'webhook', name: 'Generic Webhook', status: 'unavailable', description: 'ยังไม่มี adapter', delivered24h: null, detail: 'เตรียมโครงสร้างคิวแล้ว' },
  ],
  rules: [{ id: 'ticket-status', event: 'สถานะ Ticket เปลี่ยน', channel: 'LINE Messaging API', recipients: 'ผู้แจ้งที่ผูก LINE', status: 'active', managedBy: 'code' }],
  recentEvents: [{ id: 'out-1', source: 'outbox', code: 'INT-001', channel: 'notifications', eventType: 'NOTIFICATION', status: 'ERROR', attempt: '2/5', error: 'temporary failure', occurredAt: '2026-08-23T07:00:00Z', nextAttemptAt: '2026-08-23T09:00:00Z', actions: ['retry', 'cancel'] }],
};

describe('IntegrationCenterPanel', () => {
  it('shows real channel health, code-managed notification rules and actionable outbox failures', () => {
    render(<IntegrationCenterPanel data={data} />);

    expect(screen.getByText('In-app Notification')).toBeInTheDocument();
    expect(screen.getByText('LINE Messaging API', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('Generic Webhook')).toBeInTheDocument();
    expect(screen.getByText('สถานะ Ticket เปลี่ยน')).toBeInTheDocument();
    expect(screen.getByText('INT-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(screen.getByText(/เก็บ 90 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่มีตาราง Notification Rule/)).toBeInTheDocument();
  });

  it('labels database rules as inactive configuration and disables unsupported channels', () => {
    const configured: IntegrationCenterResponse = {
      ...data, templates: [], rules: [{ id: 'rule-1', event: 'ticket.updated', channel: 'In-app Notification', recipients: 'operator', status: 'active', managedBy: 'database' }],
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><IntegrationCenterPanel data={configured} /></QueryClientProvider>);
    expect(screen.getByText('ตั้งค่าไว้ · ยังไม่ทำงาน')).toBeInTheDocument();
    expect(screen.getAllByText(/ยังไม่เชื่อมกับการส่งจริง/).length).toBeGreaterThan(0);
    for (const option of screen.getAllByRole('option', { name: /ยังไม่รองรับ/ })) expect(option).toBeDisabled();
    expect(screen.getAllByRole('option', { name: 'In-app Notification' }).some((option) => !option.hasAttribute('disabled'))).toBe(true);
  });
});
