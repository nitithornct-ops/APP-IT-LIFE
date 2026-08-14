/**
 * Rich-text forms are intentionally limited to presentation markup. The editor does not need
 * scripts, embedded documents, forms, inline event handlers, or executable URL schemes.
 */
export function sanitizeFormHtml(input: string): string {
  return input
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|option|meta|link|base)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|option|meta|link|base)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s(on\w+|srcdoc)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*(javascript|vbscript|data:text\/html)[\s\S]*?\2/gi, ' $1="#"')
    .trim();
}

