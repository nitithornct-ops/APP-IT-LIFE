import sanitizeHtml from 'sanitize-html';

const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;
const SAFE_IMAGE_URL = /^https:\/\//i;
const SAFE_FIELD = /^[a-zA-Z0-9_.-]{1,100}$/;
const SAFE_IMAGE_LAYOUT = /^(?:inline|free)$/;

/**
 * A block the user dragged is offset from where it would otherwise sit. Only whole pixels, at most
 * four digits, sign allowed — the same values the browser-side sanitizer keeps, so a position that
 * survives editing also survives the save.
 */
const SAFE_OFFSET = [/^-?\d{1,4}px$/, /^0$/];

const allowedTags = [
  'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'blockquote',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img', 'hr',
];

function safeImageSource(value: string | undefined): boolean {
  if (!value) return false;
  return SAFE_IMAGE_URL.test(value) || SAFE_IMAGE_DATA_URL.test(value);
}

/**
 * The API is the trust boundary for rich form documents. A parser-backed allowlist prevents
 * malformed HTML, foreign SVG/MathML namespaces, and encoded URLs from bypassing filtering.
 */
export function sanitizeFormHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'style', 'width', 'height', 'data-image-layout'],
      span: ['class', 'data-field', 'style'],
      div: ['style', 'class'],
      p: ['style'],
      h1: ['style'],
      h2: ['style'],
      h3: ['style'],
      h4: ['style'],
      h5: ['style'],
      h6: ['style'],
      // Every block a user can drag needs to be able to carry its offset back
      blockquote: ['style'],
      ul: ['style'],
      ol: ['style'],
      li: ['style'],
      table: ['style'],
      td: ['colspan', 'rowspan', 'style'],
      th: ['colspan', 'rowspan', 'style'],
    },
    // อนุญาตเฉพาะ class ที่ระบบใช้จริง — span.form-variable คือตัวแปรฟิลด์
    // ส่วน div.form-page-break คือจุดขึ้นหน้ากระดาษใหม่ที่ผู้ใช้สั่งไว้เอง
    allowedClasses: { span: ['form-variable'], div: ['form-page-break'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https', 'data'] },
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        'text-align': [/^(?:left|right|center|justify)$/],
        // `relative` only: it shifts a block visually while the block still occupies its original
        // slot in the flow, so A4 pagination keeps measuring the document correctly and no one can
        // build an `absolute`/`fixed` sheet that covers the page. A single-digit z-index lets an
        // image sit over nearby text without reaching the app's own layers.
        position: [/^relative$/],
        left: SAFE_OFFSET,
        top: SAFE_OFFSET,
        'z-index': [/^\d$/],
      },
      img: {
        width: [/^(?:[1-9]\d{0,3}px|100%)$/],
        height: [/^(?:[1-9]\d{0,3}px|auto)$/],
        'max-width': [/^100%$/],
        display: [/^block$/],
        'margin-left': [/^(?:0|auto)$/],
        'margin-right': [/^(?:0|auto)$/],
      },
    },
    transformTags: {
      img: (tagName, attributes) => {
        const { src, 'data-image-layout': layout, ...rest } = attributes;
        const attribs: Record<string, string> = { ...rest };
        if (safeImageSource(src)) attribs.src = src;
        if (layout && SAFE_IMAGE_LAYOUT.test(layout)) attribs['data-image-layout'] = layout;
        return { tagName, attribs };
      },
      a: (tagName, attributes) => ({
        tagName,
        attribs: attributes.target === '_blank'
          ? { ...attributes, rel: 'noopener noreferrer' }
          : attributes,
      }),
      span: (tagName, attributes) => {
        const { 'data-field': field, ...rest } = attributes;
        return { tagName, attribs: field && SAFE_FIELD.test(field) ? { ...rest, 'data-field': field } : rest };
      },
    },
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
  }).trim();
}
