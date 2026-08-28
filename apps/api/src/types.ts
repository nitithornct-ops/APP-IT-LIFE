import type { BrowserWorker } from '@cloudflare/playwright';
import type { SupabaseClient } from '@supabase/supabase-js';

/** ตัวแปรที่ Cloudflare Workers ได้รับจาก wrangler.toml [vars] และ `wrangler secret` */
export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGINS: string;
  ENVIRONMENT: string;
  /** apps/web origin the LINE OAuth callback redirects back to (e.g. https://itlife.example.com); falls back to the request origin if unset. */
  PUBLIC_APP_URL?: string;
  /** LINE Login (public ticket portal) — all optional: unset/false means the feature stays off. See routes/line.ts + docs/migration/phase0-risk_register.md R-11. */
  LINE_LOGIN_ENABLED?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  LINE_LOGIN_CALLBACK_URL?: string;
  LINE_SESSION_SECRET?: string;
  LINE_SESSION_HOURS?: string;
  NOTIFY_LINE_ENABLED?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_DEFAULT_TO?: string;
  /** Cloudflare Browser Rendering — declared in wrangler.toml's [browser] block, not a secret. Used for PDF report exports (R-13). */
  MYBROWSER?: BrowserWorker;
  /** Kill switch for the public no-login ticket report page (routes/publicTickets.ts) — unset/anything but 'false' means enabled. */
  PUBLIC_TICKET_FORM_ENABLED?: string;
  /** Cloudflare edge rate limiter for unauthenticated endpoints. Local tests may omit it. */
  PUBLIC_RATE_LIMITER?: RateLimit;
}

export interface LineUserProfile {
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  employee_code: string | null;
  linked_user_id: string | null;
  full_name: string | null;
  department: string | null;
  link_status: string | null;
  friend_status: string | null;
}

export interface VendorPortalProfile {
  accountId: string;
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  email: string;
  fullName: string;
  position: string | null;
}

/** ค่าที่ middleware แนบไว้บน Hono Context ระหว่างการประมวลผล request */
export interface Variables {
  requestId: string;
  /** Supabase client ที่ผูกกับ JWT ของผู้ใช้ปัจจุบัน (ให้ RLS ทำงาน) — ตั้งค่าโดย requireAuth */
  supabase: SupabaseClient;
  userId: string;
  userEmail: string;
  /** LINE session — ตั้งค่าโดย requireLineSession/requireUsableLineSession ใน routes/line.ts เท่านั้น */
  lineSession?: { token: string; user: LineUserProfile };
  /** Company session — never shares the internal Supabase JWT/RBAC context. */
  vendorSession?: { token: string; profile: VendorPortalProfile };
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
