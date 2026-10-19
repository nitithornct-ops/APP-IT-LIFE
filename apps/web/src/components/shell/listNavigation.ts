/** Restore only this module's list so route state cannot redirect to another page. */
export function getListReturnTo(state: unknown, listPath: string): string {
  if (!state || typeof state !== 'object' || !('listReturnTo' in state)) return listPath;
  const value = state.listReturnTo;
  return typeof value === 'string' && (value === listPath || value.startsWith(`${listPath}?`))
    ? value
    : listPath;
}
