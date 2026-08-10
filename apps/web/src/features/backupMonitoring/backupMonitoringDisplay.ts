const DAY_MS = 86_400_000;

export function daysUntilOperationsDue(date: string | null, now = new Date()): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target.getTime() - today.getTime()) / DAY_MS);
}

export function isOperationsOverdue(date: string | null, now = new Date()): boolean {
  const days = daysUntilOperationsDue(date, now);
  return days !== null && days < 0;
}

export function backupSuccessPercent(results: Array<{ result: string }>): number {
  if (!results.length) return 0;
  return Math.round((results.filter((row) => row.result === 'สำเร็จ').length / results.length) * 100);
}

export function openAnomalyCount(reviews: Array<{ anomaly_found: boolean; status: string }>): number {
  return reviews.filter((row) => row.anomaly_found && row.status !== 'แก้ไขแล้ว').length;
}
