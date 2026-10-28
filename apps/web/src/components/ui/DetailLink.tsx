import { Link, useLocation, useResolvedPath, type LinkProps } from 'react-router-dom';

const detailPath = /^\/(tickets|assets|incidents|problems|changes|cmdb|service-requests|access-requests)\/([^/]+)\/?$/;

/** Open a record over its list while keeping the URL and list filters intact. */
export function DetailLink({ to, state, ...props }: LinkProps) {
  const location = useLocation();
  const resolved = useResolvedPath(to);
  const match = detailPath.exec(resolved.pathname);
  const reserved = new Set(['new', 'relationships']);
  const opensDetail = match && !reserved.has(match[2]) && props.target !== '_blank' && !props.reloadDocument
    && new URLSearchParams(resolved.search).get('action') !== 'edit';
  const existingState = state && typeof state === 'object' ? state : {};
  const currentState = location.state as { backgroundLocation?: typeof location } | null;
  const backgroundLocation = currentState?.backgroundLocation ?? location;
  return <Link {...props} to={to} state={opensDetail ? { ...existingState, backgroundLocation } : state} />;
}
