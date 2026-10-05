import { FORM_FONT_CSS } from './formFont';

/** Shared typography and physical page geometry for the editor and form exports. */
export const TICKET_REFERENCE_FORM_CSS = `
.form-document .ticket-reference-page { font-size:9pt; line-height:1.3; color:#111; }
.form-document .ticket-reference-page h1 { font-size:11pt; line-height:1.3; margin:6px 0; font-weight:700; }
.form-document .ticket-reference-page h2 { font-size:9pt; line-height:1.3; margin:16px 0 4px; padding-top:10px; padding-bottom:0; border:0; border-top:1px solid #111; color:#111; font-weight:700; }
.form-document .ticket-reference-page h2:first-of-type { border:0; padding-top:0; margin-top:12px; }
.form-document .ticket-reference-page p { margin:4px 0; }
.form-document .ticket-reference-page table { margin:6px 0; font-size:inherit; }
.form-document .ticket-reference-page td,.form-document .ticket-reference-page th { border:1px solid #111; padding:2px 5px; background:white; line-height:1.3; }
.form-document .ticket-reference-page .ticket-form-lines td { border:0; padding:1px 0; }
.form-document .ticket-reference-page .ticket-form-signoff td { border:1px dashed #888; padding:5px 10px; width:50%; }
.form-document .ticket-reference-page img[data-field] { width:140px !important; height:28px !important; object-fit:contain; display:inline-block !important; vertical-align:middle; }
.form-document .ticket-reference-page p:first-child > img:not([data-field]) { width:80px; height:80px; object-fit:contain; }
.form-document .ticket-reference-page a { color:#111; text-decoration:underline; overflow-wrap:anywhere; }
.form-document .ticket-reference-page .ticket-form-checkbox { color:#111; }
.form-document .ticket-reference-page .ticket-form-text-field { min-width:3em; }
.form-document .ticket-reference-page + .form-page-break { page-break-after:always; break-after:page; }
@media print { .form-document .ticket-reference-page + .form-page-break { break-after:page; } }
`;

export const FORM_DOCUMENT_CSS = `${FORM_FONT_CSS}
@page { size: A4; margin: 20mm; }
.form-document { box-sizing:border-box; font-family:FormThai,'Noto Sans Thai',Tahoma,Arial,sans-serif; font-size:11pt; line-height:1.55; color:#202522; overflow-wrap:break-word; }
.form-document h1 { margin:0 0 16px; font-size:18pt; font-weight:800; line-height:1.25; }
.form-document h2 { margin:22.4px 0 10.4px; border-bottom:1px solid #d4d9d5; padding-bottom:5.6px; color:#287a48; font-size:14pt; font-weight:800; }
.form-document h3 { margin:16px 0 6.4px; font-size:12pt; font-weight:800; }
.form-document p { margin:7.2px 0; }
.form-document table { width:100%; margin:12px 0; border-collapse:collapse; }
.form-document td,.form-document th { border:1px solid #d4d9d5; padding:7.2px 8.8px; vertical-align:top; }
.form-document th { background:#f4fcf3; font-weight:800; text-align:left; }
.form-document img { max-width:100%; height:auto; }
.form-document ul { list-style:disc; padding-left:24px; }
.form-document ol { list-style:decimal; padding-left:24px; }
.form-document .form-variable { border-radius:4px; background:#e9f9e7; padding:1.6px 4px; color:#287a48; font-family:monospace; font-size:.88em; }
${TICKET_REFERENCE_FORM_CSS}
@media print {
 .form-document { width:auto; min-height:0; padding:0; margin:0; box-shadow:none; }
 .form-document h1,.form-document h2,.form-document h3 { break-after:avoid; }
 .form-document tr,.form-document img { break-inside:avoid; }
 .form-document .form-page-break { height:0; margin:0; border:0; break-after:page; }
 .form-document .form-page-break::after { display:none; }
}
`;

export interface FormDocumentMetadata {
 documentNumber?: string | null;
 sourceModule?: string | null;
 sourceRecordId?: string | null;
 issuedAt?: string | null;
 snapshotHash?: string | null;
}

function escapeHtml(value: unknown): string {
 return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]!);
}

/** contentHtml must already be sanitized at the trust boundary. */
export function formDocumentHtml(contentHtml: string, title: string, metadata?: FormDocumentMetadata): string {
 const metadataRows = metadata ? [
   ['Document number', metadata.documentNumber],
   ['Source module', metadata.sourceModule],
   ['Source record', metadata.sourceRecordId],
   ['Issued at', metadata.issuedAt],
   ['Snapshot hash', metadata.snapshotHash],
 ].filter(([, value]) => value !== null && value !== undefined && value !== '')
   .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('') : '';
 const metadataBlock = metadataRows
   ? `<section class="form-metadata" aria-label="Document metadata"><h2>Document metadata</h2><dl>${metadataRows}</dl></section>`
   : '';
 return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>html,body{margin:0;padding:0}.form-metadata{margin:0 0 18px;padding:10px 12px;border:1px solid #d4d9d5;background:#f8fbf7;font-size:9pt;color:#46534b}.form-metadata h2{margin:0 0 6px;border:0;padding:0;color:#287a48;font-size:11pt}.form-metadata dl{display:grid;grid-template-columns:max-content 1fr;gap:3px 12px;margin:0}.form-metadata dl>div{display:contents}.form-metadata dt{font-weight:700}.form-metadata dd{margin:0;overflow-wrap:anywhere}${FORM_DOCUMENT_CSS}</style></head><body>${metadataBlock}<main class="form-document">${contentHtml}</main></body></html>`;
}
