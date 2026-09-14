interface BorrowFormSource {
  asset_code: string;
  name: string;
  loan_date: string | null;
  loan_due_date: string | null;
  location: string | null;
  owner: { first_name_th: string; last_name_th: string; employee_code: string } | null;
  department: { name_th: string } | null;
  loan?: {
    purpose: string;
    condition_before: string;
    companion_equipment: string[];
    approver: { first_name_th: string; last_name_th: string; employee_code: string } | null;
    borrower_acknowledgement_name: string | null;
    borrower_acknowledged: boolean;
    returned_at: string | null;
    condition_after: string | null;
    return_outcome: string;
  } | null;
}

export function renderAssetBorrowForm(html: string, asset: BorrowFormSource): string {
  const date = (value: string | null) => value ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long' }).format(new Date(value)) : '—';
  const values: Record<string, string | null> = {
    document_no: asset.asset_code,
    asset_code: asset.asset_code,
    asset_name: asset.name,
    borrower_name: asset.owner ? `${asset.owner.first_name_th} ${asset.owner.last_name_th}` : null,
    employee_code: asset.owner?.employee_code ?? null,
    department: asset.department?.name_th ?? null,
    location: asset.location,
    loan_date: date(asset.loan_date),
    due_date: date(asset.loan_due_date),
    purpose: asset.loan?.purpose ?? null,
    condition_before: asset.loan?.condition_before ?? null,
    companion_equipment: asset.loan?.companion_equipment?.join(', ') ?? null,
    approver_name: asset.loan?.approver ? `${asset.loan.approver.first_name_th} ${asset.loan.approver.last_name_th}` : null,
    acknowledgement_name: asset.loan?.borrower_acknowledgement_name ?? null,
    acknowledgement: asset.loan?.borrower_acknowledged ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน',
    return_date: date(asset.loan?.returned_at ?? null),
    condition_after: asset.loan?.condition_after ?? null,
    return_outcome: asset.loan?.return_outcome ?? null,
  };
  return html.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) =>
    (values[key] ?? '—').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!));
}
