// The inline script the site puts in <head> of every channel page (verbatim; LG_BASE is a placeholder channel).
// It wraps window.fetch (adds LG_BASE to '/api/…') and publishes LG_FETCH = { w: its wrapper, n: was the function under it native }.
// Page of 2026-10-30; the mine telemetry (site-telemetry.js) trusts window.fetch only if it is the native one or exactly this wrapper over a native one.
// Page of 2026-11-17 evening: /lib/guard.js (window.LGGuard, the anti-bot guard) runs before it and already put its own `guarded` on
// window.fetch, so `n` is read from LGGuard.under(o) (the native fetch under the guard) when the guard is there — the same answer
// for an honest page. Without LGGuard (the 10-30 tests) it behaves exactly like the old one.
window.LG_BASE="/c/channel";(function(){var o=window.fetch,f=o.bind(window),w=function(u,o2){if(typeof u==='string'&&u.indexOf('/api/')===0)u=window.LG_BASE+u;return f(u,o2);};var g=window.LGGuard,b=(g&&typeof g.under==='function'&&g.under(o))||o,n=false;try{n=/\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(b));}catch(e){n=true;}try{Object.defineProperty(window,'LG_FETCH',{value:Object.freeze({w:w,n:n})});}catch(e){window.LG_FETCH={w:w,n:n};}window.fetch=w;})();
