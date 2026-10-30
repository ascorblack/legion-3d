/** One-off update notice, mounted in the game UI shadow tree. */
export function mountWhatsNew(root: HTMLElement, version: string, bullets: readonly string[], reportUrl: () => string): () => void {
  const card = document.createElement('aside');
  card.setAttribute('aria-label', `Что нового в версии ${version}`);
  card.style.cssText = 'position:fixed;right:22px;bottom:78px;z-index:200;pointer-events:auto;width:min(330px,calc(100vw - 44px));padding:18px 20px;background:#171c2beF;border:1px solid #a48757;border-radius:12px;box-shadow:0 16px 40px #050912aa;color:#f5e8d2;font:14px/1.5 system-ui,sans-serif';
  const head = document.createElement('div'); head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:17px';
  const title = document.createElement('span'); title.textContent = `Что нового · ${version}`;
  const close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', 'Закрыть'); close.textContent = '×'; close.style.cssText = 'color:#f5e8d2;background:none;border:0;cursor:pointer;font-size:25px;line-height:1';
  head.append(title, close);
  const list = document.createElement('ul'); list.style.cssText = 'padding-left:18px;margin:12px 0';
  for (const text of bullets.slice(0, 3)) { const li = document.createElement('li'); li.textContent = text; li.style.marginBottom = '6px'; list.append(li); }
  const report = document.createElement('a'); report.href = reportUrl(); report.target = '_blank'; report.rel = 'noopener noreferrer'; report.textContent = 'Сообщить об ошибке ↗'; report.style.color = '#e6bd7b';
  report.addEventListener('click', () => { report.href = reportUrl(); });
  card.append(head, list, report); root.append(card);
  const onPhoto = (event: Event) => { card.style.display = (event as CustomEvent<{ on: boolean }>).detail?.on ? 'none' : ''; };
  window.addEventListener('l3d:photo', onPhoto);
  // in the 3D mine the right column is the mine card and the left one the floor map + «Как начать» (up to x≈540): the notice
  // moves to the top, between them
  const onMine = (event: Event) => {
    const on = !!(event as CustomEvent<{ inMine?: boolean }>).detail?.inMine;
    card.style.right = on ? 'auto' : '22px'; card.style.bottom = on ? 'auto' : '78px';
    card.style.left = on ? 'max(552px, calc(50% - 105px))' : ''; card.style.top = on ? '118px' : '';
  };
  window.addEventListener('l3d:mine-status', onMine);
  const dispose = () => { window.removeEventListener('l3d:photo', onPhoto); window.removeEventListener('l3d:mine-status', onMine); card.remove(); };
  close.addEventListener('click', dispose);
  return dispose;
}
