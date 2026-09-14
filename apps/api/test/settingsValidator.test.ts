import { describe, expect, it } from 'vitest';
import { brandingStoragePath, normalizeEnvironmentLabel, normalizeSettingValue, sanitizeConfigValue } from '../src/routes/settings';
import { slaImpactQuerySchema, updateSystemSettingSchema } from '../src/validators/settings';

describe('System Settings validation', () => {
  it('normalizes supported boolean and enum values', () => {
    expect(normalizeSettingValue('RETENTION_TRASH_EVIDENCE', 'ON')).toEqual({ value: 'true' });
    expect(normalizeSettingValue('RETENTION_MODE', 'enforce')).toEqual({ value: 'ENFORCE' });
    expect(normalizeSettingValue('SLA_BUSINESS_DAYS', '1,2,2,3,4,5')).toEqual({ value: '1,2,3,4,5' });
    expect(normalizeSettingValue('STATUS_SLO_TARGET_PERCENT', '99.9')).toEqual({ value: '99.9' });
  });

  it('rejects invalid ranges, time and insecure URLs', () => {
    expect(normalizeSettingValue('NOTIFY_LEAD_DAYS', '0').error).toBeTruthy();
    expect(normalizeSettingValue('SLA_BUSINESS_START', '25:30').error).toBeTruthy();
    expect(normalizeSettingValue('LIVE_HEALTH_PUBLIC_URL', 'http://example.test').error).toBeTruthy();
  });

  it('does not enable integrations that still require deployment secrets', () => {
    expect(normalizeSettingValue('NOTIFY_LINE_ENABLED', 'true').error).toBeTruthy();
    expect(normalizeSettingValue('LINE_LOGIN_ENABLED', 'false')).toEqual({ value: 'false' });
  });

  it('accepts only a bounded strict update payload', () => {
    expect(updateSystemSettingSchema.safeParse({ value: '30' }).success).toBe(true);
    expect(updateSystemSettingSchema.safeParse({ value: '30', secret: 'no' }).success).toBe(false);
    expect(updateSystemSettingSchema.safeParse({ value: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('accepts only supported SLA preview query keys', () => {
    expect(slaImpactQuerySchema.safeParse({ SLA_BUSINESS_START: '08:30', SLA_HOLIDAYS: '' }).success).toBe(true);
    expect(slaImpactQuerySchema.safeParse({ UNKNOWN_KEY: 'value' }).success).toBe(false);
  });

  it('only extracts organization logo paths from the branding bucket', () => {
    expect(brandingStoragePath('https://example.supabase.co/storage/v1/object/public/branding/organization/logo.png?v=1')).toBe('organization/logo.png');
    expect(brandingStoragePath('https://example.supabase.co/storage/v1/object/public/attachments/organization/logo.png')).toBeNull();
    expect(brandingStoragePath('https://example.supabase.co/storage/v1/object/public/branding/users/logo.png')).toBeNull();
  });

  it('normalizes deployment labels and never exports secret-shaped values', () => {
    expect(normalizeEnvironmentLabel('development')).toBe('dev');
    expect(normalizeEnvironmentLabel('staging')).toBe('uat');
    expect(normalizeEnvironmentLabel('production')).toBe('prod');
    expect(sanitizeConfigValue('LINE_CHANNEL_ACCESS_TOKEN', 'secret')).toBe('[REDACTED]');
    expect(sanitizeConfigValue('LOGIN_MAX_FAILS_5MIN', '10', 'external')).toBe('[MANAGED_EXTERNALLY]');
    expect(sanitizeConfigValue('ORG_NAME', 'LIFE IT', 'active')).toBe('LIFE IT');
  });
});
