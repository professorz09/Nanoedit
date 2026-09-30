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
  view?: string | null; // the made Short, streamed for the card's player (only while its file is kept)
  position?: number | null; // while waiting to be made: its place in line (1 = next)
  frame?: string | null; // a picture from this Short's own moment (until it's taken, the video's thumbnail)
  expires_at?: number | null; // a made Short: when its file is deleted (unix seconds)
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
  options?: { real_images?: boolean; bg?: string; caption_look?: string; fx?: string[] | null; sfx?: boolean; fit?: string };
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
// look: a one-off style for this make only (the Short's "Video style") — it's made again in it even when already
// made; nothing is saved, so its next make is the project's style again
export interface OneOffLook { style: string; subtitles: string; bg: string; caption_look: string; fx: string[]; sfx: boolean; fit: string }
/** look: a one-off style for this make; remake: make an already made Short again as it is */
export const renderShort = (id: number, look?: OneOffLook, remake = false) =>
  call<{ queued: number[] }>(`/api/shorts/${id}/render`, { ...(look ? { look } : {}), ...(remake ? { remake: true } : {}) });
export const renderAll = (projectId: number) => call<{ queued: number[] }>(`/api/projects/${projectId}/render_all`, {});

// user-requested ("user ko turant kholne me bhi asani hogi"): the projects and their Shorts are kept in Supabase
// (shorts_projects / shorts_clips, written by the render server; RLS lets a user read only their own), so the page
// shows them straight from there at once — the render server's answer (download links, live render stages)
// replaces it a moment later. null when Supabase or those tables aren't there, so the page just waits for the server.
const PROJECT_COLUMNS = 'id,url,video_id,title,thumb,duration,status,error,style,subtitles,length,created_at';

const clipFromRow = (r: any): ShortClip => ({
  id: r.id, idx: r.idx, start: r.start_sec, end: r.end_sec, orig_start: r.orig_start, orig_end: r.orig_end,
  title: r.title || '', description: r.description || '', score: r.score ?? null,
  status: (['idle', 'queued', 'rendering', 'ready', 'failed'].includes(r.status) ? r.status : 'idle') as ShortStatus,
  stage: '', error: r.error ?? null, paid: !!r.charged, download: null, // links come from the server
});

const projectFromRow = (r: any): ShortsProject => ({
  id: r.id, url: r.url, video_id: r.video_id ?? null, title: r.title || 'YouTube video', thumb: r.thumb ?? null,
  duration: r.duration ?? null, status: r.status, error: r.error ?? null, style: r.style ?? null,
  subtitles: r.subtitles ?? null, length: r.length ?? null, created_at: r.created_at ?? null,
  count: Array.isArray(r.shorts_clips) ? (r.shorts_clips[0]?.count ?? null) : null,
});

export const quickProjects = async (): Promise<ShortsProject[] | null> => {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('shorts_projects')
      .select(`${PROJECT_COLUMNS},shorts_clips(count)`).order('id', { ascending: false }).limit(50);
    return error || !data ? null : data.map(projectFromRow);
  } catch {
    return null;
  }
};

export const quickProject = async (id: number): Promise<ShortsProject | null> => {
  if (!supabase) return null;
  try {
    const [{ data: row, error }, { data: clips, error: clipsError }] = await Promise.all([
      supabase.from('shorts_projects').select(PROJECT_COLUMNS).eq('id', id).maybeSingle(),
      supabase.from('shorts_clips').select('*').eq('project_id', id).order('idx', { ascending: true }),
    ]);
    if (error || clipsError || !row) return null;
    const shorts = (clips || []).map(clipFromRow);
    return { ...projectFromRow(row), shorts, count: shorts.length };
  } catch {
    return null;
  }
};

// A file download without leaving the page (the server sends it as an attachment) — through a hidden frame, not a link click: the file is on the render server (another site), and a link to it
// counts as leaving the page, so phone Chrome kept its page-loading bar stuck after the download had finished.
export const startDownload = (url: string) => {
  const f = document.createElement('iframe');
  f.style.display = 'none';
  f.src = url;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 60_000);  // long enough for the download to have started
};

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
