// Shorts Maker API — the render server (Movievideomaker's shortsbot/web.py) that finds the Shorts in a
// YouTube video, renders one when it's downloaded, and zips a project. It checks the same Supabase login
// and charges the same credits as the rest of the app; this file only sends the signed-in user's token.
import { supabase } from './supabase';

const BASE = ((import.meta.env.VITE_SHORTS_API_URL as string | undefined) || '').replace(/\/$/, '');

export const isShortsConfigured = !!BASE;

export type ShortStatus = 'idle' | 'queued' | 'rendering' | 'ready' | 'failed';

export interface ShortClip {
  id: number;
  idx: number;
  start: number;
  end: number;
  orig_start: number;
  orig_end: number;
  title: string;
  description: string;
  score: number | null;
  status: ShortStatus;
  stage: string;
  error: string | null;
  paid: boolean;
  download: string | null;
}

export interface ShortsProject {
  id: number;
  url: string;
  video_id: string | null;
  title: string;
  thumb: string | null;
  duration: number | null;
  status: 'finding' | 'ready' | 'failed';
  error: string | null;
  style: string | null;
  subtitles: string | null;
  length: string | null;
  created_at: number | null;
  count: number | null;
  shorts?: ShortClip[];
  zip?: string;
}

export interface NewProject {
  url: string;
  length: string;
  subtitles: string;
  style: string;
  // Studio picks (components/ShortsStylePicker.tsx)
  bg?: string;
  caption_look?: string;
  fx?: string[] | 'auto';
  sfx?: boolean;
  fit?: string;
  count?: number;
}

const call = async <T>(path: string, body?: unknown): Promise<T> => {
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong. Please try again.');
  return data as T;
};

export const listProjects = () => call<{ projects: ShortsProject[] }>('/api/projects').then(r => r.projects);
export const getProject = (id: number) => call<ShortsProject>(`/api/projects/${id}`);
export const createProject = (p: NewProject) => call<{ id: number }>('/api/projects', p).then(r => r.id);
export const trimShort = (id: number, start: number, end: number) =>
  call<{ start: number; end: number }>(`/api/shorts/${id}/trim`, { start, end });
export const renderShort = (id: number) => call<{ queued: number[] }>(`/api/shorts/${id}/render`, {});
export const renderAll = (projectId: number) => call<{ queued: number[] }>(`/api/projects/${projectId}/render_all`, {});

// A file download without leaving the page (the server sends it as an attachment)
export const startDownload = (url: string) => {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
