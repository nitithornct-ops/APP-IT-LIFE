export const TICKET_FORM_TEMPLATE_CODE = 'IT-ERP-ISSUE';

type FormValue = string | number | null | undefined;

interface TicketFormSource {
  ticket_no?: string | null;
  title?: string | null;
  description?: string | null;
  requester_id?: string | null;
  requester_name_snapshot?: string | null;
  requester_position_snapshot?: string | null;
  department_name_snapshot?: string | null;
  guest_name?: string | null;
  guest_department?: string | null;
  requester_phone?: string | null;
  incident_at?: string | null;
  erp_module?: string | null;
  location?: string | null;
  priority?: string | null;
  status?: string | null;
  created_at?: string | null;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  resolution?: string | null;
  root_cause?: string | null;
  outsource_name?: string | null;
  outsource_issue_no?: string | null;
  escalation_reason?: string | null;
  signature_uploaded_at?: string | null;
  signature_uploaded_by?: string | null;
  requester_signature_uploaded_at?: string | null;
  requester?: { full_name?: string | null } | null;
  assignee?: { full_name?: string | null } | null;
  ticket_categories?: { name?: string | null } | null;
}

interface TicketIssueFormSource {
  status?: string | null;
  vendor_response?: Record<string, unknown> | null;
}

export type TicketFormFlowState = 'complete' | 'current' | 'pending' | 'not_required';

export interface TicketFormFlowStep {
  section: number;
  title: string;
  state: TicketFormFlowState;
  detail: string;
}

function escapeHtml(value: FormValue): string {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}

function responseValue(response: Record<string, unknown>, key: string): FormValue {
  const value = response[key];
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function formatBangkokDate(value: FormValue, withTime = false): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  }).format(date);
}

function formatBangkokTime(value: FormValue): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function signatureHtml(signatureUrl: string | null | undefined): string {
  if (!signatureUrl || !/^https:\/\//i.test(signatureUrl)) return '—';
  return `<img src="${escapeHtml(signatureUrl)}" alt="ลายเซ็นรับรอง Ticket" style="max-height:72px;max-width:180px;object-fit:contain">`;
}

/**
 * โลโก้หัวเอกสารมาจากค่า ORG_LOGO_URL ในหน้าตั้งค่า ไม่ได้ฝังไว้ใน template
 * เปลี่ยนโลโก้ที่เดียวแล้วแบบฟอร์มทุกใบเปลี่ยนตาม และเอกสารที่ยังไม่ตั้งโลโก้จะขึ้นหัวเรื่องเปล่า ๆ
 * แทนที่จะเป็นขีด — เพราะรูปที่ไม่มีไม่ใช่ "ข้อมูลที่ยังไม่กรอก"
 */
function organizationLogoHtml(logoUrl: string | null | undefined): string {
  if (!logoUrl || !/^https:\/\//i.test(logoUrl)) return '';
  return `<img src="${escapeHtml(logoUrl)}" alt="โลโก้หน่วยงาน" style="max-height:96px;max-width:240px;object-fit:contain">`;
}

/** ไฟล์ภาพและลิงก์ที่ต้องเซ็นชื่อไว้ล่วงหน้า ผู้เรียกส่งมาเป็นชุดเดียว แทน argument เรียงยาวที่สลับกันได้ง่าย */
export interface TicketFormAssets {
  itSignatureUrl?: string | null;
  requesterSignatureUrl?: string | null;
  vendorSignatureUrl?: string | null;
  organizationLogoUrl?: string | null;
}

export function renderTicketFormTemplate(
  templateHtml: string,
  ticket: TicketFormSource,
  issueForm?: TicketIssueFormSource | null,
  assets: TicketFormAssets = {},
): string {
  const response = issueForm?.vendor_response ?? {};
  const requesterName = ticket.requester?.full_name ?? ticket.requester_name_snapshot ?? ticket.guest_name;
  const department = ticket.department_name_snapshot ?? ticket.guest_department;
  const prevention = responseValue(response, 'prevention');
  const vendorResolution = responseValue(response, 'resolution');
  const vendorAssessor = [responseValue(response, 'assessorName'), responseValue(response, 'assessorPosition')].filter(Boolean).join(' · ');
  const resolutionAndPrevention = [vendorResolution ?? ticket.resolution, prevention].filter(Boolean).join('\n') || '—';
  const submittedAt = responseValue(response, 'submittedAt');

  const values: Record<string, FormValue> = {
    document_no: ticket.ticket_no,
    ticket_no: ticket.ticket_no,
    requester_name: requesterName,
    position: ticket.requester_position_snapshot,
    department,
    phone: ticket.requester_phone,
    incident_date: formatBangkokDate(ticket.incident_at ?? ticket.created_at),
    incident_time: formatBangkokTime(ticket.incident_at ?? ticket.created_at),
    erp_module: ticket.erp_module ?? ticket.ticket_categories?.name,
    issue_detail: [ticket.title, ticket.description].filter(Boolean).join('\n'),
    received_at: formatBangkokDate(ticket.acknowledged_at, true),
    receiver_name: ticket.assignee?.full_name,
    escalation_reason: ticket.escalation_reason,
    vendor_ticket_no: responseValue(response, 'vendorIssueNo') ?? ticket.outsource_issue_no,
    vendor_received_time: responseValue(response, 'receivedDuration'),
    vendor_workaround_time: responseValue(response, 'workaroundDuration'),
    vendor_analysis_time: responseValue(response, 'analysisDuration'),
    vendor_resolution_time: responseValue(response, 'resolutionDuration'),
    root_cause: responseValue(response, 'rootCause') ?? ticket.root_cause,
    resolution_and_prevention: resolutionAndPrevention,
    vendor_assessor_name: vendorAssessor || ticket.outsource_name,
    vendor_signed_date: formatBangkokDate(submittedAt),
    target_completion_date: formatBangkokDate(responseValue(response, 'targetCompletionDate')),
    credit_balance_before: responseValue(response, 'creditBalanceBefore'),
    manday_used: responseValue(response, 'mandayUsed'),
    credit_balance_after: responseValue(response, 'creditBalanceAfter'),
    credit_note: responseValue(response, 'assessmentNote'),
    completed_at: formatBangkokDate(responseValue(response, 'workCompletedAt') ?? ticket.resolved_at ?? ticket.closed_at, true),
    test_result: responseValue(response, 'testResult') ?? ticket.resolution,
    requester_sign_date: formatBangkokDate(ticket.requester_signature_uploaded_at),
    it_sign_date: formatBangkokDate(ticket.signature_uploaded_at),
  };
  const rawValues: Record<string, string> = {
    requester_signature: signatureHtml(assets.requesterSignatureUrl),
    it_signature: signatureHtml(assets.itSignatureUrl),
    vendor_signature: signatureHtml(assets.vendorSignatureUrl),
    org_logo: organizationLogoHtml(assets.organizationLogoUrl),
  };

  return templateHtml.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    if (key in rawValues) return rawValues[key]!;
    return escapeHtml(values[key]);
  });
}

export function ticketFormFlow(ticketStatus: string, issueForm?: TicketIssueFormSource | null): TicketFormFlowStep[] {
  const vendorReplied = Boolean(responseValue(issueForm?.vendor_response ?? {}, 'submittedAt')) || issueForm?.status === 'Vendor Replied';
  const outsourced = ticketStatus === 'ส่งต่อ Outsource' || Boolean(issueForm);
  const resolved = ticketStatus === 'เสร็จสิ้น' || ticketStatus === 'ปิดงาน';
  const closed = ticketStatus === 'ปิดงาน';

  return [
    { section: 1, title: 'ข้อมูลผู้แจ้ง', state: 'complete', detail: 'ข้อมูลจาก Ticket' },
    {
      section: 2,
      title: 'IT ประเมินและดำเนินการ',
      state: outsourced || resolved ? 'complete' : 'current',
      detail: outsourced ? 'ส่งต่อ Vendor/Outsource แล้ว' : resolved ? 'ดำเนินการโดย IT แล้ว' : 'อยู่ระหว่างรับเรื่องและดำเนินการ',
    },
    {
      section: 3,
      title: 'Vendor แก้ไข',
      state: vendorReplied ? 'complete' : outsourced ? 'current' : resolved ? 'not_required' : 'pending',
      detail: vendorReplied ? 'Vendor ส่งผลกลับแล้ว' : outsourced ? 'รอ Vendor ตอบกลับ' : resolved ? 'งานนี้ไม่ส่ง Vendor' : 'เริ่มเมื่อส่งต่อ Vendor',
    },
    {
      section: 4,
      title: 'Manday / Credit',
      state: vendorReplied ? 'complete' : outsourced ? 'current' : resolved ? 'not_required' : 'pending',
      detail: vendorReplied ? 'บันทึกผลประเมินแล้ว' : outsourced ? 'บันทึกพร้อมผลตอบกลับ Vendor' : resolved ? 'งานนี้ไม่ส่ง Vendor' : 'ใช้เฉพาะงาน Vendor',
    },
    {
      section: 5,
      title: 'ตรวจรับและปิดงาน',
      state: closed ? 'complete' : resolved ? 'current' : 'pending',
      detail: closed ? 'ปิด Ticket แล้ว' : resolved ? 'รอผู้แจ้งตรวจรับและปิดงาน' : 'ดำเนินการหลังแก้ไขเสร็จ',
    },
  ];
}
