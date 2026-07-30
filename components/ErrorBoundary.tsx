import React from 'react';

interface Props { children: React.ReactNode; }
interface State { error: Error | null; }

// App-wide safety net: if any render throws, show a recoverable fallback instead
// of a blank white screen. Lazy-chunk load failures (e.g. a stale hashed chunk
// after a redeploy) also land here — "Reload" fetches the fresh bundle.
// The project ships without @types/react, so React.Component's inherited
// members aren't visible to tsc — declare the ones we use explicitly.
class ErrorBoundary extends React.Component {
  declare props: Props;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('App error boundary caught:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-nano-bg text-nano-text flex items-center justify-center p-4 font-sans">
          <div className="max-w-md w-full bg-nano-card border border-zinc-800 rounded-2xl p-8 text-center space-y-4 shadow-2xl">
            <h1 className="text-xl font-bold text-white">Something went wrong</h1>
            <p className="text-sm text-zinc-400">
              An unexpected error occurred. Reloading usually fixes it — your saved work is kept.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-nano-accent hover:bg-nano-accentHover text-white font-bold rounded-xl transition-all shadow-lg"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
