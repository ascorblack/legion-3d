/**
 * Will the 3D game start by itself on this page load? The launcher (src/content/main.ts, document_idle) uses it to boot
 * 3D and to put the fetch tee (src/net/fetch-tee.ts) on right away, so the City's first answers are caught.
 * Settings → Прочее → «При входе открывать» (src/features/start-mode.ts) writes localStorage 'l3d.start':
 * '2d' (default) — the classic site, 3D by the button / F8; '3d' — always 3D; 'last' — the mode used last time
 * (localStorage 'l3d.auto', written by F8). 'l3d.noWebGL' in sessionStorage = WebGL failed earlier in this session.
 */
export const LS_START = 'l3d.start';
export const LS_AUTO = 'l3d.auto';
export const SS_NOGL = 'l3d.noWebGL';

interface Win { localStorage?: Storage; sessionStorage?: Storage; location?: { pathname: string } }

export function autoStart3d(w: Win): boolean {
  try {
    if (w.location && !/^\/c\/[^/]+\/?$/.test(w.location.pathname)) return false;   // only the channel's main page boots 3D
    const m = w.localStorage?.getItem(LS_START) || '2d';
    const auto = m === '3d' || (m === 'last' && w.localStorage?.getItem(LS_AUTO) !== '0');
    if (!auto) return false;
    try { if (w.sessionStorage?.getItem(SS_NOGL)) return false; } catch { /* no session storage: assume WebGL works */ }
    return true;
  } catch { return false; }   // storage blocked: default 2D
}
