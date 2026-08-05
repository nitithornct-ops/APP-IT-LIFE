/** ตัวแปรที่ Cloudflare Workers ได้รับจาก wrangler.toml [vars] และ `wrangler secret` */
export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGINS: string;
  ENVIRONMENT: string;
}

/** ค่าที่ middleware แนบไว้บน Hono Context ระหว่างการประมวลผล request */
export interface Variables {
  requestId: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
