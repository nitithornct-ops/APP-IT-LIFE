interface Metric { label: string; value: string | number; tone: string; note?: string; }
interface Breakdown { label: string; items: { label: string; value: number }[]; }
interface ReportDataset {
  definition: { key: string; label: string; description: string };
  metrics: Metric[];
  alerts: string[];
  breakdowns: Breakdown[];
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  totalRows: number;
  rangeDays: number;
  generatedAt: string;
}

function escapeHtml(input: unknown): string {
  return String(input ?? '—').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Self-contained HTML (inline CSS, no external assets) for page.setContent() — Browser Rendering has no network access to this Worker's own static assets. */
export function renderReportHtml(dataset: ReportDataset): string {
  const generated = new Date(dataset.generatedAt).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });
  const rangeLabel = dataset.rangeDays === 0 ? 'ทั้งหมด' : `${dataset.rangeDays} วันล่าสุด`;

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Thai', 'Sarabun', Arial, sans-serif; color: #1e293b; margin: 0; padding: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { color: #64748b; margin: 0 0 16px; }
  .meta { color: #94a3b8; font-size: 10px; margin-bottom: 16px; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .metric { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
  .metric .label { color: #64748b; font-size: 10px; }
  .metric .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .alerts { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 8px; padding: 10px; margin-bottom: 16px; }
  .alerts p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; font-size: 10.5px; }
  th { background: #f8fafc; color: #475569; text-transform: uppercase; font-size: 9px; }
  tr { break-inside: avoid; }
  footer { margin-top: 12px; color: #94a3b8; font-size: 9px; }
</style>
</head>
<body>
  <h1>${escapeHtml(dataset.definition.label)}</h1>
  <p class="subtitle">${escapeHtml(dataset.definition.description)}</p>
  <p class="meta">สร้างเมื่อ ${escapeHtml(generated)} · ช่วงข้อมูล ${escapeHtml(rangeLabel)} · ${dataset.totalRows.toLocaleString('th-TH')} รายการ</p>

  <div class="metrics">
    ${dataset.metrics.map((metric) => `<div class="metric"><div class="label">${escapeHtml(metric.label)}</div><div class="value">${escapeHtml(metric.value)}</div>${metric.note ? `<div class="label">${escapeHtml(metric.note)}</div>` : ''}</div>`).join('')}
  </div>

  ${dataset.alerts.length > 0 ? `<div class="alerts">${dataset.alerts.map((alert) => `<p>⚠ ${escapeHtml(alert)}</p>`).join('')}</div>` : ''}

  <table>
    <thead><tr>${dataset.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
    <tbody>
      ${dataset.rows.map((row) => `<tr>${dataset.columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>

  <footer>LIFE IT Smart Service Center — Report Center · ${escapeHtml(dataset.definition.key)}</footer>
</body>
</html>`;
}
