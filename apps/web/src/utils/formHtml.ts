export function sanitizeFormHtml(input: string): string {
  if (typeof DOMParser === 'undefined') return input;
  const documentNode = new DOMParser().parseFromString(input, 'text/html');
  documentNode.querySelectorAll('script, style, iframe, object, embed, form, input, button, textarea, select, option, meta, link, base').forEach((node) => node.remove());
  documentNode.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') element.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'src') && /^(javascript|vbscript|data:text\/html)/.test(value)) {
        element.setAttribute(attribute.name, '#');
      }
    }
  });
  return documentNode.body.innerHTML;
}

export function exportHtmlAsWord(contentHtml: string, fileName: string) {
  const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font-family:Aptos,Arial,sans-serif;font-size:11pt;line-height:1.45}h1{text-align:center;font-size:18pt}h2{font-size:14pt;border-bottom:1px solid #cbd5e1;padding-bottom:5px}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border:1px solid #94a3b8;padding:7px;vertical-align:top}th{background:#e2e8f0}</style></head><body>${sanitizeFormHtml(contentHtml)}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${fileName.replace(/[\\/:*?"<>|]/g, '_')}.doc`;
  anchor.click();
  URL.revokeObjectURL(url);
}

