-- PDF tool decision (R-13) resolved 2026-08-10: Cloudflare Browser Rendering. Adds a genuine
-- server-rendered PDF export alongside the existing CSV/PRINT (browser print dialog) formats.
alter table public.report_exports drop constraint report_exports_format_check;
alter table public.report_exports add constraint report_exports_format_check check (format in ('CSV', 'PRINT', 'PDF'));
