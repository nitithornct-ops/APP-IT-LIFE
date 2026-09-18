import { describe, expect, it } from 'vitest';
import { evaluateMfaPolicy } from '../src/services/mfaPolicy';

describe('evaluateMfaPolicy', () => {
  it('does not turn MFA on when a privileged role or permission is assigned', () => {
    expect(evaluateMfaPolicy(['super_admin', 'approver'], ['change.approve', 'report.export'], false)).toEqual({ required: false, reason: null });
  });

  it('does not require MFA from a stale verified factor when the account switch is off', () => {
    expect(evaluateMfaPolicy(['user'], ['ticket.view'], true, false)).toEqual({ required: false, reason: null });
  });

  it('allows AAL1 for an account without a factor when MFA is disabled', () => {
    expect(evaluateMfaPolicy(['user'], ['ticket.view'], false)).toEqual({ required: false, reason: null });
  });

  it('requires MFA for an ordinary account when its per-user switch is enabled', () => {
    expect(evaluateMfaPolicy(['user'], ['ticket.view'], false, true)).toEqual({ required: true, reason: 'user_enabled' });
  });

  it('requires an MFA challenge when an enabled account has a verified factor', () => {
    expect(evaluateMfaPolicy(['user'], ['ticket.view'], true, true)).toEqual({ required: true, reason: 'enrolled_factor' });
  });
});
