import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileWidgetId = string;

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: 'auto';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => TurnstileWidgetId;
  reset: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_URL}"]`);
    const script = existingScript ?? document.createElement('script');

    const handleLoad = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile API did not initialize'));
    };
    const handleError = () => reject(new Error('Turnstile script failed to load'));

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existingScript) {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    turnstileScriptPromise = null;
    throw error;
  });

  return turnstileScriptPromise;
}

export type TurnstileWidgetHandle = {
  reset: () => void;
};

type TurnstileWidgetProps = {
  action: 'login' | 'password_reset';
  onTokenChange: (token: string) => void;
};

export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ action, onTokenChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

    useImperativeHandle(ref, () => ({
      reset() {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
        onTokenChange('');
      },
    }));

    useEffect(() => {
      let cancelled = false;

      if (!sitekey) {
        setLoadFailed(true);
        return;
      }

      void loadTurnstile()
        .then((turnstile) => {
          if (cancelled || !containerRef.current || widgetIdRef.current) return;
          widgetIdRef.current = turnstile.render(containerRef.current, {
            sitekey,
            action,
            theme: 'auto',
            callback: (token) => onTokenChange(token),
            'expired-callback': () => onTokenChange(''),
            'error-callback': () => onTokenChange(''),
          });
        })
        .catch(() => {
          if (!cancelled) setLoadFailed(true);
        });

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [action, onTokenChange, sitekey]);

    return (
      <div className="flex min-h-[65px] flex-col items-center justify-center" aria-live="polite">
        <div ref={containerRef} />
        {loadFailed && (
          <p className="text-center text-xs text-red-600 dark:text-red-300">
            ไม่สามารถโหลดระบบยืนยันความปลอดภัยได้ กรุณารีเฟรชหน้าแล้วลองใหม่
          </p>
        )}
      </div>
    );
  },
);
