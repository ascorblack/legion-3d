/** Small bottom-right «Вышла версия X — скачать» toast. The link text is plain DOM text; the href is a validated release URL. */
export interface UpdateToast { dispose: () => void }
export function mountUpdateToast(root: HTMLElement, latest: string, url: string, onClose: () => void, ttlMs = 20000): UpdateToast {
  const el = document.createElement('aside');
  el.setAttribute('role', 'status'); el.setAttribute('aria-label', `Вышла версия ${latest}`);
  el.style.cssText = 'position:fixed;right:22px;bottom:150px;z-index:200;pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:min(380px,calc(100vw - 44px));padding:9px 12px 9px 16px;background:#171c2bf2;border:1px solid #a48757;border-radius:10px;box-shadow:0 10px 28px #050912aa;color:#f5e8d2;font:14px/1.4 system-ui,sans-serif';
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = `Вышла версия ${latest} — скачать`;
  a.style.cssText = 'color:#e6bd7b;text-decoration:underline;text-underline-offset:3px';
  const x = document.createElement('button');
  x.type = 'button'; x.setAttribute('aria-label', 'Закрыть'); x.textContent = '✕';
  x.style.cssText = 'color:#f5e8d2;background:none;border:0;cursor:pointer;font-size:16px;line-height:1;padding:4px';
  el.append(a, x); root.append(el);
  let done = false;
  const timer = window.setTimeout(() => close(), ttlMs);
  const onPhoto = (e: Event) => { el.style.display = (e as CustomEvent<{ on: boolean }>).detail?.on ? 'none' : ''; };
  window.addEventListener('l3d:photo', onPhoto);
  function dispose() { if (done) return; done = true; window.clearTimeout(timer); window.removeEventListener('l3d:photo', onPhoto); el.remove(); }
  function close() { if (done) return; dispose(); onClose(); }
  x.addEventListener('click', close);
  a.addEventListener('click', () => { setTimeout(close, 0); });
  return { dispose };
}
