import { describe, expect, it } from 'vitest';
import { decideSelfLink, type SelfLinkCandidate } from '../src/services/lineLinkService';

const candidate = (overrides: Partial<SelfLinkCandidate> = {}): SelfLinkCandidate => ({
  userId: 'profile-1',
  profileStatus: 'active',
  lineLinkStatus: 'Active',
  lineLinkedUserId: null,
  otherLineAccountLinked: false,
  ...overrides,
});

describe('decideSelfLink', () => {
  it('links an active profile to a LINE account nobody has claimed', () => {
    expect(decideSelfLink(candidate())).toEqual({ outcome: 'link' });
  });

  it('treats a repeat of the same link as success so a double submit is harmless', () => {
    expect(decideSelfLink(candidate({ lineLinkedUserId: 'profile-1' }))).toEqual({ outcome: 'already-linked' });
  });

  it('refuses to move a link an administrator already pointed at someone else', () => {
    expect(decideSelfLink(candidate({ lineLinkedUserId: 'profile-2' }))).toMatchObject({
      outcome: 'reject',
      code: 'LINE_ACCOUNT_LINKED_ELSEWHERE',
    });
  });

  it('keeps one LINE account per profile', () => {
    expect(decideSelfLink(candidate({ otherLineAccountLinked: true }))).toMatchObject({
      outcome: 'reject',
      code: 'LINE_PROFILE_ALREADY_LINKED',
    });
  });

  it('does not deliver notifications to a suspended LINE account', () => {
    expect(decideSelfLink(candidate({ lineLinkStatus: 'Suspended' }))).toMatchObject({
      outcome: 'reject',
      code: 'LINE_ACCOUNT_SUSPENDED',
    });
  });

  it.each(['inactive', 'suspended', null])('refuses a profile that is not active: %s', (profileStatus) => {
    expect(decideSelfLink(candidate({ profileStatus }))).toMatchObject({
      outcome: 'reject',
      code: 'LINE_PROFILE_INACTIVE',
    });
  });

  it('reports an inactive profile before anything else, so a deactivated account cannot re-link itself', () => {
    expect(decideSelfLink(candidate({ profileStatus: 'inactive', lineLinkedUserId: 'profile-1' }))).toMatchObject({
      outcome: 'reject',
      code: 'LINE_PROFILE_INACTIVE',
    });
  });
});
