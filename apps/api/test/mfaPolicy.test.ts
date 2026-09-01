import { describe, expect, it } from 'vitest';
import { evaluateMfaPolicy } from '../src/services/mfaPolicy';

describe('evaluateMfaPolicy', () => {
  it.each(['super_admin', 'it_admin'])('requires MFA for the %s role', (role) => {
    expect(evaluateMfaPolicy([role], [], false)).toEqual({ required: true, reason: 'admin_role' });
  });

  it('requires MFA for the configured approver role', () => {
    expect(evaluateMfaPolicy(['approver'], [], false)).toEqual({ required: true, reason: 'approver_role' });
  });

  it.each([
    'access_request.approve',
    'change.approve',
    'data_class.approve',
    'service_request.approve',
    'workflow.approve',
  ])('requires MFA for approval permission %s', (permission) => {
    expect(evaluateMfaPolicy(['user'], [permission], false)).toEqual({ required: true, reason: 'approval_permission' });
  });

  it.each(['report.export', 'evidence.export'])('requires MFA for exporter permission %s', (permission) => {
    expect(evaluateMfaPolicy(['auditor'], [permission], false)).toEqual({ required: true, reason: 'export_permission' });
  });

  it('continues to require AAL2 for an ordinary account that enrolled a verified factor', () => {
    expect(evaluateMfaPolicy(['user'], ['ticket.view'], true)).toEqual({ required: true, reason: 'enrolled_factor' });
  });

  it('allows AAL1 for an ordinary account without a factor or privileged permission', () => {
    expect(evaluateMfaPolicy(['user'], ['ticket.view'], false)).toEqual({ required: false, reason: null });
  });
});
