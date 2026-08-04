import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { getPlan } from '../services/plans';
import { fetchPersonas, savePersona, deletePersona, Persona } from '../services/personasService';
import { fetchMyStyles, uploadMyStyle, deleteMyStyle, UserStyle } from '../services/stylesService';

interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

// Shared "upload tile + thumbnail grid" for the Personas/Styles library
// sections below — the only place in the app a user can add a saved face or a
// custom style; every picker elsewhere (ThumbnailStudio, EditorView) is
// select-only and just lists what's saved here.
const AssetLibrary: React.FC<{
  title: string;
  hint: string;
  items: { id: string; url: string; name: string | null }[] | null;
  adding: boolean;
  error: string | null;
  onAdd: (file: File) => void;
  onRemove: (id: string) => void;
}> = ({ title, hint, items, adding, error, onAdd, onRemove }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-6">
      <h2 className="text-sm font-black uppercase tracking-wider text-thumb-sub mb-1">{title}</h2>
      <p className="text-xs text-thumb-sub mb-3">{hint}</p>
      {error && <p className="text-xs text-thumb-red mb-2">{error}</p>}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={adding}
          aria-label={`Upload to ${title}`}
          className="aspect-square rounded-2xl border-2 border-dashed border-thumb-line hover:border-thumb-red/40 bg-thumb-soft text-thumb-sub hover:text-thumb-red flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50"
        >
          {adding
            ? <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            : <><span className="text-2xl leading-none">+</span><span className="text-[11px] font-bold">Add</span></>}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f && f.type.startsWith('image/')) onAdd(f);
          }}
        />
        {items === null ? (
          <p className="col-span-full text-sm text-thumb-sub self-center">Loading…</p>
        ) : (
          items.map(it => (
            <div key={it.id} className="relative aspect-square rounded-2xl overflow-hidden border border-thumb-line bg-black/40 group">
              <img src={it.url} alt={it.name || ''} className="absolute inset-0 w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(it.id)}
                aria-label="Remove"
                className="absolute top-1 right-1 w-6 h-6 bg-black/60 hover:bg-red-500/80 text-white rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

interface Props {
  onUpgrade: () => void;
  onLogin: () => void;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
};

// Ledger rows for purchases are `purchase:<plan|addon>:<paymentId>` (see
// supabase/functions/verify-payment) — turn that into a readable label
// instead of showing the raw reason string (which embeds a payment id).
const describePurchase = (reason: string) => {
  const kind = reason.split(':')[1];
  if (kind === 'addon') return 'Credit pack';
  const plan = getPlan(kind as Parameters<typeof getPlan>[0]);
  return plan ? `${plan.name} plan` : 'Plan purchase';
};

const Account: React.FC<Props> = ({ onUpgrade, onLogin }) => {
  const { user, profile, totalCredits, signOut } = useAuth();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [personaAdding, setPersonaAdding] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);

  const [myStyles, setMyStyles] = useState<UserStyle[] | null>(null);
  const [styleAdding, setStyleAdding] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!supabase || !user) return;
    setLoadingLedger(true);
    supabase
      .from('credit_ledger')
      .select('id, delta, reason, created_at')
      .eq('user_id', user.id)
      // Purchases only (Dodo Payments plan/add-on buys) — generation spend, refunds
      // and signup/expiry adjustments are usage/bookkeeping, not a purchase.
      .like('reason', 'purchase:%')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (alive && data) setLedger(data as LedgerRow[]);
      })
      .then(() => alive && setLoadingLedger(false));
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    let alive = true;
    if (!user) return;
    fetchPersonas().then(items => { if (alive) setPersonas(items); });
    fetchMyStyles().then(items => { if (alive) setMyStyles(items); });
    return () => { alive = false; };
  }, [user]);

  const addPersona = async (file: File) => {
    setPersonaError(null);
    setPersonaAdding(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const saved = await savePersona(dataUrl);
      setPersonas(prev => [saved, ...(prev ?? [])]);
    } catch (e: any) {
      setPersonaError(e?.message || 'Could not save that face.');
    } finally {
      setPersonaAdding(false);
    }
  };

  const removePersona = async (id: string) => {
    const p = personas?.find(x => x.id === id);
    if (!p) return;
    setPersonaError(null);
    const ok = await deletePersona(p);
    if (ok) setPersonas(prev => prev?.filter(x => x.id !== id) ?? null);
    else setPersonaError('Could not remove that face. Try again.');
  };

  const addStyle = async (file: File) => {
    setStyleError(null);
    setStyleAdding(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const saved = await uploadMyStyle(dataUrl);
      setMyStyles(prev => [saved, ...(prev ?? [])]);
    } catch (e: any) {
      setStyleError(e?.message || 'Could not save that style.');
    } finally {
      setStyleAdding(false);
    }
  };

  const removeStyle = async (id: string) => {
    const s = myStyles?.find(x => x.id === id);
    if (!s) return;
    setStyleError(null);
    const ok = await deleteMyStyle(s);
    if (ok) setMyStyles(prev => prev?.filter(x => x.id !== id) ?? null);
    else setStyleError('Could not remove that style. Try again.');
  };

  if (!user) {
    return (
      <section className="pt-10 pb-16 text-center max-w-md mx-auto">
        <h1 className="text-3xl font-black tracking-tight">Your account</h1>
        <p className="text-thumb-sub mt-3">Log in to see your credits, plan and purchase history.</p>
        <button onClick={onLogin} className="thumb-btn mt-6 px-6 py-3 rounded-2xl text-white font-bold inline-flex items-center gap-2">
          Log in with Google
        </button>
      </section>
    );
  }

  const planId = profile?.plan ?? 'free';
  const plan = getPlan(planId) ?? { id: 'free' as const, name: 'Free trial' };
  const planCredits = profile?.credits ?? 0;
  const addonCredits = profile?.addon_credits ?? 0;

  return (
    <section className="pt-6 pb-16 max-w-3xl mx-auto">
      {/* Identity */}
      <div className="thumb-glass rounded-3xl p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-thumb-redDark text-white flex items-center justify-center text-xl font-black shrink-0">
          {(user.email?.[0] || 'U').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-black text-thumb-ink truncate">{user.email}</h1>
          <p className="text-sm text-thumb-sub mt-0.5">
            <span className="font-bold text-thumb-ink capitalize">{plan.name}</span> plan
          </p>
        </div>
        <button
          onClick={signOut}
          className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold text-thumb-sub bg-thumb-soft border border-thumb-line hover:text-thumb-red transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Credit summary */}
      <div className="grid sm:grid-cols-3 gap-4 mt-5">
        <div className="thumb-glass rounded-2xl p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Total credits</p>
          <p className="text-4xl font-black text-thumb-ink mt-1">{totalCredits}</p>
          <p className="text-xs text-thumb-sub mt-1">thumbnails you can still generate</p>
        </div>
        <div className="thumb-glass rounded-2xl p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Plan credits</p>
          <p className="text-4xl font-black text-thumb-ink mt-1">{planCredits}</p>
          <p className="text-xs text-thumb-sub mt-1">reset each billing cycle</p>
        </div>
        <div className="thumb-glass rounded-2xl p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Add-on credits</p>
          <p className="text-4xl font-black text-thumb-ink mt-1">{addonCredits}</p>
          <p className="text-xs text-thumb-sub mt-1">never expire</p>
        </div>
      </div>

      {/* Plan / renewal */}
      <div className="thumb-glass rounded-2xl p-5 mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Renews / expires</p>
          <p className="text-lg font-black text-thumb-ink mt-0.5">{fmtDate(profile?.renews_at ?? null)}</p>
        </div>
        <button onClick={onUpgrade} className="thumb-btn text-white font-bold px-5 py-3 rounded-2xl flex items-center gap-2 text-sm">
          {plan.id === 'free' ? 'Upgrade plan' : 'Buy more credits'}
        </button>
      </div>

      {/* Purchase history — purchases only, no generation/usage rows */}
      <div className="mt-6">
        <h2 className="text-sm font-black uppercase tracking-wider text-thumb-sub mb-3">Purchases</h2>
        <div className="thumb-glass rounded-2xl divide-y divide-thumb-line overflow-hidden">
          {loadingLedger ? (
            <p className="text-sm text-thumb-sub p-5">Loading…</p>
          ) : ledger.length === 0 ? (
            <p className="text-sm text-thumb-sub p-5">No purchases yet. Plan and credit-pack purchases will appear here.</p>
          ) : (
            ledger.map(row => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-thumb-ink truncate">{describePurchase(row.reason)}</p>
                  <p className="text-xs text-thumb-sub">{fmtDate(row.created_at)}</p>
                </div>
                <span className="text-sm font-black shrink-0 text-thumb-green">+{row.delta}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Saved faces + custom styles — the only place either can be uploaded.
          Every picker elsewhere (ThumbnailStudio, EditorView) is select-only
          and just lists what's saved here. */}
      <AssetLibrary
        title="Saved faces"
        hint="Upload a face once and reuse it across generations without re-uploading."
        items={personas}
        adding={personaAdding}
        error={personaError}
        onAdd={addPersona}
        onRemove={removePersona}
      />
      <AssetLibrary
        title="Your styles"
        hint="Upload your own reference thumbnails to reuse as a style, or to auto-match against for YouTube-link generations."
        items={myStyles}
        adding={styleAdding}
        error={styleError}
        onAdd={addStyle}
        onRemove={removeStyle}
      />
    </section>
  );
};

export default Account;
