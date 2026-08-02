import React, { useEffect } from 'react';

// A styled stand-in for window.confirm() — the native browser dialog looks
// completely out of place next to the rest of the app's UI and can't be
// themed. Used for destructive confirmations (delete a thumbnail, clear the
// gallery) that need an explicit yes before acting.
interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<Props> = ({ open, title, message, confirmLabel = 'Delete', onConfirm, onCancel }) => {
  // Same reasoning as ChangeFaceModal — a fixed-overlay modal shouldn't leave
  // the page behind it scrollable.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-3xl bg-thumb-card border border-thumb-line p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-black text-thumb-ink">{title}</h3>
        <p className="text-sm text-thumb-sub mt-2 leading-relaxed">{message}</p>
        <div className="flex items-center gap-2 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl bg-thumb-soft border border-thumb-line text-thumb-ink text-sm font-bold hover:bg-thumb-line/60 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 rounded-2xl bg-thumb-redDark text-white text-sm font-black hover:bg-thumb-red transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
