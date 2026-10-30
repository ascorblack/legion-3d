// Excerpt of the site's own anti-bot telemetry (mine.js, «Копать» → tele() → tlPi), copied verbatim from the page of
// 2026-10-30 16:07 (site dump .local/site-1030-1607). Used ONLY by test/fetch-telemetry.test.ts and e2e/fetch-tee.mjs to run the
// real detector against our bridge. Site code, shown here for compatibility testing; refresh it when the site changes
// (the test compares it with the freshest dump in .local when one exists).
  const natv = (f) => { try { return typeof f === 'function' && /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(f)); } catch (e) { return true; } };   // не прочитать - не признак
  /* 30.10 (репорт #2168, авто-майнер): подменены ли функции страницы - биты: 1 - fetch, 2 - requestAnimationFrame (бывает и у
     расширений браузера), 4 - функции самой шахты (LGMine.open / onEvent, LGMineBiome.paint / off - их меняет только чужой скрипт,
     чтобы читать состояние шахты и вид). Только добавка к оценке у стримера; несколько сравнений на «Копать», без нагрузки */
  function tlPi() {
    let b = 0;
    try {
      // своя обёртка сайта (src/gateway/static.ts, LG_FETCH) - не подмена, если под ней был родной fetch
      const F = window.LG_FETCH, fOwn = !!(F && window.fetch === F.w && F.n);
      if (typeof window.fetch === 'function' && !natv(window.fetch) && !fOwn) b |= 1;
      if (typeof window.requestAnimationFrame === 'function' && !natv(window.requestAnimationFrame)) b |= 2;
      const M = window.LGMine, B = window.LGMineBiome;
      if ((M && (M.open !== open || M.onEvent !== onEvent)) || (B && typeof B.own === 'function' && !B.own())) b |= 4;
    } catch (e) {
      // не прочитать - не признак
      return 0;
    }
    return b;
  }
