import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// The PWA install feature (and its service worker) has been removed — its
// fetch handler was breaking image loads across the app (see public/sw.js).
// Still registering it here on purpose: any browser that already installed
// the OLD worker keeps running it indefinitely otherwise (removing this
// registration call does NOT uninstall an existing service worker). Pointing
// at the same URL with new content makes the browser install the kill-switch
// version in public/sw.js, which unregisters itself and reloads open tabs —
// safe to delete this block once existing installs have had time to clear.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* best-effort cleanup */ });
  });
}