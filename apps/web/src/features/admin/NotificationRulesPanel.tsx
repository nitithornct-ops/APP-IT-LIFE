import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, ShieldCheck, ToggleLeft, ToggleRight, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { IntegrationCenterResponse, IntegrationRule, NotificationTemplate } from '../../types/integrations';

const CHANNELS = [
  { value: 'in-app', label: 'In-app Notification' },
  { value: 'line-messaging', label: 'LINE Messaging API' },
  { value: 'smtp', label: 'SMTP / Email' },
  { value: 'teams', label: 'Microsoft Teams' },
  { value: 'webhook', label: 'Generic Webhook' },
] as const;

const fieldClass = 'mt-1 min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ';
}

function channelName(value: string): string {
  return CHANNELS.find((channel) => channel.value === value)?.label ?? value;
}

function severityVariant(value?: string): 'success' | 'warning' | 'danger' | 'secondary' {
  if (value === 'CRITICAL' || value === 'ERROR') return 'danger';
  if (value === 'WARNING') return 'warning';
  if (value === 'INFO') return 'success';
  return 'secondary';
}

export function NotificationRulesPanel({ data }: { data: IntegrationCenterResponse }) {
  const queryClient = useQueryClient();
  const templates = data.templates ?? [];
  const [ruleForm, setRuleForm] = useState({
    ruleCode: '', eventKey: '', moduleKey: '', severity: 'INFO', channel: 'in-app', recipient: '', templateId: '',
    fallbackChannel: '', escalationAfterMinutes: '', escalationRecipient: '', priority: '100',
    quietEnabled: false, quietStart: '22:00', quietEnd: '07:00', retryAttempts: '5', retryBackoffSeconds: '60',
  });
  const [templateForm, setTemplateForm] = useState({ templateKey: '', name: '', channel: 'in-app', subject: '', body: '', variables: '' });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'integration-center'] });
  };
  const createRule = useMutation({
    mutationFn: () => apiFetch<IntegrationRule>('/api/v1/integrations/rules', {
      method: 'POST',
      body: JSON.stringify({
        ruleCode: ruleForm.ruleCode.trim(), eventKey: ruleForm.eventKey.trim(), moduleKey: ruleForm.moduleKey.trim(),
        severity: ruleForm.severity, channel: ruleForm.channel, recipient: ruleForm.recipient.trim(),
        templateId: ruleForm.templateId || null, fallbackChannel: ruleForm.fallbackChannel || null,
        escalationAfterMinutes: ruleForm.escalationAfterMinutes ? Number(ruleForm.escalationAfterMinutes) : null,
        escalationRecipient: ruleForm.escalationRecipient.trim() || null, priority: Number(ruleForm.priority),
        quietHours: { enabled: ruleForm.quietEnabled, start: ruleForm.quietStart, end: ruleForm.quietEnd, timezone: 'Asia/Bangkok' },
        retryPolicy: { maxAttempts: Number(ruleForm.retryAttempts), backoffSeconds: Number(ruleForm.retryBackoffSeconds) },
      }),
    }),
    onSuccess: async () => {
      setRuleForm((current) => ({ ...current, ruleCode: '', eventKey: '', moduleKey: '', recipient: '', templateId: '', fallbackChannel: '', escalationAfterMinutes: '', escalationRecipient: '' }));
      await refresh();
    },
  });
  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => apiFetch<IntegrationRule>(`/api/v1/integrations/rules/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    onSuccess: refresh,
  });
  const createTemplate = useMutation({
    mutationFn: () => apiFetch<NotificationTemplate>('/api/v1/integrations/templates', {
      method: 'POST',
      body: JSON.stringify({
        templateKey: templateForm.templateKey.trim(), name: templateForm.name.trim(), channel: templateForm.channel,
        subject: templateForm.subject.trim() || null, body: templateForm.body, variables: templateForm.variables.split(',').map((item) => item.trim()).filter(Boolean), version: 1, status: 'DRAFT',
      }),
    }),
    onSuccess: async () => {
      setTemplateForm({ templateKey: '', name: '', channel: 'in-app', subject: '', body: '', variables: '' });
      await refresh();
    },
  });
  const retireTemplate = useMutation({
    mutationFn: (template: NotificationTemplate) => apiFetch<NotificationTemplate>(`/api/v1/integrations/templates/${template.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'RETIRED' }) }),
    onSuccess: refresh,
  });

  const channelTemplates = templates.filter((template) => template.channel === ruleForm.channel && template.status !== 'RETIRED');
  const databaseRules = data.rules.filter((rule) => rule.managedBy === 'database');
  const canCreateRule = data.canManage && ruleForm.ruleCode.trim() && ruleForm.eventKey.trim() && ruleForm.moduleKey.trim() && ruleForm.recipient.trim() && !createRule.isPending;
  const canCreateTemplate = data.canManage && templateForm.templateKey.trim() && templateForm.name.trim() && templateForm.body.trim() && !createTemplate.isPending;

  return (
    <div className="space-y-4" data-testid="notification-rules-panel">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary-600" />Notification Rules</span><Badge variant="secondary">{databaseRules.length} database-managed rules</Badge></CardHeader>
        <CardBody>
          {data.canManage && <form className="rounded-xl border border-primary-100 bg-primary-50/40 p-3 dark:border-primary-900 dark:bg-primary-950/20" onSubmit={(event) => { event.preventDefault(); createRule.mutate(); }}>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100"><Plus className="h-4 w-4 text-primary-600" />เพิ่มกฎใหม่</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-[11px] font-semibold">Rule code<input className={fieldClass} value={ruleForm.ruleCode} onChange={(event) => setRuleForm({ ...ruleForm, ruleCode: event.target.value })} placeholder="backup-failed-critical" /></label>
              <label className="text-[11px] font-semibold">Event<input className={fieldClass} value={ruleForm.eventKey} onChange={(event) => setRuleForm({ ...ruleForm, eventKey: event.target.value })} placeholder="backup.failed" /></label>
              <label className="text-[11px] font-semibold">Module<input className={fieldClass} value={ruleForm.moduleKey} onChange={(event) => setRuleForm({ ...ruleForm, moduleKey: event.target.value })} placeholder="backup_monitoring" /></label>
              <label className="text-[11px] font-semibold">Severity<select className={fieldClass} value={ruleForm.severity} onChange={(event) => setRuleForm({ ...ruleForm, severity: event.target.value })}><option>INFO</option><option>WARNING</option><option>ERROR</option><option>CRITICAL</option></select></label>
              <label className="text-[11px] font-semibold">Channel<select className={fieldClass} value={ruleForm.channel} onChange={(event) => setRuleForm({ ...ruleForm, channel: event.target.value, templateId: '' })}>{CHANNELS.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}</select></label>
              <label className="text-[11px] font-semibold">Recipient<input className={fieldClass} value={ruleForm.recipient} onChange={(event) => setRuleForm({ ...ruleForm, recipient: event.target.value })} placeholder="LINE group: IT" /></label>
              <label className="text-[11px] font-semibold">Template<select className={fieldClass} value={ruleForm.templateId} onChange={(event) => setRuleForm({ ...ruleForm, templateId: event.target.value })}><option value="">No template</option>{channelTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version}</option>)}</select></label>
              <label className="text-[11px] font-semibold">Fallback channel<select className={fieldClass} value={ruleForm.fallbackChannel} onChange={(event) => setRuleForm({ ...ruleForm, fallbackChannel: event.target.value })}><option value="">None</option>{CHANNELS.filter((channel) => channel.value !== ruleForm.channel).map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}</select></label>
              <label className="text-[11px] font-semibold">Escalate after (min)<input type="number" min={1} max={10080} className={fieldClass} value={ruleForm.escalationAfterMinutes} onChange={(event) => setRuleForm({ ...ruleForm, escalationAfterMinutes: event.target.value })} placeholder="15" /></label>
              <label className="text-[11px] font-semibold">Escalation recipient<input className={fieldClass} value={ruleForm.escalationRecipient} onChange={(event) => setRuleForm({ ...ruleForm, escalationRecipient: event.target.value })} placeholder="Manager" /></label>
              <label className="text-[11px] font-semibold">Retry attempts<input type="number" min={1} max={20} className={fieldClass} value={ruleForm.retryAttempts} onChange={(event) => setRuleForm({ ...ruleForm, retryAttempts: event.target.value })} /></label>
              <label className="text-[11px] font-semibold">Backoff seconds<input type="number" min={1} max={86400} className={fieldClass} value={ruleForm.retryBackoffSeconds} onChange={(event) => setRuleForm({ ...ruleForm, retryBackoffSeconds: event.target.value })} /></label>
              <label className="text-[11px] font-semibold">Priority<input type="number" min={0} max={9999} className={fieldClass} value={ruleForm.priority} onChange={(event) => setRuleForm({ ...ruleForm, priority: event.target.value })} /></label>
              <label className="flex items-end gap-2 pb-2 text-[11px] font-semibold"><input type="checkbox" checked={ruleForm.quietEnabled} onChange={(event) => setRuleForm({ ...ruleForm, quietEnabled: event.target.checked })} />Quiet hours</label>
            </div>
            {ruleForm.quietEnabled && <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-[11px] font-semibold">Quiet start<input type="time" className={fieldClass} value={ruleForm.quietStart} onChange={(event) => setRuleForm({ ...ruleForm, quietStart: event.target.value })} /></label><label className="text-[11px] font-semibold">Quiet end<input type="time" className={fieldClass} value={ruleForm.quietEnd} onChange={(event) => setRuleForm({ ...ruleForm, quietEnd: event.target.value })} /></label></div>}
            <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="submit" size="sm" isLoading={createRule.isPending} disabled={!canCreateRule}><Save className="h-3.5 w-3.5" />บันทึกกฎ</Button>{createRule.isError && <span className="text-xs text-danger-700" role="alert">{errorMessage(createRule.error)}</span>}</div>
          </form>}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 dark:bg-slate-900/50"><tr><th className="px-3 py-2">Event / module</th><th className="px-3 py-2">Severity</th><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Template / route</th><th className="px-3 py-2">State</th></tr></thead>
              <tbody>{databaseRules.map((rule) => <RuleRow key={rule.id} rule={rule} canManage={data.canManage} pending={toggleRule.isPending} onToggle={(enabled) => toggleRule.mutate({ id: rule.id, enabled })} />)}</tbody>
            </table>
            {!databaseRules.length && <p className="py-8 text-center text-xs text-slate-500">ยังไม่มีกฎในฐานข้อมูล</p>}
          </div>
          {toggleRule.isError && <p className="mt-2 text-xs text-danger-700" role="alert">{errorMessage(toggleRule.error)}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><Save className="h-4 w-4 text-primary-600" />Template Management</span><Badge variant="secondary">{templates.length} templates</Badge></CardHeader>
        <CardBody>
          {data.canManage && <form className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); createTemplate.mutate(); }}>
            <label className="text-[11px] font-semibold">Template key<input className={fieldClass} value={templateForm.templateKey} onChange={(event) => setTemplateForm({ ...templateForm, templateKey: event.target.value })} placeholder="incident-critical-line" /></label>
            <label className="text-[11px] font-semibold">Name<input className={fieldClass} value={templateForm.name} onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })} placeholder="Incident critical - LINE" /></label>
            <label className="text-[11px] font-semibold">Channel<select className={fieldClass} value={templateForm.channel} onChange={(event) => setTemplateForm({ ...templateForm, channel: event.target.value })}>{CHANNELS.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}</select></label>
            <label className="text-[11px] font-semibold">Subject<input className={fieldClass} value={templateForm.subject} onChange={(event) => setTemplateForm({ ...templateForm, subject: event.target.value })} placeholder="Optional email subject" /></label>
            <label className="text-[11px] font-semibold sm:col-span-2 lg:col-span-3">Body<textarea rows={2} className={fieldClass} value={templateForm.body} onChange={(event) => setTemplateForm({ ...templateForm, body: event.target.value })} placeholder="ใช้ {{variable}} สำหรับข้อมูลจาก event" /></label>
            <label className="text-[11px] font-semibold">Variables<input className={fieldClass} value={templateForm.variables} onChange={(event) => setTemplateForm({ ...templateForm, variables: event.target.value })} placeholder="ticket_no,title,status" /></label>
            <div className="flex items-end"><Button type="submit" size="sm" isLoading={createTemplate.isPending} disabled={!canCreateTemplate}><Plus className="h-3.5 w-3.5" />สร้าง Template</Button></div>
          </form>}
          {createTemplate.isError && <p className="mt-2 text-xs text-danger-700" role="alert">{errorMessage(createTemplate.error)}</p>}
          <ul className="mt-3 space-y-2">{templates.map((template) => <li key={template.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"><div className="min-w-0 flex-1"><span className="font-semibold text-slate-800 dark:text-slate-100">{template.name}</span><span className="ml-2 font-mono text-[10px] text-slate-400">{template.template_key} v{template.version}</span><p className="mt-0.5 truncate text-slate-500">{channelName(template.channel)} · {template.variables.length} variables · {template.status}</p></div>{data.canManage && template.status !== 'RETIRED' && <Button size="sm" variant="outline" disabled={retireTemplate.isPending} onClick={() => retireTemplate.mutate(template)}><XCircle className="h-3.5 w-3.5" />Retire</Button>}</li>)}</ul>
          {retireTemplate.isError && <p className="mt-2 text-xs text-danger-700" role="alert">{errorMessage(retireTemplate.error)}</p>}
        </CardBody>
      </Card>

      {data.observability && <Card><CardHeader>Delivery controls</CardHeader><CardBody className="grid gap-2 text-xs sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900"><p className="text-slate-400">Idempotency</p><p className="mt-1 font-mono font-semibold">{data.observability.idempotency}</p></div><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900"><p className="text-slate-400">Open Dead Letter Queue</p><p className="mt-1 font-mono text-lg font-bold">{data.observability.deadLetterCount}</p></div><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900"><p className="text-slate-400">Configured channels</p><p className="mt-1 font-mono text-lg font-bold">{data.observability.configuredChannels}</p></div></CardBody></Card>}
    </div>
  );
}

function RuleRow({ rule, canManage, pending, onToggle }: { rule: IntegrationRule; canManage: boolean; pending: boolean; onToggle: (enabled: boolean) => void }) {
  const enabled = rule.enabled !== false;
  const route = [rule.fallbackChannel && `fallback: ${rule.fallbackChannel}`, rule.escalationAfterMinutes && `escalate ${rule.escalationAfterMinutes}m → ${rule.escalationRecipient}`].filter(Boolean).join(' · ');
  return <tr className="border-t border-slate-100 align-top dark:border-white/[.07]"><td className="px-3 py-3"><p className="font-mono font-semibold text-primary-700 dark:text-primary-300">{rule.event}</p><p className="mt-0.5 text-slate-400">{rule.module}</p><p className="mt-0.5 font-mono text-[10px] text-slate-400">{rule.ruleCode}</p></td><td className="px-3 py-3"><Badge variant={severityVariant(rule.severity)}>{rule.severity}</Badge></td><td className="px-3 py-3">{rule.channel}</td><td className="px-3 py-3 text-slate-600 dark:text-slate-300">{rule.recipients}</td><td className="px-3 py-3 text-slate-500"><p>{rule.template ?? 'No template'}</p>{route && <p className="mt-1 text-[10px]">{route}</p>}</td><td className="px-3 py-3"><div className="flex items-center gap-2"><Badge variant={enabled ? 'success' : 'secondary'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>{canManage && <Button size="sm" variant="ghost" aria-label={`${enabled ? 'Disable' : 'Enable'} ${rule.ruleCode ?? rule.event}`} disabled={pending} onClick={() => onToggle(!enabled)}>{enabled ? <ToggleRight className="h-4 w-4 text-success-600" /> : <ToggleLeft className="h-4 w-4 text-slate-400" />}</Button>}</div></td></tr>;
}
