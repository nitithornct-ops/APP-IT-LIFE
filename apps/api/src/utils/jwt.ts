/** The token is authenticated with Supabase getUser() before this helper is used. */
export function jwtAuthenticatorAssuranceLevel(token: string): string | null {
  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;
    const json = atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encodedPayload.length / 4) * 4, '='));
    const payload: unknown = JSON.parse(json);
    if (!payload || typeof payload !== 'object') return null;
    const aal = (payload as { aal?: unknown }).aal;
    return typeof aal === 'string' ? aal : null;
  } catch {
    return null;
  }
}
