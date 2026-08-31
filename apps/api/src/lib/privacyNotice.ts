/**
 * Canonical text rendered by both public ticket surfaces and persisted with the ticket.
 * Changing the text requires a new version; never edit a version in place because the
 * stored snapshot is legal/audit evidence of what the data subject accepted.
 */
export const TICKET_PRIVACY_NOTICE = Object.freeze({
  version: '2026-08-31',
  summary: 'ระบบใช้ข้อมูลผู้แจ้งเพื่อรับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม และแจ้งสถานะ Ticket เท่านั้น',
  dpoContact: 'DPO / ส่วนงาน IT',
  consentText: 'ข้าพเจ้าอ่านและยอมรับการใช้ข้อมูลเพื่อรับเรื่อง แจ้งสถานะ ดำเนินการแจ้งซ่อม และเก็บหลักฐานตามนโยบายขององค์กร',
});

export type TicketConsentChannel = 'PUBLIC_TICKET_WEB' | 'PUBLIC_TICKET_LINE';

export function ticketConsentEvidence(channel: TicketConsentChannel, consentedAt: Date) {
  return {
    privacy_consent_confirmed: true,
    privacy_notice_version: TICKET_PRIVACY_NOTICE.version,
    privacy_consent_at: consentedAt.toISOString(),
    privacy_consent_channel: channel,
    privacy_consent_text: TICKET_PRIVACY_NOTICE.consentText,
  };
}
