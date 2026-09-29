// ═══════════════════════════════════════════════════════════════════════════
// Keys shared from the server this API runs on (Movievideomaker's docker-compose), so they don't have
// to be typed twice. Only fills in what this service's own env doesn't set — its own env always wins.
//
//   HOST_KEYS_FILE              JSON { NAME: value } (the bot's keys saved from Telegram); "" = removed
//   HOST_<NAME>                 the host's own .env value (SUPADATA_API_KEY, OPENROUTER_API_KEY, …)
//   HOST_GOOGLE_CREDENTIALS     service-account JSON files, comma-separated, first readable one wins
//                               → GOOGLE_SERVICE_ACCOUNT_JSON
//
// Read once at startup: a key changed on the host needs this service restarted.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const SHARED = ['SUPADATA_API_KEY', 'OPENROUTER_API_KEY'];

const readJson = (path: string): any => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};

const saved = process.env.HOST_KEYS_FILE ? readJson(process.env.HOST_KEYS_FILE) || {} : {};
for (const name of SHARED) {
  if (process.env[name]) continue;
  // a key removed from Telegram ("") overrides the .env one there too
  const value = name in saved ? saved[name] : process.env[`HOST_${name}`];
  if (typeof value === 'string' && value.trim()) process.env[name] = value.trim();
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.VERTEX_API_KEY) {
  for (const path of (process.env.HOST_GOOGLE_CREDENTIALS || '').split(',').map(p => p.trim()).filter(Boolean)) {
    const sa = readJson(path);
    if (sa?.type === 'service_account' && sa.project_id && sa.private_key) {
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(sa);
      break;
    }
  }
}
