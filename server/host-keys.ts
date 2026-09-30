// ═══════════════════════════════════════════════════════════════════════════
// Keys shared from the server this API runs on (Movievideomaker's docker-compose), so they don't have
// to be typed twice. Only fills in what this service's own env doesn't set — its own env always wins.
//
//   HOST_KEYS_FILE              JSON { NAME: value } (the bot's keys saved from Telegram); "" = removed
//   HOST_<NAME>                 the host's own .env value (SUPADATA_API_KEY, OPENROUTER_API_KEY, …)
//   HOST_GOOGLE_CREDENTIALS     service-account JSON files, comma-separated, first readable one wins
//                               → GOOGLE_SERVICE_ACCOUNT_JSON
//
// Read at startup and again every minute (user-requested): a key replaced from the bot's /keys reaches this
// service within a minute, no restart. (.env values come in through docker-compose, so a .env edit still
// needs a restart.)
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const SHARED = ['SUPADATA_API_KEY', 'OPENROUTER_API_KEY'];

const readJson = (path: string): any => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};

// what this service's own env set is never replaced — only what came from the host
const OWN = new Set([...SHARED, 'GOOGLE_SERVICE_ACCOUNT_JSON', 'VERTEX_API_KEY'].filter(n => process.env[n]));

const load = () => {
  const saved = process.env.HOST_KEYS_FILE ? readJson(process.env.HOST_KEYS_FILE) || {} : {};
  for (const name of SHARED) {
    if (OWN.has(name)) continue;
    // a key removed from Telegram ("") overrides the .env one there too
    const value = name in saved ? saved[name] : process.env[`HOST_${name}`];
    if (typeof value === 'string' && value.trim()) process.env[name] = value.trim();
    else delete process.env[name];
  }

  if (!OWN.has('GOOGLE_SERVICE_ACCOUNT_JSON') && !OWN.has('VERTEX_API_KEY')) {
    let found: string | undefined;
    for (const path of (process.env.HOST_GOOGLE_CREDENTIALS || '').split(',').map(p => p.trim()).filter(Boolean)) {
      const sa = readJson(path);
      if (sa?.type === 'service_account' && sa.project_id && sa.private_key) { found = JSON.stringify(sa); break; }
    }
    if (found) process.env.GOOGLE_SERVICE_ACCOUNT_JSON = found;
    else delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  }
};

load();
// the handlers read process.env on every request, so a refreshed key is used from the next one
setInterval(load, 60_000).unref();
