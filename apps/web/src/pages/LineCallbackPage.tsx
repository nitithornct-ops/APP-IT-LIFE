import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setLineSessionToken } from '../services/lineApiClient';

/** Backend redirects here after LINE OAuth completes (routes/line.ts's /callback) with ?token=&mode= or ?error=. */
export function LineCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get('token');
    const mode = params.get('mode');
    const error = params.get('error');
    if (token) setLineSessionToken(token);
    const search = error ? `?error=${encodeURIComponent(error)}` : mode ? `?mode=${mode}` : '';
    navigate(`/line${search}`, { replace: true });
  }, [params, navigate]);

  return (
    <main className="life-public flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
    </main>
  );
}
