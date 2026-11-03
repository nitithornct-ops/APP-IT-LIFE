export interface UserDeletionDependency {
  table: string;
  column: string;
  count: number;
}

export function parseUserDeletionDependencies(message: string): UserDeletionDependency[] {
  const prefix = 'USER_HAS_DEPENDENCIES:';
  if (!message.startsWith(prefix)) return [];
  try {
    const parsed: unknown = JSON.parse(message.slice(prefix.length));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is UserDeletionDependency =>
      row !== null && typeof row === 'object' && typeof row.table === 'string'
      && typeof row.column === 'string' && Number.isSafeInteger(row.count) && row.count > 0);
  } catch {
    return [];
  }
}
