import { describe, expect, it } from 'vitest';
import { jwtAuthenticatorAssuranceLevel } from '../src/utils/jwt';

function unsignedJwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${encoded}.signature`;
}

describe('jwtAuthenticatorAssuranceLevel', () => {
  it('reads a validated token AAL claim', () => {
    expect(jwtAuthenticatorAssuranceLevel(unsignedJwt({ sub: 'user', aal: 'aal2' }))).toBe('aal2');
  });

  it('fails closed for malformed or missing claims', () => {
    expect(jwtAuthenticatorAssuranceLevel('not-a-jwt')).toBeNull();
    expect(jwtAuthenticatorAssuranceLevel(unsignedJwt({ sub: 'user' }))).toBeNull();
    expect(jwtAuthenticatorAssuranceLevel(unsignedJwt({ aal: 2 }))).toBeNull();
  });
});
