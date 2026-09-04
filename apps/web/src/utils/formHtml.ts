import DOMPurify from 'dompurify';

const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;
const SAFE_FIELD = /^[a-zA-Z0-9_.-]{1,100}$/;
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

function constrainStyle(element: Element): void {
  const input = (element as HTMLElement).style;
  const output: string[] = [];
  const textAlign = input.getPropertyValue('text-align').trim().toLowerCase();
  if (/^(left|right|center|justify)$/.test(textAlign)) output.push(`text-align:${textAlign}`);

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
    if (element.hasAttribute('class') && !(tag === 'span' && element.className === 'form-variable')) element.removeAttribute('class');
    if (element.hasAttribute('data-field') && !(tag === 'span' && SAFE_FIELD.test(element.getAttribute('data-field') ?? ''))) element.removeAttribute('data-field');
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
