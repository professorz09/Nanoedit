import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { getPlan } from '../services/plans';
import StyleManager from './StyleManager';

interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
}

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

const Account: React.FC<Props> = ({ onUpgrade, onLogin }) => {
  const { user, profile, totalCredits, signOut } = useAuth();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!supabase || !user) return;
    setLoadingLedger(true);
    supabase
      .from('credit_ledger')
      .select('id, delta, reason, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (alive && data) setLedger(data as LedgerRow[]);
      })
      .then(() => alive && setLoadingLedger(false));
    return () => { alive = false; };
  }, [user]);

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
        <div className="w-14 h-14 rounded-2xl bg-thumb-red text-white flex items-center justify-center text-xl font-black shrink-0">
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

      {/* Purchase & usage history */}
      <div className="mt-6">
        <h2 className="text-sm font-black uppercase tracking-wider text-thumb-sub mb-3">Purchases & usage</h2>
        <div className="thumb-glass rounded-2xl divide-y divide-thumb-line overflow-hidden">
          {loadingLedger ? (
            <p className="text-sm text-thumb-sub p-5">Loading…</p>
          ) : ledger.length === 0 ? (
            <p className="text-sm text-thumb-sub p-5">No activity yet. Purchases and credit usage will appear here.</p>
          ) : (
            ledger.map(row => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-thumb-ink capitalize truncate">{row.reason.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-thumb-sub">{fmtDate(row.created_at)}</p>
                </div>
                <span className={`text-sm font-black shrink-0 ${row.delta >= 0 ? 'text-thumb-green' : 'text-thumb-red'}`}>
                  {row.delta >= 0 ? `+${row.delta}` : row.delta}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Custom styles + personas */}
      <StyleManager />
    </section>
  );
};

export default Account;
