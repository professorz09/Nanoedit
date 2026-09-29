import { useEffect } from 'react';

// Freeze the page behind a popup/modal while `active` is true.
// `overflow: hidden` alone doesn't stop touch-scrolling on iPhone/iPad Safari, so the body is pinned with
// `position: fixed` at the current scroll offset and put back on unlock. Counted, so stacked popups
// (a confirm on top of a picker) only unlock when the last one closes.
let locks = 0;
let saved: { y: number; html: string; body: string } | null = null;

const lock = () => {
  if (locks++ > 0) return;
  const html = document.documentElement, body = document.body;
  const y = window.scrollY;
  const bar = window.innerWidth - html.clientWidth; // keep the layout from jumping where a scrollbar disappears
  saved = { y, html: html.style.cssText, body: body.style.cssText };
  html.style.overflow = 'hidden';
  Object.assign(body.style, { position: 'fixed', top: `-${y}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' });
  if (bar > 0) body.style.paddingRight = `${bar}px`;
};

const unlock = () => {
  if (--locks > 0 || !saved) return;
  const html = document.documentElement;
  html.style.cssText = saved.html;
  document.body.style.cssText = saved.body;
  // jump straight back, even if the page uses smooth scrolling
  const behavior = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  window.scrollTo(0, saved.y);
  html.style.scrollBehavior = behavior;
  saved = null;
};

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
