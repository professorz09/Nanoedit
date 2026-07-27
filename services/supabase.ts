import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Public, browser-safe values (VITE_ prefix exposes them to the client).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// True only when real keys are present. Lets the app run (logged-out) before
// Supabase is provisioned instead of crashing on a bad client.
export const isSupabaseConfigured =
  !!url && !!anon && !url.includes('YOUR_PROJECT') && !anon.includes('your_supabase');

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anon!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
