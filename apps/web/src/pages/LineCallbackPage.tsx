import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setLineSessionToken } from '../services/lineApiClient';

/** Backend returns the app session in the URL fragment, which is never sent in HTTP requests or referrers. */
export function LineCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('token');
    const mode = params.get('mode');
    const error = params.get('error');
    if (token) setLineSessionToken(token);
    const search = error ? `?error=${encodeURIComponent(error)}` : mode ? `?mode=${mode}` : '';
    navigate(`/line${search}`, { replace: true });
  }, [navigate]);

  return (
    <main className="life-public flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
    </main>
  );
}
