import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: ''
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Falha ao carregar o sistema.'
    };
  }

  componentDidCatch(error: unknown) {
    console.error('Erro global no frontend:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b', color: '#fafafa', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 560, border: '1px solid #27272a', borderRadius: 16, padding: 24, background: '#18181b' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>O sistema encontrou um erro</h1>
          <p style={{ color: '#d4d4d8', lineHeight: 1.5, marginBottom: 16 }}>
            {this.state.message || 'Nao foi possivel abrir a tela atual.'}
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', cursor: 'pointer' }}
            >
              Recarregar pagina
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.clear();
                sessionStorage.clear();
                window.location.href = '/login';
              }}
              style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', borderRadius: 10, padding: '10px 16px', cursor: 'pointer' }}
            >
              Limpar sessao e entrar de novo
            </button>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(async (registration) => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((item) => item.scope !== registration.scope)
            .map((item) => item.unregister())
        );
      })
      .catch(() => undefined);
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.dispatchEvent(new CustomEvent('pwa-install-available', { detail: event }));
});
