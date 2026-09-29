// Real finished Shorts for the home page — drop 9:16 .mp4 (+ optional same-named .webm and .jpg poster) into
// attached_assets/shorts-showcase/; TITLES below may give each a title (else the file name is used).
const TITLES: Record<string, string> = {
  '01-mrbeast-hid-1-million-super-bowl': 'How MrBeast Hid $1,000,000 in a Super Bowl Ad',
  '02-mrbeast-10m-zombie-survival-game': "MrBeast's $10M Zombie Survival Game",
  '03-why-mrbeast-could-blow-up-the-moon': 'Why MrBeast Could Blow Up the Moon',
  '04-mrbeast-thinks-he-could-blow-up-the-moon': 'Why MrBeast Thinks He Could Blow Up the Moon',
  '05-why-walking-dead-zombies-make-no-sense': 'Why Walking Dead Zombies Make No Sense',
};

const videos = import.meta.glob('../attached_assets/shorts-showcase/*.{mp4,MP4}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const webms = import.meta.glob('../attached_assets/shorts-showcase/*.{webm,WEBM}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const posters = import.meta.glob('../attached_assets/shorts-showcase/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const stem = (path: string) => path.split('/').pop()!.replace(/\.[^.]+$/, '');
const byStem = (files: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(files).map(([p, url]) => [stem(p), url]));
const posterFor = byStem(posters);
const webmFor = byStem(webms);

export interface HomeShort { url: string; webm?: string; poster?: string; title: string }

export const HOME_SHORTS: HomeShort[] = Object.entries(videos)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url]) => {
    const key = stem(path);
    const title = TITLES[key]
      || key.replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { url, webm: webmFor[key], poster: posterFor[key], title };
  });
