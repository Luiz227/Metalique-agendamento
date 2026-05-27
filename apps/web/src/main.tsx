import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.dispatchEvent(new CustomEvent('pwa-install-available', { detail: event }));
});
