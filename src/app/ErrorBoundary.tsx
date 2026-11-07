import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Mencegah satu galat tampilan mengosongkan seluruh aplikasi. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Galat tampilan:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="connect" role="alert" style={{ padding: 16 }}>
        <h1>Terjadi galat pada tampilan</h1>
        <p className="lead">Keyboard tidak diubah oleh galat ini. Muat ulang halaman untuk melanjutkan.</p>
        <pre className="mono">{this.state.error.message}</pre>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Muat ulang
        </button>
      </div>
    );
  }
}
