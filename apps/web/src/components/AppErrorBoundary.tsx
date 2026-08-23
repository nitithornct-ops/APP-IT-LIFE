import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Last-resort UI for render/lazy-chunk failures so the app never leaves a blank screen. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(JSON.stringify({
      msg: 'react_render_failed',
      errorName: error.name,
      errorMessage: error.message,
      componentStack: info.componentStack,
    }));
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" role="alert">
          <h1 className="text-xl font-bold text-slate-900">ไม่สามารถแสดงหน้านี้ได้</h1>
          <p className="mt-3 text-sm text-slate-600">ลองโหลดหน้าใหม่ หากยังพบปัญหาให้แจ้งผู้ดูแลระบบพร้อมเวลาที่เกิดเหตุ</p>
          <button
            type="button"
            className="mt-6 rounded-life bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
            onClick={() => window.location.reload()}
          >
            โหลดหน้าใหม่
          </button>
        </section>
      </main>
    );
  }
}
