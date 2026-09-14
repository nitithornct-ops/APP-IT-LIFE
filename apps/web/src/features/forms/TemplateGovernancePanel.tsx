import { FileCheck2, ShieldCheck } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import type { FormAcknowledgementConfig, FormApprovalSignatureConfig, FormDocumentNumberRule } from '../../types/forms';

const fieldClass = 'mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

interface TemplateGovernancePanelProps {
  acknowledgementConfig: FormAcknowledgementConfig;
  approvalSignatureConfig: FormApprovalSignatureConfig;
  documentNumberRule: FormDocumentNumberRule;
  onChange: (value: { acknowledgementConfig: FormAcknowledgementConfig; approvalSignatureConfig: FormApprovalSignatureConfig; documentNumberRule: FormDocumentNumberRule }) => void;
  readOnly?: boolean;
}

export function TemplateGovernancePanel({ acknowledgementConfig, approvalSignatureConfig, documentNumberRule, onChange, readOnly = false }: TemplateGovernancePanelProps) {
  return <Card data-testid="template-governance-panel">
    <CardHeader className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary-600" />Document Governance</CardHeader>
    <CardBody className="grid gap-4 md:grid-cols-3">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={acknowledgementConfig.enabled} disabled={readOnly} onChange={(event) => onChange({ acknowledgementConfig: { ...acknowledgementConfig, enabled: event.target.checked }, approvalSignatureConfig, documentNumberRule })} />บังคับ Digital acknowledgement</label>
        <label className="block text-xs font-semibold">ข้อความรับทราบ<textarea rows={4} value={acknowledgementConfig.statement} disabled={readOnly} onChange={(event) => onChange({ acknowledgementConfig: { ...acknowledgementConfig, statement: event.target.value }, approvalSignatureConfig, documentNumberRule })} className={fieldClass} placeholder="ระบุข้อความที่ผู้เกี่ยวข้องต้องรับทราบ" /></label>
      </div>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 className="h-4 w-4 text-primary-600" />Approval Signature Evidence</label>
        <label className="block text-xs font-semibold">บทบาทที่ต้องลงลายเซ็น <span className="font-normal text-slate-500">(คั่นด้วย comma)</span><input value={approvalSignatureConfig.requiredRoles.join(', ')} disabled={readOnly} onChange={(event) => onChange({ acknowledgementConfig, approvalSignatureConfig: { requiredRoles: event.target.value.split(',').map((role) => role.trim()).filter(Boolean) }, documentNumberRule })} className={fieldClass} placeholder="เช่น Requester, Approver" /></label>
        <p className="text-xs text-slate-500">ระบบจะไม่อนุญาตให้ออกเอกสารจนกว่าจะมีหลักฐานครบทุกบทบาท</p>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-semibold">Document Number Rule</p>
        <label className="block text-xs font-semibold">Prefix<input value={documentNumberRule.prefix} disabled={readOnly} onChange={(event) => onChange({ acknowledgementConfig, approvalSignatureConfig, documentNumberRule: { ...documentNumberRule, prefix: event.target.value.toUpperCase() } })} className={fieldClass} maxLength={20} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="block text-xs font-semibold">รูปแบบวันที่<select value={documentNumberRule.dateFormat} disabled={readOnly} onChange={(event) => onChange({ acknowledgementConfig, approvalSignatureConfig, documentNumberRule: { ...documentNumberRule, dateFormat: event.target.value as FormDocumentNumberRule['dateFormat'] } })} className={fieldClass}><option value="YYYY">YYYY</option><option value="YYYYMM">YYYYMM</option><option value="YYMM">YYMM</option></select></label><label className="block text-xs font-semibold">จำนวนหลัก<input type="number" min={1} max={12} value={documentNumberRule.padding} disabled={readOnly} onChange={(event) => onChange({ acknowledgementConfig, approvalSignatureConfig, documentNumberRule: { ...documentNumberRule, padding: Math.max(1, Math.min(12, Number(event.target.value) || 1)) } })} className={fieldClass} /></label></div>
        <p className="text-xs text-slate-500">ตัวอย่าง: {documentNumberRule.prefix || 'FRM'}-202609-{String(1).padStart(documentNumberRule.padding, '0')}</p>
      </div>
    </CardBody>
  </Card>;
}
