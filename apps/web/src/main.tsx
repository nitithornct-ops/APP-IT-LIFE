import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';
import './styles/fonts.css';
import './styles/system.css';
import { AuthProvider } from './stores/authContext';
import { ThemeProvider } from './stores/themeContext';
import { ToastProvider } from './components/ui/Toast';
import { initializeDensity } from './stores/density';

initializeDensity();

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      /**
       * เดิมปิดไว้ ทำให้งานที่คนอื่นแก้ระหว่างที่เราสลับไปทำอย่างอื่นไม่ขึ้นเลยจนกว่าจะกด F5
       * ซึ่งเป็นกันทุกคนที่เปิดค้างไว้ (ผู้ใช้แจ้ง 2026-09-09)
       *
       * staleTime 30 วินาที ยังกันการยิงซ้ำถี่ ๆ อยู่ — สลับแท็บกลับมาจะดึงใหม่เฉพาะ query
       * ที่ค้างเกิน 30 วินาทีเท่านั้น ไม่ใช่ทั้งหน้าจอทุกครั้ง
       */
      refetchOnWindowFocus: true,
    },
  },
});

// A data router provides navigation blocking for unsaved Form Studio edits,
// while the existing App continues to own its established route tree.
const router = createBrowserRouter([{ path: '*', element: (
  <ThemeProvider>
    <AuthProvider>
      <ToastProvider><App /></ToastProvider>
    </AuthProvider>
  </ThemeProvider>
) }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
