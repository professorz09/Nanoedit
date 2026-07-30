import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import type { PlanId } from '../services/plans';

export interface Profile {
  id: string;
  email: string | null;
  plan: PlanId;
  credits: number;
  addon_credits: number;
  renews_at: string | null;
}

interface AuthValue {
  ready: boolean;                 // initial session check done
  configured: boolean;            // Supabase keys present
  user: User | null;
  profile: Profile | null;
  totalCredits: number;           // credits + addon_credits
  creditsLoading: boolean;        // logged in but profile/credits not fetched yet
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (u: User | null) => {
    if (!supabase || !u) { setProfile(null); setProfileLoading(false); return; }
    setProfileLoading(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, plan, credits, addon_credits, renews_at')
        .eq('id', u.id)
        .single();
      if (data) setProfile(data as Profile);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const s = data.session as Session | null;
      setUser(s?.user ?? null);
      loadProfile(s?.user ?? null).finally(() => mounted && setReady(true));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      loadProfile(session?.user ?? null);
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(() => loadProfile(user), [loadProfile, user]);

  const totalCredits = (profile?.credits ?? 0) + (profile?.addon_credits ?? 0);
  // Logged in but credits not fetched yet — used to show a skeleton instead of a "0" flash.
  const creditsLoading = !!user && !profile && (profileLoading || !ready);

  return (
    <AuthContext.Provider
      value={{ ready, configured: isSupabaseConfigured, user, profile, totalCredits, creditsLoading, signInWithGoogle, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
};
