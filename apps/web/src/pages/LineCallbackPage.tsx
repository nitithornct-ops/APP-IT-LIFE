import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/apiClient';
import { clearLineSessionToken, setLineSessionToken } from '../services/lineApiClient';

/** Backend returns the app session in the URL fragment, which is never sent in HTTP requests or referrers. */
export function LineCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('token');
    const mode = params.get('mode');
    const error = params.get('error');
    if (token) setLineSessionToken(token);

    // โหมด link มาจากผู้ใช้ที่ล็อกอินแอปอยู่แล้วและเพิ่งพิสูจน์ตัวตนกับ LINE เสร็จ
    // จังหวะนี้เบราว์เซอร์ถือหลักฐานครบทั้งสองฝั่ง จึงเป็นจุดเดียวที่ผูกบัญชีให้ตัวเองได้
    if (mode === 'link') {
      if (!token) {
        navigate('/profile?line=error', { replace: true });
        return;
      }
      void apiFetch('/api/v1/line/my-link', {
        method: 'POST',
        headers: { 'x-line-session': token },
      }, { silent: true })
        .then(() => {
          // การเชื่อมไม่ได้ต้องการ session ของพอร์ทัล LINE ต่อ — ปล่อยทิ้งไว้จะสับสนกับบัญชีผู้ใช้ในแอป
          clearLineSessionToken();
          navigate('/profile?line=linked', { replace: true });
        })
        .catch(() => navigate('/profile?line=error', { replace: true }));
      return;
    }

    // ผู้ใช้ LINE จบที่พอร์ทัล LINE เสมอ — /report เป็นช่องทาง guest ล้วน ไม่รับ session นี้แล้ว
    const search = error ? `?error=${encodeURIComponent(error)}` : mode ? `?mode=${mode}` : '';
    navigate(`/line${search}`, { replace: true });
  }, [navigate]);

  return (
    <main className="life-public flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      <span className="sr-only">กำลังดำเนินการเชื่อมบัญชี LINE</span>
    </main>
  );
}
