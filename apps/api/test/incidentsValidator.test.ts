import { describe, expect, it } from 'vitest';
import {
  closeIncidentSchema,
  createIncidentSchema,
  createRegulatoryNotificationSchema,
  regulatoryAssessmentSchema,
  updateIncidentSchema,
} from '../src/validators/incidents';

describe('Incident validators', () => {
  it('accepts a valid incident report and rejects an unknown legacy category', () => {
    expect(createIncidentSchema.safeParse({ title: 'พบมัลแวร์', description: 'รายละเอียด', category: 'มัลแวร์/ไวรัส', containsPersonalData: false }).success).toBe(true);
    expect(createIncidentSchema.safeParse({ title: 'ผิด', description: 'รายละเอียด', category: 'หมวดที่ไม่มี' }).success).toBe(false);
  });

  it('limits the risk matrix inputs to 1-5', () => {
    expect(updateIncidentSchema.safeParse({ likelihood: 5, impact: 1 }).success).toBe(true);
    expect(updateIncidentSchema.safeParse({ likelihood: 6, impact: 0 }).success).toBe(false);
  });

  it('requires all four explicit regulatory decisions and an assessment reason', () => {
    expect(regulatoryAssessmentSchema.safeParse({ pdpcRequired: 'No', dataSubjectRequired: 'No', ncsaRequired: 'No', otherRegulatorRequired: 'No', assessment: 'ไม่เข้าเงื่อนไขตามข้อเท็จจริงที่บันทึก' }).success).toBe(true);
    expect(regulatoryAssessmentSchema.safeParse({ pdpcRequired: 'No', assessment: '' }).success).toBe(false);
  });

  it('requires a reason and matching status when the decision is not to notify', () => {
    const base = { destination: 'PDPC', agency: 'สคส.', notificationType: 'แจ้งเหตุละเมิด', required: false, status: 'ไม่ต้องแจ้ง' };
    expect(createRegulatoryNotificationSchema.safeParse(base).success).toBe(false);
    expect(createRegulatoryNotificationSchema.safeParse({ ...base, reasonNotRequired: 'ไม่เข้าเกณฑ์' }).success).toBe(true);
  });

  it('requires reference number or evidence URL for a sent notification', () => {
    const base = { destination: 'NCSA', agency: 'สกมช.', notificationType: 'รายงานเหตุ', required: true, status: 'แจ้งแล้ว' };
    expect(createRegulatoryNotificationSchema.safeParse(base).success).toBe(false);
    expect(createRegulatoryNotificationSchema.safeParse({ ...base, referenceNo: 'NCSA-001' }).success).toBe(true);
  });

  it('requires root cause and resolution before close', () => {
    expect(closeIncidentSchema.safeParse({ rootCause: 'ช่องโหว่', resolution: 'อุดช่องโหว่' }).success).toBe(true);
    expect(closeIncidentSchema.safeParse({ rootCause: '', resolution: '' }).success).toBe(false);
  });
});
