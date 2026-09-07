import DOMPurify from 'dompurify';

const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;
const SAFE_FIELD = /^[a-zA-Z0-9_.-]{1,100}$/;
/**
 * class เดียวที่แต่ละแท็กเก็บไว้ได้ — ไม่ใช่รายการ class อิสระ เพื่อไม่ให้ผู้ใช้แปะ class ของ
 * ระบบมาทับสไตล์หน้าจออื่น `div.form-page-break` คือตัวแบ่งหน้ากระดาษที่ผู้ใช้สั่งเอง
 */
const ALLOWED_ELEMENT_CLASS: Record<string, string> = {
  span: 'form-variable',
  div: 'form-page-break',
};
const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'blockquote',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img', 'hr',
];
const ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel', 'src', 'alt', 'style', 'width', 'height',
  'colspan', 'rowspan', 'class', 'data-field', 'data-image-layout',
];

function isSafeImageUrl(value: string): boolean {
  return /^https:\/\//i.test(value) || SAFE_IMAGE_DATA_URL.test(value);
}

function isSafeLinkUrl(value: string): boolean {
  return /^(?:https?:\/\/|mailto:|#|\/)/i.test(value);
}

function safeLength(value: string, allowAuto = false): string | null {
  const normalized = value.trim().toLowerCase();
  if (allowAuto && normalized === 'auto') return normalized;
  if (normalized === '100%') return normalized;
  return /^[1-9]\d{0,3}px$/.test(normalized) ? normalized : null;
}

/**
 * ระยะเยื้องของบล็อกที่ผู้ใช้ลากย้าย รับเฉพาะจำนวนเต็มไม่เกินสี่หลัก (ติดลบได้)
 * ค่าที่ยอมรับต้องตรงกับฝั่ง API เป๊ะ ๆ ไม่งั้นตำแหน่งจะรอดตอนแก้แต่หายตอนบันทึก
 */
function safeOffset(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === '0') return '0px';
  return /^-?\d{1,4}px$/.test(normalized) ? normalized : null;
}

function constrainStyle(element: Element): void {
  const input = (element as HTMLElement).style;
  const output: string[] = [];
  const textAlign = input.getPropertyValue('text-align').trim().toLowerCase();
  if (/^(left|right|center|justify)$/.test(textAlign)) output.push(`text-align:${textAlign}`);

  // ตำแหน่งของบล็อกที่ถูกลากย้าย — อนุญาตเฉพาะ relative เท่านั้น เพราะมันเยื้องจากตำแหน่งเดิม
  // โดยยังกินที่ในสายเนื้อหาเท่าเดิม ตัวแบ่งหน้ากระดาษ A4 จึงยังนับความสูงได้ถูก และผู้ใช้
  // สร้างแผ่นทับทั้งหน้าจอแบบ absolute/fixed ไม่ได้ z-index จำกัดหลักเดียวไว้ให้ซ้อนรูปทับ
  // ข้อความได้ แต่ดันขึ้นไปคลุม UI ของระบบไม่ได้
  if (input.getPropertyValue('position').trim().toLowerCase() === 'relative') {
    output.push('position:relative');
    const left = safeOffset(input.getPropertyValue('left'));
    const top = safeOffset(input.getPropertyValue('top'));
    const zIndex = input.getPropertyValue('z-index').trim();
    if (left) output.push(`left:${left}`);
    if (top) output.push(`top:${top}`);
    if (/^\d$/.test(zIndex)) output.push(`z-index:${zIndex}`);
  }

  if (element.tagName.toLowerCase() === 'img') {
    const width = safeLength(input.getPropertyValue('width'));
    const height = safeLength(input.getPropertyValue('height'), true);
    const maxWidth = input.getPropertyValue('max-width').trim() === '100%' ? '100%' : null;
    const display = input.getPropertyValue('display').trim() === 'block' ? 'block' : null;
    const marginLeft = /^(0|auto)$/.test(input.getPropertyValue('margin-left').trim()) ? input.getPropertyValue('margin-left').trim() : null;
    const marginRight = /^(0|auto)$/.test(input.getPropertyValue('margin-right').trim()) ? input.getPropertyValue('margin-right').trim() : null;
    if (width) output.push(`width:${width}`);
    if (height) output.push(`height:${height}`);
    if (maxWidth) output.push(`max-width:${maxWidth}`);
    if (display) output.push(`display:${display}`);
    if (marginLeft) output.push(`margin-left:${marginLeft}`);
    if (marginRight) output.push(`margin-right:${marginRight}`);
  }

  if (output.length > 0) element.setAttribute('style', output.join(';'));
  else element.removeAttribute('style');
}

export function sanitizeFormHtml(input: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const purified = DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: ['svg', 'math', 'style', 'template', 'noscript'],
    FORBID_ATTR: ['xlink:href', 'srcdoc', 'srcset', 'formaction', 'id', 'name'],
  });
  const documentNode = new DOMParser().parseFromString(purified, 'text/html');
  documentNode.body.querySelectorAll('*').forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === 'img' && !isSafeImageUrl(element.getAttribute('src') ?? '')) element.removeAttribute('src');
    if (tag === 'a') {
      if (!isSafeLinkUrl(element.getAttribute('href') ?? '')) element.removeAttribute('href');
      if (element.getAttribute('target') === '_blank') element.setAttribute('rel', 'noopener noreferrer');
    }
    if (element.hasAttribute('class') && element.getAttribute('class') !== ALLOWED_ELEMENT_CLASS[tag]) element.removeAttribute('class');
    if (element.hasAttribute('data-field') && !(tag === 'span' && SAFE_FIELD.test(element.getAttribute('data-field') ?? ''))) element.removeAttribute('data-field');
    if (element.hasAttribute('data-image-layout') && !(tag === 'img' && /^(?:inline|free)$/.test(element.getAttribute('data-image-layout') ?? ''))) element.removeAttribute('data-image-layout');
    if (element.hasAttribute('style')) constrainStyle(element);
  });
  return documentNode.body.innerHTML.trim();
}

export function exportHtmlAsWord(contentHtml: string, fileName: string) {
  const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font-family:Aptos,Arial,sans-serif;font-size:11pt;line-height:1.45}h1{text-align:center;font-size:18pt}h2{font-size:14pt;border-bottom:1px solid #cbd5e1;padding-bottom:5px}img{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border:1px solid #94a3b8;padding:7px;vertical-align:top}th{background:#e2e8f0}</style></head><body>${sanitizeFormHtml(contentHtml)}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${fileName.replace(/[\\/:*?"<>|]/g, '_')}.doc`;
  anchor.click();
  URL.revokeObjectURL(url);
}
