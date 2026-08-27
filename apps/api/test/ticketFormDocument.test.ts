import { describe, expect, it } from 'vitest';
import { renderTicketFormTemplate, ticketFormFlow } from '../src/services/ticketFormDocument';

describe('Ticket Form Studio document', () => {
  it('fills the five-section template from Ticket and Vendor data without leaking HTML', () => {
    const html = renderTicketFormTemplate(
      '<h1>{{ticket_no}}</h1><p>{{requester_name}}</p><p>{{root_cause}}</p><p>{{it_signature}}</p>',
      {
        ticket_no: 'TCK-001', requester_name_snapshot: '<script>สมชาย</script>',
        root_cause: 'ข้อมูลเดิม', signature_uploaded_at: '2026-08-20T03:00:00.000Z',
      },
      { status: 'Vendor Replied', vendor_response: { rootCause: 'ERP validation ผิด' } },
      'https://signed.test/ticket.png',
    );

    expect(html).toContain('TCK-001');
    expect(html).toContain('&lt;script&gt;สมชาย&lt;/script&gt;');
    expect(html).toContain('ERP validation ผิด');
    expect(html).toContain('alt="ลายเซ็นรับรอง Ticket"');
  });

  it('maps an outsourced Ticket with no reply to sections 3 and 4', () => {
    const flow = ticketFormFlow('ส่งต่อ Outsource', { status: 'Sent to Vendor', vendor_response: {} });
    expect(flow.map((step) => step.state)).toEqual(['complete', 'complete', 'current', 'current', 'pending']);
  });

  it('puts a requester-owned signature and section 1 snapshots in the requester fields', () => {
    const html = renderTicketFormTemplate(
      '<p>{{position}}</p><p>{{erp_module}}</p><p>{{incident_date}} {{incident_time}}</p><p>{{requester_signature}}</p><p>{{it_signature}}</p>',
      {
        requester_position_snapshot: 'นักบัญชี',
        erp_module: 'Finance',
        incident_at: '2026-08-26T02:30:00.000Z',
        requester_signature_uploaded_at: '2026-08-26T02:35:00.000Z',
      },
      null,
      null,
      'https://signed.test/requester.png',
    );

    expect(html).toContain('นักบัญชี');
    expect(html).toContain('Finance');
    expect(html).toContain('09:30');
    expect(html).toContain('https://signed.test/requester.png');
    expect(html).toMatch(/<p>—<\/p>$/);
  });

  it('marks Vendor sections not required for an internally resolved Ticket', () => {
    const flow = ticketFormFlow('เสร็จสิ้น');
    expect(flow[2]?.state).toBe('not_required');
    expect(flow[4]?.state).toBe('current');
  });
});
