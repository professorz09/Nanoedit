import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const GoogleG = (p: any) => (
  <svg viewBox="0 0 48 48" width="20" height="20" {...p}>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 4.5 29.4 2.5 24 2.5 12.1 2.5 2.5 12.1 2.5 24S12.1 45.5 24 45.5 45.5 35.9 45.5 24c0-1.2-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M5.3 14.7l6.6 4.8C13.6 15.1 18.4 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 4.5 29.4 2.5 24 2.5 16.3 2.5 9.6 6.9 5.3 14.7z" />
    <path fill="#4CAF50" d="M24 45.5c5.3 0 10.1-2 13.7-5.3l-6.3-5.2c-2 1.5-4.6 2.4-7.4 2.4-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.5 41 16.2 45.5 24 45.5z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4 5.5l6.3 5.2C41.6 35.9 45.5 30.5 45.5 24c0-1.2-.1-2.4-.4-3.5z" />
  </svg>
);

interface Props {
  open: boolean;
  onClose: () => void;
  reason?: string;   // optional context line, e.g. "Log in to generate"
}

const AuthModal: React.FC<Props> = ({ open, onClose, reason }) => {
  const { signInWithGoogle, configured } = useAuth();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in-up"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-thumb-card border border-thumb-line p-7 text-center shadow-2xl"
      >
        <div className="thumb-btn w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-white mb-5">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" /></svg>
        </div>
        <h2 className="text-2xl font-black tracking-tight text-thumb-ink">Welcome to PodcastFlux</h2>
        <p className="text-sm text-thumb-sub mt-2">{reason || 'Log in to create and manage your thumbnails.'}</p>

        <button
          onClick={signInWithGoogle}
          disabled={!configured}
          className="mt-6 w-full py-3.5 rounded-2xl bg-white text-[#1f1f1f] font-bold text-[15px] flex items-center justify-center gap-3 border border-thumb-line hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <GoogleG /> Continue with Google
        </button>

        {!configured && (
          <p className="mt-3 text-xs text-thumb-red">Auth isn’t configured yet — add your Supabase keys to enable login.</p>
        )}

        <p className="mt-5 text-[11px] text-thumb-sub leading-relaxed">
          By continuing you agree to our Terms & Privacy Policy.
        </p>

        <button onClick={onClose} className="mt-4 text-xs font-semibold text-thumb-sub hover:text-thumb-ink">Maybe later</button>
      </div>
    </div>
  );
};

export default AuthModal;
