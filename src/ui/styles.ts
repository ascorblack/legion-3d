/** All UI styles (Shadow DOM). Palette vars --l3d-* are overwritten at mount from the site's skin when it is dark. */
export const CSS = String.raw`
:host { all: initial; }
* { box-sizing: border-box; }
.ui {
  --l3d-bg: #1d1620; --l3d-panel: #2a2030; --l3d-panel-2: #221a28; --l3d-ink: #f7eadf; --l3d-mute: #bfaab7;
  --l3d-accent: #ff8fa3; --l3d-accent-d: #c95a72; --l3d-gold: #ffcf6a; --l3d-gold-d: #b8862a; --l3d-up: #8fe39a; --l3d-dn: #ff8f8f;
  --l3d-hd: 'Comfortaa', 'Nunito', 'Trebuchet MS', sans-serif; --l3d-tx: 'Nunito', 'Golos Text', 'Segoe UI', sans-serif;
  --l3d-num: 'Dela Gothic One', 'Russo One', 'Comfortaa', 'Arial Black', sans-serif;
  --line: color-mix(in srgb, var(--l3d-gold) 28%, transparent);
  --ease: cubic-bezier(.2,.8,.2,1);
  --rc-common: #c9ccd6; --rc-uncommon: #4cc95a; --rc-rare: #4aa3ff; --rc-epic: #b06bff; --rc-legendary: #ffb83d;
  position: fixed; inset: 0; pointer-events: none; color: var(--l3d-ink); font: 500 14px/1.35 var(--l3d-tx);
  -webkit-font-smoothing: antialiased; user-select: none; overflow: hidden;
}
.ui.nohud .hud, .ui.inmenu .hud { opacity: 0; visibility: hidden; }
button { font: inherit; color: inherit; }
.emo { font-family: 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif; font-style: normal; }

/* ============================================================= HUD */
.hud { position: absolute; inset: 0; transition: opacity .25s var(--ease); }
.hud > * { position: absolute; }
.vit { left: 16px; top: 14px; display: flex; gap: 11px; align-items: flex-start; pointer-events: auto; }
.medal { width: 54px; height: 54px; border-radius: 50%; position: relative; cursor: pointer; flex: none;
  background: radial-gradient(circle at 35% 30%, #4a3654, var(--l3d-panel-2) 70%);
  box-shadow: 0 0 0 3px var(--l3d-gold), 0 0 0 6px rgba(29,22,32,.85), 0 0 0 7px color-mix(in srgb, var(--l3d-gold) 45%, transparent), 0 8px 18px rgba(0,0,0,.45);
  display: grid; place-items: center; }
.medal .lv { font: 400 21px/1 var(--l3d-num); color: var(--l3d-gold); text-shadow: 0 2px 0 #00000080; }
.medal .lvt { position: absolute; bottom: -9px; left: 50%; transform: translateX(-50%); padding: 2px 9px; border-radius: 999px;
  font: 800 10px/1.2 var(--l3d-tx); letter-spacing: .08em; text-transform: uppercase; color: #2a1d18;
  background: linear-gradient(#ffe39a, var(--l3d-gold)); box-shadow: 0 2px 0 var(--l3d-gold-d); white-space: nowrap; }
.medal .ears { position: absolute; inset: -12px 0 auto; height: 20px; pointer-events: none; }
.medal .ears::before, .medal .ears::after { content: ''; position: absolute; top: 2px; width: 18px; height: 18px; background: var(--l3d-gold);
  clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.medal .ears::before { left: 6px; transform: rotate(-24deg); } .medal .ears::after { right: 6px; transform: rotate(24deg); }
/* the medal follows the channel style (src/ui/index.ts adoptSkin → data-badge): horns for «Чертики», none for the others */
.ui[data-badge=legion] .medal .ears { display: none; }
.ui[data-badge=cherts] .medal .ears::before, .ui[data-badge=cherts] .medal .ears::after { width: 10px; height: 16px; top: 3px; background: linear-gradient(var(--l3d-gold), #b0352a);
  clip-path: polygon(40% 0, 100% 100%, 0 100%); }
.ui[data-badge=cherts] .medal .ears::before { left: 10px; transform: rotate(-16deg); } .ui[data-badge=cherts] .medal .ears::after { right: 10px; transform: rotate(16deg) scaleX(-1); }
.vbox { padding-top: 0; min-width: 220px; }
.vname { display: flex; align-items: baseline; gap: 8px; text-shadow: 0 2px 4px #000a, 0 0 1px #000; }
.vname b { font: 700 16px/1.1 var(--l3d-hd); letter-spacing: .01em; }
.vname span { font: 700 11px/1 var(--l3d-tx); color: var(--l3d-gold); text-transform: uppercase; letter-spacing: .09em; }
.bar { position: relative; height: 15px; margin-top: 5px; border-radius: 999px; width: 228px;
  background: rgba(20,14,24,.78); box-shadow: inset 0 2px 4px #0009, 0 0 0 2px rgba(255,236,200,.18), 0 3px 8px #0006; overflow: hidden; }
.bar.xp { height: 10px; width: 196px; }
.bar i { position: absolute; inset: 2px auto 2px 2px; border-radius: 999px; transition: width .4s var(--ease); max-width: calc(100% - 4px); }
.bar .ghost { background: rgba(255,255,255,.75); transition: width .6s .5s var(--ease); }
.bar.hp .fill { background: linear-gradient(#ffb3c0, #ff6b81 55%, #e04a66); box-shadow: inset 0 -2px 0 #0003, inset 0 2px 0 #fff6; }
.bar.xp .fill { background: linear-gradient(#fff1c2, var(--l3d-gold) 60%, #e7a83c); box-shadow: inset 0 2px 0 #fff7; }
.bar .t { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 800 11px/1 var(--l3d-tx);
  text-shadow: 0 1px 2px #000, 0 0 2px #000; letter-spacing: .03em; }
.bar.xp { height: 11px; } .bar.xp .t { font-size: 9px; }
.bar.low .fill { animation: pulse 1s ease-in-out infinite; }
.bar.dead .fill { background: linear-gradient(#cfc8d8, #8b8398); }
@keyframes pulse { 50% { filter: brightness(1.5) saturate(1.3); } }
.chips { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px 0 7px; border-radius: 999px;
  background: rgba(29,22,32,.78); box-shadow: 0 0 0 1.5px var(--line), 0 3px 8px #0005; font: 800 12px/1 var(--l3d-tx); cursor: default; }
.chip.click { cursor: pointer; } .chip.click:hover { box-shadow: 0 0 0 1.5px var(--l3d-gold), 0 3px 8px #0005; }
.chip.bad { box-shadow: 0 0 0 1.5px var(--l3d-dn); color: var(--l3d-dn); }
.coin { display: inline-block; width: 15px; height: 15px; border-radius: 50%; flex: none; box-shadow: inset 0 -2px 0 #0004, 0 0 0 1.5px #2a2236; }
.coin.g { background: radial-gradient(circle at 35% 30%, #fff1b0, #f2c14e 60%, #b8862a); }
.coin.s { background: radial-gradient(circle at 35% 30%, #ffffff, #c8ccd8 60%, #8a90a4); }
.coin.b { background: radial-gradient(circle at 35% 30%, #f3c39a, #c07a44 60%, #7a4420); }
.coin.svg { background: none; box-shadow: none; width: 18px; height: 18px; } .coin.svg svg { width: 100%; height: 100%; }
.mfloat { position: absolute; font: 800 13px/1 var(--l3d-tx); color: var(--l3d-up); text-shadow: 0 1px 2px #000; animation: mfloat 1.6s var(--ease) forwards; pointer-events: none; }
.mfloat.neg { color: var(--l3d-dn); }
@keyframes mfloat { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-28px); opacity: 0; } }

.ghostban { left: 50%; top: 64px; transform: translateX(-50%); padding: 7px 18px; border-radius: 999px; background: rgba(40,36,56,.85);
  box-shadow: 0 0 0 1.5px #cfc8d8aa; font: 700 13px/1.2 var(--l3d-tx); color: #e9e4f4; }
.ghostban[hidden] { display: none; }

/* compass */
.compass { left: 50%; top: 8px; transform: translateX(-50%); width: 460px; height: 52px; pointer-events: none;
  -webkit-mask: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); mask: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); }
.compass .rail { position: absolute; inset: 9px 0 auto; height: 26px; background: linear-gradient(rgba(20,14,24,.0), rgba(20,14,24,.72) 30%, rgba(20,14,24,.72) 70%, rgba(20,14,24,0));
  border-top: 1.5px solid var(--line); border-bottom: 1.5px solid var(--line); }
.compass .strip { position: absolute; left: 0; top: 0; height: 100%; width: 0; will-change: transform; }
.compass .m { position: absolute; top: 9px; height: 26px; transform: translateX(-50%); display: flex; align-items: center; white-space: nowrap; }
.compass .m.tk::before { content: ''; width: 2px; height: 8px; border-radius: 2px; background: #f7eadf77; }
.compass .m.c { font: 400 14px/1 var(--l3d-num); color: var(--l3d-ink); text-shadow: 0 1px 2px #000; }
.compass .m.c.n { color: var(--l3d-accent); }
.compass .m.b { font: 800 11.5px/1 var(--l3d-tx); color: var(--l3d-gold); gap: 5px; text-shadow: 0 1px 2px #000; flex-direction: column; top: 18px; height: auto; z-index: 1; }
.compass .m.b .lb { display: none; padding: 3px 8px; border-radius: 999px; background: rgba(29,22,32,.9); box-shadow: 0 0 0 1px var(--line); }
.compass .m.b.lab .lb { display: block; } .compass .m.b.lab .d { transform: scale(1.3); }
.compass .m.b .d { width: 8px; height: 8px; border: 1.5px solid #2a2236; border-radius: 50%; background: var(--l3d-gold); box-shadow: 0 0 6px var(--l3d-gold); }
.compass .needle { position: absolute; left: 50%; top: 2px; transform: translateX(-50%); width: 0; height: 0;
  border: 6px solid transparent; border-top: 8px solid var(--l3d-gold); filter: drop-shadow(0 1px 1px #000); }

.online { right: 16px; top: 14px; pointer-events: auto; }
.online .chip { height: 26px; padding: 0 11px 0 9px; font-size: 13px; gap: 6px; }
.online .dot { width: 8px; height: 8px; border-radius: 50%; background: #6fdc7a; box-shadow: 0 0 0 3px #6fdc7a33, 0 0 8px #6fdc7a; }
.online .net { margin-left: 6px; }

.cross { left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1.5px #0009; opacity: .85;
  transition: transform .15s var(--ease), background .15s; }
.cross.hot { background: var(--l3d-gold); transform: scale(1.6); box-shadow: 0 0 0 1.5px #0009, 0 0 10px var(--l3d-gold); }
.cross[hidden] { display: none; }

.prompt { left: 50%; top: 66%; transform: translate(-50%, 6px); opacity: 0; transition: opacity .16s, transform .16s var(--ease);
  display: flex; align-items: center; gap: 10px; padding: 8px 18px 8px 8px; border-radius: 999px;
  background: linear-gradient(rgba(42,32,48,.92), rgba(29,22,32,.92)); box-shadow: 0 0 0 2px var(--l3d-gold), 0 0 0 5px rgba(29,22,32,.7), 0 10px 24px #0008;
  font: 700 15px/1 var(--l3d-hd); white-space: nowrap; }
.prompt.on { opacity: 1; transform: translate(-50%, 0); }
.prompt.soon { box-shadow: 0 0 0 2px #bfaab7, 0 0 0 5px rgba(29,22,32,.7), 0 10px 24px #0008; color: var(--l3d-mute); }
.kc { display: inline-grid; place-items: center; min-width: 28px; height: 28px; padding: 0 7px; border-radius: 9px; font: 400 13px/1 var(--l3d-num);
  color: #2a1d18; background: linear-gradient(#fff3d0, var(--l3d-gold)); box-shadow: 0 3px 0 var(--l3d-gold-d), inset 0 1px 0 #fff; }
.kc.sm { min-width: 22px; height: 22px; font-size: 10px; border-radius: 7px; box-shadow: 0 2px 0 var(--l3d-gold-d), inset 0 1px 0 #fff; }
.kc.dk { color: var(--l3d-ink); background: linear-gradient(#4a3a54, #33263b); box-shadow: 0 2px 0 #160f1a, inset 0 1px 0 #ffffff22, 0 0 0 1px var(--line); }
.prompt .ic { font-size: 17px; }

.hints { right: 16px; bottom: 16px; display: flex; gap: 14px; padding: 5px 12px 5px 6px; border-radius: 999px; background: rgba(20,14,24,.38); font: 800 12px/1 var(--l3d-tx); color: #f7eadfbb; text-shadow: 0 1px 2px #000; transition: opacity .6s; }
.hints span { display: inline-flex; align-items: center; gap: 5px; }
.hints .kc.sm { min-width: 20px; height: 20px; font-size: 10px; border-radius: 6px; padding: 0 5px; }
.hints.off { opacity: 0; visibility: hidden; transition: opacity .6s, visibility 0s .6s; }
.clickplay { left: 50%; top: 66%; transform: translateX(-50%); display: flex; align-items: center; gap: 9px; padding: 9px 18px; border-radius: 999px; font: 700 13px/1.2 var(--l3d-hd); color: var(--l3d-mute);
  background: rgba(29,22,32,.82); box-shadow: 0 0 0 1.5px var(--line), 0 10px 24px #0008; }
.clickplay[hidden] { display: none; }
.clickplay .mouse { position: relative; width: 12px; height: 17px; border-radius: 6px; border: 1.8px solid var(--l3d-gold); flex: none; }
.clickplay .mouse::after { content: ''; position: absolute; left: 1px; top: 1px; width: 4px; height: 6px; border-radius: 4px 0 0 0; background: var(--l3d-gold); }
.hud.unlocked .prompt, .hud.unlocked .cross { visibility: hidden; }
.perf { left: 50%; top: 52px; transform: translateX(-50%); padding: 5px 12px; border-radius: 10px; background: rgba(0,0,0,.66);
  font: 700 11px/1.4 ui-monospace, 'DejaVu Sans Mono', monospace; color: #c8f7c5; white-space: pre; }
.perf[hidden] { display: none; }
.lvup { left: 50%; top: 24%; transform: translate(-50%, -50%); text-align: center; pointer-events: none; animation: lvup 2.4s var(--ease) forwards; }
.lvup b { display: block; font: 400 54px/1 var(--l3d-num); color: var(--l3d-gold); letter-spacing: .04em;
  text-shadow: 0 4px 0 #8a5a1a, 0 0 30px #ffcf6a99, 0 8px 20px #000a; }
.lvup span { font: 700 16px/1 var(--l3d-hd); text-shadow: 0 2px 4px #000; }
@keyframes lvup { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.7); } 12% { opacity: 1; transform: translate(-50%, -50%) scale(1.06); }
  20% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -60%); } }

/* ============================================================= chat (fallback panel; the live site's chat is docked: SITE_CHAT_CSS) */
.chat { left: 16px; bottom: 16px; width: 390px; pointer-events: none; display: flex; flex-direction: column; gap: 6px; }
.chat .tabs { display: flex; gap: 4px; opacity: .7; transition: opacity .2s; }
.chat .tabs[hidden], .chat .tabs button[hidden], .chat .to[hidden], .chat .in[hidden] { display: none; }
.chat .tabs button { display: inline-flex; align-items: center; gap: 4px; pointer-events: auto; border: 0; cursor: pointer; padding: 7px 12px; border-radius: 999px; font: 800 11px/1 var(--l3d-tx);
  background: rgba(29,22,32,.8); color: var(--l3d-mute); box-shadow: 0 0 0 1px var(--line); }
.chat .tabs button.on { color: #2a1d18; background: var(--l3d-gold); box-shadow: none; }
.chat .tabs .tn { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #ff5a5a; color: #fff; font: 800 10px/16px var(--l3d-tx); text-align: center; }
.chat .tabs .tn[hidden] { display: none; }
.chat .log { display: flex; flex-direction: column; gap: 2px; max-height: 150px; overflow: hidden; padding: 6px 8px; border-radius: 16px;
  transition: background .2s, box-shadow .2s; -webkit-mask: linear-gradient(transparent, #000 22px); mask: linear-gradient(transparent, #000 22px); justify-content: flex-end; }
.chat .ln { font: 700 13.5px/1.32 var(--l3d-tx); text-shadow: 0 1px 2px #000, 0 0 3px #000c; transition: opacity 1.2s; overflow-wrap: anywhere; }
.chat .ln.fade { opacity: 0; }
.chat .ln .n { font-weight: 800; cursor: pointer; }
.chat .ln.me .n { text-decoration: underline dotted #fff6; }
.chat .ln .cls { margin-right: 3px; font-size: 12px; }
.chat .ln .dmb { pointer-events: auto; margin-left: 3px; padding: 0 3px; border: 0; border-radius: 6px; background: transparent; color: #fff9; font: 12px/1 system-ui; cursor: pointer; vertical-align: 1px; }
.chat .ln .dmb:hover { color: #fff; background: #fff2; }
.chat .ln.dm span { color: #ffd7e2; }
.chat .ln.ev, .chat .ln.sys { font-style: italic; color: var(--l3d-gold); }
.chat .ln.empty { color: var(--l3d-mute); font-weight: 600; }
.chat .to { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; pointer-events: auto; font: 700 12px/1 var(--l3d-tx); }
.chat .to button { min-height: 24px; padding: 0 8px; border: 1px solid var(--line); border-radius: 999px; background: rgba(29,22,32,.85); color: var(--l3d-ink); font: 800 11px/1 var(--l3d-tx); cursor: pointer; }
.chat .to button[aria-pressed="true"] { border-color: var(--l3d-gold); background: #ffcf6a2a; }
.chat .to .tw { color: var(--l3d-mute); text-shadow: 0 1px 2px #000; }
.chat .in { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 5px 0 12px; border-radius: 999px; pointer-events: auto; width: 270px;
  background: rgba(29,22,32,.42); box-shadow: 0 0 0 1px rgba(255,236,200,.12); transition: background .2s, box-shadow .2s, width .2s var(--ease), height .2s, opacity .2s; cursor: text; opacity: .8; }
.chat .in .kc { transform: scale(.85); }
.chat .in input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--l3d-ink); font: 600 13px/1 var(--l3d-tx); }
.chat .in input::placeholder { color: #f7eadf88; }
.chat .in input:disabled { cursor: not-allowed; }
.chat .in .cnt { font: 700 10px/1 var(--l3d-tx); color: var(--l3d-mute); }
.chat.open .tabs { opacity: 1; }
.chat.open .log { max-height: 240px; background: rgba(20,14,24,.86); box-shadow: 0 0 0 1.5px var(--line), 0 12px 30px #0008; pointer-events: auto; overflow-y: auto; -webkit-mask: none; mask: none; }
.chat.open .ln.fade { opacity: 1; }
.chat.open .in { width: 100%; height: 36px; opacity: 1; background: rgba(29,22,32,.94); box-shadow: 0 0 0 2px var(--l3d-gold), 0 8px 20px #0008; }
/* moderation (src/ui/chat-mod.ts): role icon, «⋯» on others' lines, ⚙ in the tab row — only for moderators */
.chat .ln .l3d-cr { font-style: normal; margin-right: 3px; font-size: 12px; }
.chat .ln .cm { pointer-events: auto; float: right; margin-left: 6px; min-width: 24px; height: 20px; padding: 0 4px; border: 0; border-radius: 6px; background: transparent; color: #ffcf6aee; font: 800 15px/1 system-ui, sans-serif; cursor: pointer; }
.chat .ln .cm:hover, .chat .ln .cm:focus-visible { color: #fff; background: #ffcf6a2e; outline: 0; }
.chat:not(.open) .ln .cm { visibility: hidden; }
.chat .tabs .gear { margin-left: auto; padding: 0; width: 26px; height: 26px; justify-content: center; font: 15px/1 system-ui, sans-serif; color: var(--l3d-ink); }
.chat .tabs .gear[hidden] { display: none; }
.chat .log::-webkit-scrollbar { width: 6px; } .chat .log::-webkit-scrollbar-thumb { background: #ffcf6a55; border-radius: 6px; }

/* ============================================================= toasts */
.toasts { position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%); display: flex; flex-direction: column-reverse; align-items: center; gap: 8px; pointer-events: none; z-index: 30; }
.toast { padding: 10px 18px 10px 14px; border-radius: 14px; display: flex; gap: 10px; align-items: center; max-width: 560px;
  background: linear-gradient(rgba(52,40,60,.96), rgba(34,26,40,.96)); box-shadow: 0 0 0 1.5px var(--l3d-gold), 0 12px 26px #0009;
  font: 700 14px/1.3 var(--l3d-tx); animation: tin .2s var(--ease); }
.toast::before { content: ''; width: 10px; height: 10px; flex: none; border-radius: 50%; background: var(--l3d-gold); box-shadow: 0 0 8px var(--l3d-gold); }
.toast.bad { box-shadow: 0 0 0 1.5px var(--l3d-dn), 0 12px 26px #0009; } .toast.bad::before { background: var(--l3d-dn); box-shadow: 0 0 8px var(--l3d-dn); }
.toast.out { opacity: 0; transform: translateY(6px); transition: opacity .3s, transform .3s; }
@keyframes tin { from { opacity: 0; transform: translateY(12px); } }

/* ============================================================= menu shell */
.menu { position: absolute; inset: 0; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .16s, visibility 0s .16s; z-index: 10; }
.menu.on { opacity: 1; visibility: visible; transition: opacity .16s; }
/* closed = inert immediately, not after the fade: a pending transition must never leave a click-catching layer over the canvas */
.menu:not(.on), .menu:not(.on) * { pointer-events: none !important; }
.menu .veil { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 80% 75% at 50% 45%, transparent 40%, rgba(10,6,14,.72)), linear-gradient(rgba(14,10,20,.55), rgba(14,10,20,.15) 18%, rgba(14,10,20,.15) 82%, rgba(14,10,20,.7)); }
.menu.dim .veil { background: radial-gradient(ellipse 70% 70% at 50% 50%, rgba(18,12,24,.45), rgba(8,5,12,.85)); backdrop-filter: blur(4px); }
.menu.pause .veil { background: radial-gradient(ellipse 34% 60% at 50% 50%, rgba(18,12,24,.78), rgba(18,12,24,.35) 70%, rgba(8,5,12,.7)); backdrop-filter: blur(2px); }
/* orbit menus (gear/bag/look): the 3D character stands at x≈29–31 %, feet at y≈85 % (camera framing NDC −0.42, default orbit distance) and must stay bright —
   no veil over it; only thin edge vignettes, a warm floor glow under the feet and a dark ramp behind the panels */
.menu.side .veil { background:
  radial-gradient(ellipse 13% 4.5% at 31% 85%, rgba(255,214,150,.34), rgba(255,190,120,.13) 55%, transparent 100%),
  radial-gradient(ellipse 22% 42% at 31% 58%, rgba(255,236,200,.09), transparent 70%),
  linear-gradient(90deg, transparent 0 44%, rgba(10,6,14,.38) 54%, rgba(10,6,14,.62)),
  linear-gradient(90deg, rgba(10,6,14,.32), transparent 6%),
  linear-gradient(rgba(14,10,20,.5), rgba(14,10,20,.12) 9%, transparent 15%, transparent 88%, rgba(14,10,20,.55)); }
.orbhint { position: absolute; left: 30%; bottom: 10px; transform: translateX(-50%); display: none; align-items: center; gap: 9px; padding: 7px 14px 7px 10px;
  border-radius: 999px; background: rgba(20,14,24,.55); box-shadow: 0 0 0 1px #ffffff14; font: 700 12px/1 var(--l3d-tx); color: #f7eadfdd;
  text-shadow: 0 1px 2px #000; white-space: nowrap; pointer-events: none; transition: opacity .8s; }
.orbhint.dim { opacity: .45; }
.menu.side .orbhint { display: flex; }
.orbhint .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--l3d-gold); opacity: .7; }
.orbhint .mouse { position: relative; width: 13px; height: 19px; border-radius: 7px; border: 1.8px solid #f7eadfcc; flex: none; }
.orbhint .mouse::after { content: ''; position: absolute; left: 50%; top: 3px; width: 2px; height: 5px; margin-left: -1px; border-radius: 2px; background: var(--l3d-gold);
  animation: wheel 1.8s ease-in-out infinite; }
@keyframes wheel { 0%, 100% { transform: translateY(0); opacity: 1; } 60% { transform: translateY(4px); opacity: .3; } }
.head { position: absolute; left: 0; right: 0; top: 0; height: 84px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.head > * { pointer-events: auto; }
.ribbon { position: relative; display: flex; align-items: center; gap: 4px; padding: 0 16px; height: 50px; border-radius: 999px;
  background: linear-gradient(#35283d, #241b2a); box-shadow: 0 0 0 2px var(--l3d-gold), 0 0 0 5px rgba(29,22,32,.92), 0 0 0 6px color-mix(in srgb, var(--l3d-gold) 40%, transparent), 0 14px 30px #0009; }
.ribbon .grp { display: flex; gap: 2px; align-items: center; }
.ribbon .gl { display: none; }
.ribbon .sep { width: 2px; height: 26px; margin: 0 8px; background: var(--line); border-radius: 2px; }
.tab { position: relative; border: 0; background: transparent; cursor: pointer; height: 36px; padding: 0 13px; border-radius: 999px;
  font: 700 14px/1 var(--l3d-hd); color: #dcc9d5; transition: color .15s, background .15s; white-space: nowrap; }
.tab:hover { color: var(--l3d-ink); background: #ffffff0d; }
.tab.on { color: #2a1d18; background: linear-gradient(#ffe7a6, var(--l3d-gold)); box-shadow: 0 3px 0 var(--l3d-gold-d), inset 0 1px 0 #fff; }
.tab .hk { position: absolute; left: 50%; bottom: -13px; transform: translateX(-50%); font: 800 9px/1 var(--l3d-tx); padding: 2px 4px; border-radius: 5px; background: #1d1620; color: var(--l3d-gold); box-shadow: 0 0 0 1px var(--line); opacity: 0; transition: opacity .15s; }
.tab:hover .hk { opacity: 1; }
.ribbon .qe { margin: 0 6px; }
.close { position: absolute; right: 22px; top: 22px; width: 40px; height: 40px; border-radius: 50%; border: 0; cursor: pointer; pointer-events: auto;
  background: linear-gradient(#3d2f45, #241b2a); box-shadow: 0 0 0 2px var(--l3d-gold), 0 6px 14px #0008; color: var(--l3d-gold); font: 400 18px/1 var(--l3d-num); }
.close:hover { background: linear-gradient(#4d3c57, #2e2234); }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 46px; display: flex; align-items: center; justify-content: center; gap: 22px; pointer-events: none;
  font: 700 12.5px/1 var(--l3d-tx); color: #f7eadfcc; background: linear-gradient(transparent, rgba(10,6,14,.7)); }
.foot > * { pointer-events: auto; }
.menu.side .foot { left: 44%; gap: 16px; }
.foot span { display: inline-flex; align-items: center; gap: 6px; } .foot .st b { font: 400 13px/1 var(--l3d-num); color: var(--l3d-ink); }
.foot .dv { width: 1.5px; height: 18px; background: var(--line); }
.body { position: absolute; left: 0; right: 0; top: 88px; bottom: 54px; pointer-events: none; }
.page { position: absolute; inset: 0; pointer-events: none; animation: pin .18s var(--ease); }
@keyframes pin { from { opacity: 0; transform: translateY(10px) scale(.985); } }

/* ornate panel */
.pan { position: absolute; pointer-events: auto; border-radius: 24px; padding: 30px 26px 22px;
  background: radial-gradient(ellipse 120% 60% at 50% -10%, #3a2b42 0%, transparent 60%), linear-gradient(rgba(42,32,48,.96), rgba(31,23,36,.96));
  box-shadow: 0 0 0 2px var(--l3d-gold), 0 0 0 6px rgba(33,25,39,.96), 0 0 0 7.5px color-mix(in srgb, var(--l3d-gold) 40%, transparent), 0 24px 50px rgba(0,0,0,.55);
  display: flex; flex-direction: column; min-height: 0; }
.pan::before { content: ''; position: absolute; inset: 9px; border-radius: 17px; border: 1.5px dashed color-mix(in srgb, var(--l3d-gold) 22%, transparent); pointer-events: none; }
.orn { position: absolute; width: 26px; height: 26px; pointer-events: none;
  background: radial-gradient(circle at 50% 62%, var(--l3d-gold) 0 6px, transparent 6.5px), radial-gradient(circle at 18% 32%, var(--l3d-gold) 0 3px, transparent 3.5px),
  radial-gradient(circle at 50% 14%, var(--l3d-gold) 0 3px, transparent 3.5px), radial-gradient(circle at 82% 32%, var(--l3d-gold) 0 3px, transparent 3.5px);
  filter: drop-shadow(0 0 0 #1d1620) drop-shadow(0 2px 2px #0008); }
.orn.tl { left: -10px; top: -10px; transform: rotate(-45deg); } .orn.tr { right: -10px; top: -10px; transform: rotate(45deg); }
.orn.bl { left: -10px; bottom: -10px; transform: rotate(-135deg); } .orn.br { right: -10px; bottom: -10px; transform: rotate(135deg); }
.ptitle { position: absolute; left: 50%; top: -17px; transform: translateX(-50%); z-index: 2; padding: 9px 36px; font: 700 16px/1 var(--l3d-hd); color: #2a1d18; letter-spacing: .02em;
  background: linear-gradient(#ffe7a6, var(--l3d-gold)); clip-path: polygon(0 0, 100% 0, 94% 50%, 100% 100%, 0 100%, 6% 50%);
  filter: drop-shadow(0 3px 0 var(--l3d-gold-d)); white-space: nowrap; }
.ptitle small { font: 800 11px/1 var(--l3d-tx); opacity: .7; margin-left: 6px; }
.h3 { font: 700 13px/1 var(--l3d-hd); color: var(--l3d-gold); letter-spacing: .04em; margin: 14px 0 9px; display: flex; align-items: center; gap: 8px; }
.h3::after { content: ''; flex: 1; height: 1.5px; background: linear-gradient(90deg, var(--line), transparent); }
.h3 .mut { font: 700 11px/1 var(--l3d-tx); color: var(--l3d-mute); letter-spacing: 0; }
.mut { color: var(--l3d-mute); }
.scroll { overflow-y: auto; min-height: 0; flex: 1; margin-right: -10px; padding-right: 10px; -webkit-mask: linear-gradient(#000 calc(100% - 26px), transparent); mask: linear-gradient(#000 calc(100% - 26px), transparent); padding-bottom: 18px; }
.scroll::-webkit-scrollbar { width: 8px; } .scroll::-webkit-scrollbar-thumb { background: #ffcf6a44; border-radius: 8px; } .scroll::-webkit-scrollbar-track { background: transparent; }
.note { margin: 10px 0 0; padding: 9px 12px; border-radius: 12px; font: 600 12.5px/1.4 var(--l3d-tx); background: #ffffff08; box-shadow: inset 0 0 0 1px #ffffff12; color: var(--l3d-mute); }
.note.warn { background: #ff8f8f14; box-shadow: inset 0 0 0 1px #ff8f8f55; color: #ffc0b8; }
.note.amber { background: #ffcf6a14; box-shadow: inset 0 0 0 1px #ffcf6a55; color: #ffe3a3; }
.note b, .cmd { color: var(--l3d-gold); font-weight: 800; }

/* buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 20px; border-radius: 999px; border: 0; cursor: pointer;
  font: 700 14px/1 var(--l3d-hd); color: #2a1018; background: linear-gradient(#ffb3c1, var(--l3d-accent)); box-shadow: 0 4px 0 var(--l3d-accent-d), inset 0 1px 0 #fff8;
  transition: transform .1s, filter .15s; white-space: nowrap; }
.btn:hover { filter: brightness(1.08); } .btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--l3d-accent-d); }
.btn.gold { color: #2a1d18; background: linear-gradient(#ffe7a6, var(--l3d-gold)); box-shadow: 0 4px 0 var(--l3d-gold-d), inset 0 1px 0 #fff; }
.btn.ghost { color: var(--l3d-ink); background: transparent; box-shadow: inset 0 0 0 2px var(--line); } .btn.ghost:hover { box-shadow: inset 0 0 0 2px var(--l3d-gold); }
.btn.wide { width: 100%; } .btn.sm { height: 32px; padding: 0 14px; font-size: 12.5px; }
.btn[disabled] { filter: grayscale(.8) brightness(.7); cursor: not-allowed; transform: none; }
.btn:focus-visible, .tab:focus-visible, .cell:focus-visible, .slot:focus-visible, .pbtn:focus-visible { outline: 3px solid var(--l3d-gold); outline-offset: 2px; }
.row { display: flex; gap: 10px; align-items: center; }

/* item cells */
.cell { position: relative; width: 74px; height: 74px; border-radius: 18px; border: 0; padding: 8px; cursor: pointer;
  background: radial-gradient(circle at 50% 38%, #4a3854, #2a1f31 72%); box-shadow: inset 0 3px 8px #0009, inset 0 0 18px color-mix(in srgb, var(--rc) 24%, transparent), 0 0 0 1.5px color-mix(in srgb, var(--rc) 30%, #ffffff14);
  transition: transform .12s var(--ease), box-shadow .12s; }
.cell::after { content: ''; position: absolute; left: 14px; right: 14px; bottom: 4px; height: 4px; border-radius: 4px; background: var(--rc); box-shadow: 0 0 6px var(--rc); }
.cell[data-r=common]::after { opacity: .7; box-shadow: none; }
.cell:hover { transform: translateY(-2px); box-shadow: inset 0 3px 8px #0009, inset 0 0 22px color-mix(in srgb, var(--rc) 35%, transparent), 0 0 0 2px color-mix(in srgb, var(--rc) 70%, transparent); }
.cell.sel { box-shadow: inset 0 3px 8px #0009, inset 0 0 22px color-mix(in srgb, var(--rc) 40%, transparent), 0 0 0 2.5px var(--l3d-gold), 0 0 16px #ffcf6a66; }
.cell.empty { cursor: default; background: radial-gradient(circle at 50% 40%, #ffffff0a, #00000022 75%); box-shadow: inset 0 2px 6px #0007, inset 0 0 0 1.5px #ffffff14; } .cell.empty::after { display: none; } .cell.empty:hover { transform: none; }
.cell .art { width: 100%; height: 100%; display: block; filter: drop-shadow(0 2px 1px #0006); }
.cell .en { position: absolute; left: 7px; top: 6px; font: 400 11.5px/1 var(--l3d-num); color: var(--l3d-gold); text-shadow: 0 1px 2px #000; font-style: normal; }
.cell .n { position: absolute; right: 7px; bottom: 10px; font: 800 12.5px/1 var(--l3d-tx); text-shadow: 0 1px 2px #000, 0 0 2px #000; font-style: normal; }
.cell .no { position: absolute; right: 5px; top: 5px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; display: grid; place-items: center; font: 800 10px/1 var(--l3d-tx); color: #e9d9e3; background: #00000059; font-style: normal; }
.cell .up { position: absolute; left: 6px; bottom: 9px; font: 800 11px/1 var(--l3d-tx); color: var(--l3d-up); text-shadow: 0 1px 2px #000; font-style: normal; }
.cell .cd { position: absolute; inset: 0; border-radius: 18px; background: #0009; display: grid; place-items: center; font: 800 12px/1 var(--l3d-tx); color: #fff; }
.cell .lk { position: absolute; left: 7px; bottom: 8px; font-size: 11px; }
.cell[data-r=epic], .cell[data-r=legendary] { background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--rc) 22%, #3b2c44), var(--l3d-panel-2) 72%); }
.cell[data-r=legendary]::before, .cell[data-r=epic]::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(115deg, transparent 30%, color-mix(in srgb, var(--rc) 35%, transparent) 50%, transparent 70%) 0 0 / 250% 100%; animation: shim 6s linear infinite; }
@keyframes shim { from { background-position: 150% 0; } to { background-position: -100% 0; } }
.cell.pop { animation: pop .26s var(--ease); }
@keyframes pop { 0% { transform: scale(1); } 40% { transform: scale(1.12); } 100% { transform: scale(1); } }
.grid { display: grid; grid-template-columns: repeat(auto-fill, 74px); gap: 9px 8px; align-content: start; justify-content: space-between; padding: 4px 2px 8px; }

/* filters */
.filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.fl { border: 0; cursor: pointer; height: 30px; padding: 0 13px; border-radius: 999px; font: 700 12.5px/1 var(--l3d-tx); color: var(--l3d-mute); background: #ffffff0a; box-shadow: inset 0 0 0 1.5px #ffffff14; }
.fl:hover { color: var(--l3d-ink); } .fl.on { color: var(--l3d-ink); background: color-mix(in srgb, var(--l3d-accent) 26%, transparent); box-shadow: inset 0 0 0 1.5px var(--l3d-accent); }
.fl i { font-style: normal; opacity: .6; margin-left: 4px; }

/* item card */
.card { display: flex; flex-direction: column; gap: 4px; }
.card .ch { display: flex; gap: 12px; align-items: center; }
.card .ch .cell { width: 64px; height: 64px; flex: none; cursor: default; } .card .ch .cell:hover { transform: none; }
.card .ch > div { min-width: 0; }
.card .nm { font: 700 17px/1.2 var(--l3d-hd); overflow-wrap: anywhere; color: var(--rc); text-shadow: 0 0 14px color-mix(in srgb, var(--rc) 40%, transparent); }
.card .sub { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; font: 800 12px/1 var(--l3d-tx); color: #d5c3cf; }
.card .sub .rar { color: var(--rc); } .card .sub .ok { color: var(--l3d-up); }
.sts { list-style: none; margin: 10px 0 2px; padding: 8px 10px; border-radius: 14px; background: #00000026; box-shadow: inset 0 0 0 1px #ffffff0d; }
.sts li { display: grid; grid-template-columns: 22px 1fr auto 52px; gap: 6px; align-items: center; height: 26px; font: 700 13.5px/1 var(--l3d-tx); }
.sts li + li { border-top: 1px solid #ffffff0b; }
.sts li .si { width: 18px; height: 18px; } .sts li b { font: 400 13px/1 var(--l3d-num); }
.sts li em { font-style: normal; text-align: right; font: 800 12.5px/1 var(--l3d-tx); }
.sts li em.up { color: var(--l3d-up); } .sts li em.dn { color: var(--l3d-dn); } .sts li em.eq { color: var(--l3d-mute); }
.sts li.xr span { color: var(--l3d-mute); }
.card .eff { font: 700 13px/1.35 var(--l3d-tx); color: #c9f7cf; margin: 6px 0 0; }
.card .verdict { font: 700 12.5px/1.35 var(--l3d-tx); margin: 6px 0 0; color: var(--l3d-mute); } .card .verdict b.up { color: var(--l3d-up); } .card .verdict b.dn { color: var(--l3d-dn); }
.card .mq { font: 600 12.5px/1.45 var(--l3d-tx); color: #cdbbc7; margin: 6px 0 0; padding-top: 8px; border-top: 1.5px dashed #ffffff14; }
.card .mq p { margin: 0 0 3px; } .card .mq b { color: var(--l3d-ink); }
.card .acts { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.tip { position: absolute; z-index: 40; width: 300px; padding: 14px 16px; border-radius: 18px; pointer-events: none;
  background: linear-gradient(rgba(46,35,53,.98), rgba(30,22,35,.98)); box-shadow: 0 0 0 1.5px var(--rc, var(--l3d-gold)), 0 0 0 5px rgba(29,22,32,.85), 0 18px 36px #000a;
  opacity: 0; transition: opacity .1s; }
.tip.on { opacity: 1; }

/* ---- gear page */
.p-gear .pan { left: max(46%, calc(100% - 820px)); right: 26px; top: 14px; bottom: 6px; flex-direction: row; gap: 24px; padding: 32px 26px 22px; }
.p-gear .dollc { width: 232px; flex: none; display: flex; flex-direction: column; }
.who b { font: 700 22px/1.1 var(--l3d-hd); } .who .lvl { font: 400 13px/1 var(--l3d-num); color: var(--l3d-gold); margin-left: 6px; }
.who .cls { font: 700 12.5px/1 var(--l3d-tx); color: var(--l3d-mute); margin-top: 6px; }
.doll { position: relative; height: 300px; margin-top: 8px; }
.doll .ring { position: absolute; left: 50%; top: 50%; width: 190px; height: 190px; transform: translate(-50%, -50%); border-radius: 50%;
  border: 2px dashed color-mix(in srgb, var(--l3d-gold) 30%, transparent); }
.doll .ring::after { content: ''; position: absolute; inset: 30px; border-radius: 50%; background: radial-gradient(circle, #ffcf6a1a, transparent 70%); }
.doll .figure { position: absolute; left: 50%; top: 50%; width: 120px; height: 156px; transform: translate(-50%, -50%); }
.p-gear .slot[data-slot=armor] { z-index: 1; }
.slot { position: absolute; width: 78px; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: 0; cursor: pointer; padding: 0; }
.slot .cell { width: 72px; height: 72px; pointer-events: none; }
.slot .sl { font: 800 10.5px/1 var(--l3d-tx); color: var(--l3d-mute); text-transform: uppercase; letter-spacing: .06em; text-shadow: 0 1px 2px #000; }
.slot.sel .sl { color: var(--l3d-gold); } .slot.sel .cell { box-shadow: inset 0 3px 8px #0009, 0 0 0 2.5px var(--l3d-gold), 0 0 18px #ffcf6a77; }
.slot:hover .cell { transform: translateY(-2px); }
.slot .art.sil { opacity: .13; filter: none; }
.p-gear .det { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.fits { display: grid; grid-template-columns: repeat(auto-fill, 60px); gap: 9px; padding: 2px; } .fits .cell { width: 60px; height: 60px; padding: 6px; }
.pen { margin-top: 10px; }

/* ---- bag page */
/* both bag panels live right of x = 44 % (the character stands at ≈29 %) */
.p-bag .pan.gridp { left: 44%; right: calc(clamp(300px, 24%, 400px) + 50px); max-width: 640px; margin-left: auto; top: 14px; bottom: 6px; }
.p-bag .pan.cardp { right: 26px; width: clamp(300px, 24%, 400px); top: 14px; bottom: 6px; }
.bagh { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.bagh .cap { font: 400 15px/1 var(--l3d-num); } .bagh .cap small { color: var(--l3d-mute); font-size: 12px; }
.bagh .capbar { flex: 1; height: 8px; border-radius: 8px; background: #00000040; overflow: hidden; } .bagh .capbar i { display: block; height: 100%; background: linear-gradient(90deg, var(--l3d-accent), var(--l3d-gold)); border-radius: 8px; }
.empty-card { flex: 1; display: grid; place-items: center; text-align: center; color: var(--l3d-mute); font: 600 13px/1.5 var(--l3d-tx); padding: 20px; }
.empty-card .big { font-size: 40px; opacity: .45; display: block; margin-bottom: 8px; }

/* ---- stats page */
.p-stats .pan, .p-log .pan, .p-classic .pan { left: 50%; transform: translateX(-50%); width: min(980px, 88%); top: 18px; bottom: 6px; }
.shead { display: flex; align-items: center; gap: 18px; }
.shead .medal { width: 86px; height: 86px; cursor: default; } .shead .medal .lv { font-size: 34px; }
.shead .nm b { font: 700 26px/1.1 var(--l3d-hd); } .shead .nm div { font: 700 13px/1.2 var(--l3d-tx); color: var(--l3d-mute); margin-top: 5px; }
.shead .soc { margin-left: auto; text-align: right; } .shead .soc .chip { height: 32px; font-size: 14px; padding: 0 14px 0 11px; }
.shead .soc small { display: block; margin-top: 6px; color: var(--l3d-mute); font: 700 11.5px/1 var(--l3d-tx); }
.sbars { display: grid; grid-template-columns: 100px 1fr; gap: 10px 14px; align-items: center; margin-top: 18px; font: 700 13px/1 var(--l3d-tx); }
.sbars .bar { width: auto; margin: 0; height: 18px; } .sbars .bar.xp { height: 18px; } .sbars .bar.xp .t { font-size: 11px; }
.sgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 18px; }
.sbox { position: relative; padding: 14px 14px 12px; border-radius: 18px; background: radial-gradient(circle at 50% 0, #ffffff10, transparent 70%), #00000026; box-shadow: inset 0 0 0 1.5px #ffffff10; text-align: center; }
.sbox .si { width: 30px; height: 30px; margin: 0 auto 4px; display: block; }
.sbox b { display: block; font: 400 26px/1.1 var(--l3d-num); } .sbox span { font: 700 12px/1.2 var(--l3d-tx); color: var(--l3d-mute); }
.sbox s { color: var(--l3d-dn); font: 700 13px/1 var(--l3d-tx); margin-right: 6px; }
.xsgrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
.xsi { display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 10px 6px; border-radius: 14px; background: #ffffff08; box-shadow: inset 0 0 0 1px #ffffff0d; font: 800 11.5px/1.1 var(--l3d-tx); text-align: center; }
.xsi span { color: #d5c3cf; } .xsi b { font: 400 17px/1 var(--l3d-num); } .xsi .si { width: 20px; height: 20px; }
.mline { display: flex; align-items: center; gap: 8px; font: 700 15px/1.2 var(--l3d-tx); flex-wrap: wrap; }
.mline .mp { display: inline-flex; align-items: center; gap: 6px; } .mline .mp b { font: 400 16px/1 var(--l3d-num); }
.debt { color: var(--l3d-dn); }

/* ---- journal */
.jl { list-style: none; margin: 0; padding: 0; }
.jday { font: 700 12px/1 var(--l3d-hd); color: var(--l3d-gold); margin: 14px 0 6px; display: flex; gap: 10px; align-items: center; }
.jday::before, .jday::after { content: ''; height: 1.5px; flex: 1; background: var(--line); } .jday::before { flex: 0 0 18px; }
.je { display: grid; grid-template-columns: 34px 46px 1fr auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 12px; font: 600 13.5px/1.3 var(--l3d-tx); }
.je:nth-child(odd) { background: #ffffff06; }
.je .ji { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; background: #00000030; box-shadow: inset 0 0 0 1px #ffffff12; font-size: 15px; }
.je .ji svg { width: 20px; height: 20px; }
.je time { font: 800 12px/1 var(--l3d-tx); color: #d9c6d2; }
.je .jr { display: flex; gap: 12px; align-items: center; font: 800 12px/1 var(--l3d-tx); white-space: nowrap; }
.je .win { color: var(--l3d-up); } .je .lose { color: var(--l3d-dn); } .je .xp { color: var(--l3d-gold); }
.jsum { display: flex; gap: 16px; flex-wrap: wrap; padding: 10px 14px; border-radius: 14px; background: #00000026; font: 700 13px/1 var(--l3d-tx); color: var(--l3d-mute); margin-bottom: 4px; }
.jsum b { color: var(--l3d-ink); }

/* ---- classic */
.p-classic .pan { width: min(760px, 80%); bottom: auto; max-height: calc(100% - 24px); }
/* orbit pages with a classic panel (Облик): panel on the right, the character stays visible on the left */
.p-classic.p-side .pan { left: auto; right: 26px; transform: none; width: min(640px, calc(56% - 52px)); }
.p-classic.p-side .cl-hero { flex-direction: column; align-items: flex-start; gap: 14px; }
.p-classic.p-side .cl-hero .bigic { width: 72px; height: 72px; border-radius: 20px; } .p-classic.p-side .cl-hero .bigic svg { width: 46px; height: 46px; }
.cl-hero { display: flex; gap: 22px; align-items: center; }
.cl-hero .bigic { width: 110px; height: 110px; flex: none; border-radius: 28px; display: grid; place-items: center; background: radial-gradient(circle at 40% 30%, #4a3654, #1d1620); box-shadow: inset 0 0 0 2px var(--line), 0 10px 20px #0006; }
.cl-hero .bigic svg { width: 70px; height: 70px; }
.cl-hero h2 { margin: 0 0 6px; font: 700 24px/1.1 var(--l3d-hd); } .cl-hero p { margin: 0 0 14px; color: var(--l3d-mute); font: 600 13.5px/1.45 var(--l3d-tx); }
.sumlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sumlist li { display: flex; gap: 12px; align-items: baseline; padding: 8px 12px; border-radius: 12px; background: #ffffff07; font: 600 13.5px/1.3 var(--l3d-tx); }
.sumlist li time, .sumlist li .r { color: var(--l3d-mute); font: 700 11.5px/1 var(--l3d-tx); white-space: nowrap; } .sumlist li .r { margin-left: auto; }
.bigstats { display: flex; gap: 12px; } .bigstats .sbox { flex: 1; }

/* ============================================================= pause */
.p-pause { display: grid; place-items: center; pointer-events: none; }
.pausebox { pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 0; }
.logo { text-align: center; margin-bottom: 26px; }
.logo b { display: block; font: 400 58px/1 var(--l3d-num); letter-spacing: .06em; color: var(--l3d-gold);
  text-shadow: 0 4px 0 #8a5a1a, 0 8px 0 #2a1d18, 0 0 40px #ffcf6a66; }
.logo span { display: inline-block; margin-top: 14px; font: 700 13px/1 var(--l3d-hd); letter-spacing: .3em; text-transform: uppercase; color: var(--l3d-ink); opacity: .85; }
.logo .paws { display: flex; justify-content: center; gap: 14px; margin: 12px 0 0; } .logo .paws i { width: 7px; height: 7px; border-radius: 50%; background: var(--l3d-gold); opacity: .6; }
.plist { display: flex; flex-direction: column; gap: 10px; width: 340px; }
.pbtn { position: relative; height: 50px; border: 0; cursor: pointer; border-radius: 999px; font: 700 16px/1 var(--l3d-hd); color: var(--l3d-ink);
  background: linear-gradient(rgba(54,41,62,.92), rgba(34,26,40,.92)); box-shadow: 0 0 0 1.5px var(--line), 0 8px 18px #0007;
  display: flex; align-items: center; justify-content: center; gap: 10px; transition: box-shadow .15s, transform .12s, color .15s; }
.pbtn:hover, .pbtn.focus { color: #2a1d18; background: linear-gradient(#ffe7a6, var(--l3d-gold)); box-shadow: 0 4px 0 var(--l3d-gold-d), 0 0 26px #ffcf6a55; transform: translateY(-1px); }
.pbtn .kc { position: absolute; right: 10px; } .pbtn:hover .kc.dk, .pbtn.focus .kc.dk { background: #2a1d18; color: var(--l3d-gold); box-shadow: none; }
.pbtn.first { height: 56px; font-size: 18px; }
.pver { margin-top: 22px; font: 700 11px/1 var(--l3d-tx); color: var(--l3d-mute); opacity: .7; }
.p-set .pan, .p-help .pan { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(720px, 90%); max-height: 86%; }
.setrow { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 16px; padding: 7px 4px; border-bottom: 1px solid #ffffff0d; font: 700 14px/1.2 var(--l3d-tx); }
.setrow small { display: block; color: var(--l3d-mute); font-weight: 600; font-size: 11.5px; margin-top: 3px; }
.setinfo { padding: 6px 4px 8px; font: 600 12px/1.45 var(--l3d-tx); color: var(--l3d-mute); border-bottom: 1px solid #ffffff0d; white-space: pre-line; }
.setgroup { margin: 14px 4px 2px; font: 800 11px/1 var(--l3d-tx); letter-spacing: .12em; text-transform: uppercase; color: var(--l3d-gold, #f4c25b); }
.seg { display: inline-flex; padding: 3px; border-radius: 999px; background: #00000040; box-shadow: inset 0 0 0 1px #ffffff12; }
.seg button { border: 0; background: transparent; cursor: pointer; height: 30px; padding: 0 13px; border-radius: 999px; font: 700 12.5px/1 var(--l3d-tx); color: var(--l3d-mute); }
.seg button.on { color: #2a1d18; background: linear-gradient(#ffe7a6, var(--l3d-gold)); }
.rng { display: flex; align-items: center; gap: 10px; } .rng b { font: 400 13px/1 var(--l3d-num); min-width: 42px; text-align: right; }
input[type=range] { -webkit-appearance: none; appearance: none; width: 200px; height: 8px; border-radius: 8px; background: linear-gradient(90deg, var(--l3d-gold) var(--p, 50%), #00000055 var(--p, 50%)); outline: 0; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #fff3d0; box-shadow: 0 0 0 3px var(--l3d-gold), 0 2px 6px #0008; cursor: pointer; }
.keys { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 26px; }
.keys div { display: grid; grid-template-columns: 112px 1fr; align-items: center; gap: 10px; padding: 6px 2px; border-bottom: 1px solid #ffffff0b; font: 600 13px/1.25 var(--l3d-tx); }
.keys .kk { display: flex; gap: 4px; flex-wrap: wrap; }

@media (prefers-reduced-motion: reduce) { .cell::before { animation: none !important; } .page, .toast, .lvup { animation-duration: .01s !important; } }

/* ============================================================= minimal default HUD
   The world comes first: vitals are a compact medal + HP line (XP as a hairline), the compass is a bare strip,
   «online» is a dot + number, the chat input only appears while typing (Enter / T), hints fade after 20 s. */
.hud .vit { gap: 10px; }
.hud .medal { width: 46px; height: 46px; box-shadow: 0 0 0 2.5px var(--l3d-gold), 0 0 0 5px rgba(29,22,32,.7), 0 6px 14px rgba(0,0,0,.4); }
.hud .medal .lv { font-size: 19px; }
.hud .medal .lvt { display: none; }
.hud .medal .ears { inset: -10px 0 auto; } .hud .medal .ears::before, .hud .medal .ears::after { width: 14px; height: 14px; }
.hud .vbox { min-width: 0; padding-top: 3px; }
.hud .vname b { font-size: 15px; } .hud .vname span { font-size: 10.5px; opacity: .85; }
.hud .bar.hp { width: 200px; height: 14px; margin-top: 5px; background: rgba(20,14,24,.6); box-shadow: inset 0 1px 3px #0008, 0 0 0 1.5px rgba(255,236,200,.14); }
.hud .bar.hp .t { font-size: 10.5px; }
.hud .bar.xp { width: 200px; height: 4px; margin-top: 4px; box-shadow: none; background: rgba(20,14,24,.5); }
.hud .bar.xp i { inset: 0 auto 0 0; } .hud .bar.xp .t { display: none; }
.hud .chips { margin-top: 6px; } .hud .chip { height: 22px; font-size: 12px; background: rgba(29,22,32,.55); box-shadow: 0 0 0 1px var(--line); }
.hud .chip.soc { display: none; }
.compass .rail { border: 0; inset: 10px 4% auto; height: 24px; border-radius: 999px;
  background: radial-gradient(ellipse 50% 50% at 50% 50%, rgba(20,14,24,.5), rgba(20,14,24,.18) 70%, transparent); }
.compass .rail::after { content: ''; position: absolute; left: 6%; right: 6%; bottom: -1px; height: 1px; background: linear-gradient(90deg, transparent, #ffcf6a66 25%, #ffcf6a66 75%, transparent); }
.compass .m.c { font-size: 15.5px; text-shadow: 0 1px 3px #000, 0 0 2px #000; }
.compass .m.tk::before { height: 6px; background: #f7eadf66; }
.online .chip { height: 24px; padding: 0 10px 0 9px; font-size: 12.5px; background: rgba(29,22,32,.45); box-shadow: none; }
.online .chip .si { display: none; } .online .chip .mut { font-weight: 700; opacity: .8; }
.chat:not(.open) .in { opacity: 0; pointer-events: none; height: 0; margin-top: -6px; overflow: hidden; }
.chat:not(.open) .log { max-height: 118px; }

/* ============================================================= prompt keycaps (ui.prompt) */
.prompt > span { display: inline-flex; align-items: center; gap: 6px; }
.prompt .psep { width: 5px; height: 5px; border-radius: 50%; background: var(--l3d-gold); opacity: .6; margin: 0 2px; }
.kc.mb { display: inline-flex; gap: 5px; padding: 0 8px 0 7px; font-size: 11px; letter-spacing: .02em; }
.kc.mb b { position: relative; width: 11px; height: 16px; border-radius: 6px; border: 2px solid #2a1d18; display: block; flex: none;
  background: linear-gradient(90deg, #2a1d18 0 50%, transparent 50%) 0 0 / 100% 42% no-repeat; }
.kc.mb.r b { background: linear-gradient(90deg, transparent 0 50%, #2a1d18 50%) 0 0 / 100% 42% no-repeat; }

/* ============================================================= map tab */
.p-map .pan { left: 50%; transform: translateX(-50%); width: min(1260px, calc(100% - 52px)); top: 18px; bottom: 6px; padding: 30px 22px 14px; }
.mhead { display: flex; align-items: center; gap: 18px; margin: 0 4px 12px; }
.mhead .mt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mhead .mt b { font: 700 20px/1.05 var(--l3d-hd); } .mhead .mt .mut { font: 700 12px/1 var(--l3d-tx); }
.legend { flex: 1; display: flex; flex-wrap: wrap; gap: 6px 18px; justify-content: center; font: 800 12.5px/1 var(--l3d-tx); color: #e6d6df; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.lg { display: inline-block; width: 12px; height: 12px; border-radius: 50%; flex: none; }
.lg.me { background: var(--l3d-accent); box-shadow: 0 0 0 2px #fff; width: 10px; height: 10px; }
.lg.pl { background: #e9d8ff; width: 8px; height: 8px; box-shadow: 0 0 0 1.5px #1d1620; }
.lg.bd { border-radius: 4px; background: #6e4a66; box-shadow: inset 0 0 0 1.5px #ffcf6a99; width: 16px; }
.lg.st { border-radius: 2px; width: 16px; height: 9px; background: repeating-linear-gradient(#a88c84 0 2px, #6a5552 2px 4px); }
.lg.wa { border-radius: 3px; width: 18px; height: 8px; background: #2b4f7e; box-shadow: inset 0 2px 0 #4a79b0; }
.mapslot { position: relative; flex: 1; min-height: 0; display: flex; }
.mapv { position: relative; flex: 1; min-height: 0; border-radius: 16px; overflow: hidden; cursor: grab; touch-action: none; background: #151019;
  box-shadow: inset 0 0 0 1.5px #ffffff14, 0 0 0 1px #00000066; }
.mapv.grab { cursor: grabbing; }
.mapv::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: 16px; box-shadow: inset 0 0 40px #0009; }
.mapc { position: absolute; left: 0; top: 0; }
.mpins { position: absolute; inset: 0; pointer-events: none; }
.mpin { position: absolute; left: 0; top: 0; width: 0; height: 0; padding: 0; border: 0; background: none; cursor: pointer; pointer-events: auto; z-index: 1; }
.mpin .ic { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 15px; line-height: 1;
  background: radial-gradient(circle at 40% 30%, #4a3654, #241b2a 75%); box-shadow: 0 0 0 2px var(--l3d-gold), 0 0 0 4px #1d1620cc, 0 4px 10px #000a; transition: transform .12s var(--ease); }
.mpin .lb { position: absolute; box-sizing: border-box; height: 20px; white-space: nowrap; padding: 3px 8px 0; border-radius: 999px; font: 800 11.5px/1.1 var(--l3d-tx); color: var(--l3d-ink);
  background: rgba(29,22,32,.88); box-shadow: 0 0 0 1px var(--line), 0 3px 8px #0008; pointer-events: none; }
.mpin .lb { left: 0; top: 0; }
.mpin.hidlab .lb { visibility: hidden; }
.mpin.hidlab:hover .lb, .mpin.hidlab.sel .lb { visibility: visible; z-index: 3; }
.mpin:hover, .mpin.sel { z-index: 4; }
.mpin:hover .ic, .mpin.sel .ic { transform: scale(1.18); box-shadow: 0 0 0 2.5px #fff3d0, 0 0 0 5px #1d1620cc, 0 0 16px #ffcf6a99; }
.mpin.sel .lb { color: #2a1d18; background: linear-gradient(#ffe7a6, var(--l3d-gold)); box-shadow: 0 2px 0 var(--l3d-gold-d); }
.mpin.soon .ic { filter: grayscale(.85) brightness(.8); box-shadow: 0 0 0 2px #bfaab7aa, 0 0 0 4px #1d1620cc; }
.mpin.soon .lb { color: var(--l3d-mute); }
.mme { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 2; }
.mme i { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%; background: var(--l3d-accent); box-shadow: 0 0 0 3px #fff, 0 0 0 5px #1d1620aa, 0 0 14px var(--l3d-accent); }
.mme i::before { content: ''; position: absolute; left: 50%; top: -15px; transform: translateX(-50%); border: 7px solid transparent; border-bottom: 10px solid #fff; border-top: 0; filter: drop-shadow(0 0 2px #000); }
.mme::after { content: ''; position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--l3d-accent); animation: mping 1.8s ease-out infinite; }
@keyframes mping { from { transform: scale(1); opacity: .9; } to { transform: scale(2.8); opacity: 0; } }
.mme[hidden] { display: none; }
.mpop { position: absolute; left: 0; top: 0; width: 236px; padding: 12px 14px 14px; border-radius: 16px; z-index: 6; pointer-events: auto; cursor: default;
  background: linear-gradient(rgba(52,40,60,.98), rgba(31,23,36,.98)); box-shadow: 0 0 0 2px var(--l3d-gold), 0 0 0 5px rgba(29,22,32,.9), 0 16px 32px #000a; }
.mpop[hidden] { display: none; }
.mpop .pt { display: flex; align-items: center; gap: 8px; padding-right: 22px; } .mpop .pt .emo { font-size: 20px; } .mpop .pt b { font: 700 16px/1.15 var(--l3d-hd); }
.mpop .ps { font: 700 12px/1.35 var(--l3d-tx); color: var(--l3d-mute); margin: 5px 0 10px; }
.mpop .ph { margin: 0; font: 600 12px/1.35 var(--l3d-tx); }
.mpop .btn { width: 100%; justify-content: center; }
.mpop .px { position: absolute; right: 8px; top: 8px; width: 24px; height: 24px; border: 0; border-radius: 50%; cursor: pointer; background: #ffffff10; color: var(--l3d-mute); font: 700 12px/1 var(--l3d-tx); }
.mpop .px:hover { color: var(--l3d-ink); background: #ffffff1c; }
.mzoom { position: absolute; right: 12px; bottom: 12px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 5px; border-radius: 16px; z-index: 5;
  background: rgba(29,22,32,.88); box-shadow: 0 0 0 1.5px var(--line), 0 6px 14px #0008; }
.mzoom button { width: 30px; height: 30px; border: 0; border-radius: 10px; cursor: pointer; background: #ffffff0d; color: var(--l3d-ink); font: 800 17px/1 var(--l3d-tx); }
.mzoom button:hover { background: var(--l3d-gold); color: #2a1d18; }
.mzoom .mzt { font: 800 9.5px/1 var(--l3d-tx); color: var(--l3d-mute); padding: 2px 0; }
.mfoot { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 22px; margin-top: 10px; font: 700 12px/1.2 var(--l3d-tx); color: var(--l3d-mute); }
.mfoot b { color: var(--l3d-ink); font-weight: 800; }

/* ============================================================= minimap (HUD, optional) */
.hud .mini { right: 16px; top: 48px; width: 148px; height: 148px; border-radius: 50%; pointer-events: auto; cursor: pointer;
  box-shadow: 0 0 0 2.5px var(--l3d-gold), 0 0 0 5px rgba(29,22,32,.75), 0 8px 18px #0008; background: #151019; }
.hud .mini[hidden] { display: none; }
.hud .mini canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; }
.hud .mini::after { content: ''; position: absolute; inset: 0; border-radius: 50%; box-shadow: inset 0 0 18px #000c; pointer-events: none; }
.hud .mini .mn { position: absolute; left: 0; top: 0; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; z-index: 1;
  font: 400 10px/1 var(--l3d-num); font-style: normal; color: #2a1d18; background: var(--l3d-gold); box-shadow: 0 1px 3px #000a; }
.hud .mini .mme { position: absolute; left: 50%; top: 50%; width: 0; height: 0; z-index: 1; }
.hud .mini .mme::before { content: ''; position: absolute; left: -6px; top: -9px; border: 6px solid transparent; border-bottom: 13px solid var(--l3d-accent); border-top: 0;
  filter: drop-shadow(0 0 1px #fff) drop-shadow(0 1px 2px #000); }
.hud .mini .mme::after { display: none; }

/* ============================================================= feature tabs (ui.addTab) */
.p-custom .pan { left: 50%; transform: translateX(-50%); width: min(980px, 88%); top: 18px; bottom: 6px; }
.p-custom.p-side .pan { left: auto; right: 26px; transform: none; width: min(640px, calc(56% - 52px)); }
/* Locally starred map pins and quick list; selection remains a separate manual action. */
.mpin.favorite .ic { box-shadow:0 0 0 2px #ffcf6a,0 0 0 5px #1d1620; }
.mpin.favorite .ic::after { content:'★'; position:absolute;right:-9px;top:-12px;color:#ffcf6a;font-size:15px;text-shadow:0 2px 3px #000; }
.mfavs { position:absolute;left:12px;top:12px;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:5px;max-width:min(420px,65%);pointer-events:auto; }
.mfavs b,.mfavs button { border-radius:16px;background:#211927e8;color:#ffe2a0;border:1px solid #ffcf6a66;padding:5px 9px;font:700 11px var(--l3d-tx); }
.mfavs button { cursor:pointer; }
.gear-medals { position:absolute;inset:0;pointer-events:none; }
.gear-medals span { position:absolute;left:50%;top:26%;font-size:22px;animation:medal-float 4s ease-in-out infinite alternate;animation-delay:calc(var(--i) * -0.8s);filter:drop-shadow(0 2px 3px #000a); }
.gear-medals small {position:absolute;top:3px;left:50%;transform:translateX(-50%);white-space:nowrap;color:var(--l3d-mute);font-size:11px;}
@keyframes medal-float { to {transform:translateY(-8px) rotate(5deg);} }
@media(prefers-reduced-motion:reduce){.gear-medals span{animation:none;}}
.milestones {margin:10px 0;padding:8px 12px;border-left:2px solid var(--l3d-gold);background:#ffd48b0b;}
.milestones p {margin:6px 0;color:var(--l3d-ink);font-size:12px;}
`;

/**
 * The site's own chat (the City's `#tab-city .cy-chat`, or — site 30.10 «chatone» — the one window LGChatOne: in the City's slot, in our
 * mine host `.l3d-co-host`, or its own `.co-float` outside scenes; light DOM) docked over the game: fixed bottom-left above our canvas
 * (z 160: over the UI layer 150, under the site's building screens 200), in the HUD's den palette; faded when idle
 * (.l3d-idle, set by src/ui/chat.ts) unless hovered or focused; hidden over our menus / with the HUD off
 * (html.l3d-chat-off) and while the game is hidden for a site screen (#l3d-ui[hidden]). Only active with html.l3d-on
 * (3D mode): classic mode gets the site's own layout back untouched.
 * Size (site 30.10): the window has a fixed height (280–340 px, `.cy-chat-b`) and the viewer drags its top / right edges on a PC
 * (`.cy-chat-rz` handles, inline width / height) — the list and the DMs fill it (flex), nothing here caps them; idle is compact (auto height).
 */
export const SITE_CHAT_CSS = String.raw`
html.l3d-on.l3d-chat-dock :is(#tab-city, .l3d-co-host, .co-float) .cy-chat { position: fixed !important; left: 16px; bottom: 16px; top: auto; right: auto; z-index: 160; margin: 0 !important;
  width: min(410px, calc(100vw - 32px)); visibility: visible !important; pointer-events: auto !important; transition: opacity .45s ease;
  font: 600 13.5px/1.34 'Nunito', var(--tx, 'Golos Text'), 'Segoe UI', sans-serif; color: #f7eadf; text-shadow: 0 1px 2px #000a; }
html.l3d-on.l3d-chat-dock :is(#tab-city, .l3d-co-host, .co-float) .cy-chat * { visibility: visible; }
html.l3d-on.l3d-chat-off :is(#tab-city, .l3d-co-host, .co-float) .cy-chat, html.l3d-on:has(#l3d-ui[hidden]) :is(#tab-city, .l3d-co-host, .co-float) .cy-chat { display: none !important; }
/* the mine host of the single chat (src/ui/chat.ts attachMineChat): the whole viewport, so the site's resize limits (its rect) are the window's; the chat inside takes the clicks */
.l3d-co-host { position: fixed; inset: 0; z-index: 160; pointer-events: none; }
html.l3d-on .co-float { z-index: 160; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-t { min-height: 34px; padding: 0 13px; background: rgba(29,22,32,.86); box-shadow: 0 0 0 1.5px #ffcf6a47, 0 8px 20px #0008; font: 800 13px/1 'Nunito', var(--tx, sans-serif); }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-n { background: #ffcf6a; color: #2a1d18; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-b { padding: 7px 9px 9px; border-radius: 16px; background: rgba(20,14,24,.78); box-shadow: 0 0 0 1.5px #ffcf6a47, 0 12px 30px #0008; transition: background .45s, box-shadow .45s; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-h { margin: -1px 0 5px; color: #ffcf6aaa; font: 800 11px/1 'Comfortaa', 'Nunito', var(--hd, sans-serif); letter-spacing: .06em; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-h > span::after { content: '   Enter — писать · Esc — в игру'; white-space: pre; text-transform: none; letter-spacing: 0; font: 700 10.5px/1 'Nunito', var(--tx, sans-serif); color: #bfaab7aa; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-x, html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-sh { width: 24px; height: 24px; border-radius: 7px; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-tabs { gap: 4px; margin-bottom: 5px; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-tabs button { min-height: 26px; padding: 0 10px; border: 0; background: rgba(29,22,32,.8); box-shadow: 0 0 0 1px #ffcf6a47; color: #bfaab7; font: 800 11.5px/1 'Nunito', var(--tx, sans-serif); }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-tabs button[aria-selected="true"] { background: #ffcf6a; box-shadow: none; color: #2a1d18; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-l li { padding-top: 2px; padding-bottom: 2px; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-ev { color: #ffcf6a; font-style: italic; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-sys { color: #bfaab7; font-style: italic; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-l::-webkit-scrollbar-thumb:hover { background: #ffcf6a; background-clip: padding-box; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-f input { height: 34px; padding: 0 14px; border-radius: 999px; border: 0; background: rgba(29,22,32,.94); box-shadow: 0 0 0 1px #ffcf6a47; color: #f7eadf; font: 600 13px/1 'Nunito', var(--tx, sans-serif); }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-f input:focus { outline: 0; box-shadow: 0 0 0 2px #ffcf6a; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-f button { width: 34px; height: 34px; border-radius: 999px; background: #ffcf6a; color: #2a1d18; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) { opacity: .6; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) .cy-chat-b { background: rgba(20,14,24,.3); box-shadow: none; }
/* idle = compact: the last ~5 lines, no header (bottom-anchored, so it grows upwards under the cursor on hover) */
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) .cy-chat-h { display: none; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) .cy-chat-b { height: auto !important; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) :is(.cy-chat-dmx, .dm) { flex: 0 1 auto; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) .cy-chat-rz { display: none !important; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) .cy-chat-l { flex: 0 1 auto; max-height: 112px; overflow: hidden;
  -webkit-mask: linear-gradient(transparent, #000 22px); mask: linear-gradient(transparent, #000 22px); }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-tabs button.l3d-mine-tab { white-space: nowrap; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-mine-on .cy-chat-tabs button[aria-selected="true"]:not(.l3d-mine-tab) { background: rgba(29,22,32,.8); box-shadow: 0 0 0 1px #ffcf6a47; color: #bfaab7; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-mine-on .cy-chat-l:not(.l3d-mine-l), html.l3d-on.l3d-chat-dock .cy-chat.l3d-mine-on .cy-chat-f:not(.l3d-mine-f),
html.l3d-on.l3d-chat-dock .cy-chat.l3d-mine-on .cy-chat-to, html.l3d-on.l3d-chat-dock .cy-chat.l3d-mine-on .cy-chat-p { display: none !important; }
html.l3d-on .cy-chat:not(.l3d-mine-on) .l3d-mine-l, html.l3d-on .cy-chat:not(.l3d-mine-on) .l3d-mine-f { display: none !important; }
html.l3d-on.l3d-chat-dock .cy-chat .l3d-mine-l { margin: 0; padding: 0; list-style: none; overflow-y: auto; }
html.l3d-on.l3d-chat-dock .cy-chat .l3d-mine-l li.me b { text-decoration: underline dotted #fff6; }
html.l3d-on.l3d-chat-dock .cy-chat .l3d-mine-l .cy-chat-0 { color: #bfaab7; }
html.l3d-on .cy-nm { z-index: 165 !important; }
/* moderation in the dock (src/ui/chat-mod.ts): the site's «⋯» opens our menu (never the inline row), our ⚙ for the mine chat */
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-l li .cy-chat-mm { display: none !important; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-l li .cy-chat-m { top: 1px; width: 26px; height: 22px; color: #ffcf6aee; font: 800 16px/1 system-ui, sans-serif; text-shadow: none; }
html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-l li .cy-chat-m:hover, html.l3d-on.l3d-chat-dock .cy-chat .cy-chat-l li .cy-chat-m:focus-visible { color: #fff; background: #ffcf6a2e; outline: 0; }
html.l3d-on.l3d-chat-dock .cy-chat .l3d-cr { font-style: normal; margin-right: 3px; font-size: 12px; }
html.l3d-on.l3d-chat-dock .cy-chat .l3d-mine-sh { margin-left: auto; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; background: rgba(255,255,255,.1); color: #fff; font: 16px/1 system-ui; cursor: pointer; }
html.l3d-on.l3d-chat-dock .cy-chat .l3d-mine-sh:hover, html.l3d-on.l3d-chat-dock .cy-chat .l3d-mine-sh:focus-visible { background: rgba(255,255,255,.25); outline: 2px solid #fff; outline-offset: 0; }
html.l3d-on .cy-chat .l3d-mine-sh[hidden], html.l3d-on .cy-chat:not(.l3d-mine-on) .l3d-mine-sh { display: none !important; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-mine-on .cy-chat-h .cy-chat-sh { display: none !important; }
html.l3d-on.l3d-chat-dock .cy-chat .l3d-mine-f input:disabled, html.l3d-on.l3d-chat-dock .cy-chat .l3d-mine-f button:disabled { opacity: .5; cursor: not-allowed; }
/* «Личные» (site 29.10, window.LGDm): the site draws its .dm inside .cy-chat-dmx; here only our palette. The mine tab (ours) hides it. */
html.l3d-on.l3d-chat-dock .cy-chat.l3d-mine-on .cy-chat-dmx { display: none !important; }
html.l3d-on.l3d-chat-dock .cy-chat .dm { font: 600 13.5px/1.34 'Nunito', var(--tx, sans-serif); color: #f7eadf; text-shadow: 0 1px 2px #000a; gap: 5px; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-tab { background: rgba(29,22,32,.8); box-shadow: 0 0 0 1px #ffcf6a47; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-tab.on { background: #ffcf6a26; box-shadow: inset 0 0 0 1.5px #ffcf6a; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-tab button { min-height: 26px; font: 800 11.5px/1 'Nunito', var(--tx, sans-serif); }
html.l3d-on.l3d-chat-dock .cy-chat .dm-un, html.l3d-on.l3d-chat-dock .cy-chat .dm-fn { background: #ffcf6a; color: #2a1d18; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-who { color: #f7eadf; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-acts button, html.l3d-on.l3d-chat-dock .cy-chat .dm-rep button { border-color: #ffcf6a47; color: #bfaab7; font-weight: 700; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-acts button:hover, html.l3d-on.l3d-chat-dock .cy-chat .dm-rep button:hover { background: #ffcf6a22; color: #f7eadf; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-l li { padding: 2px 0; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-l .dm-0 { color: #bfaab7; font-style: italic; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-old button { color: #ffcf6a; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-f input, html.l3d-on.l3d-chat-dock .cy-chat .dm-rep input { min-height: 34px; padding: 0 14px; border: 0; border-radius: 999px; background: rgba(29,22,32,.94); box-shadow: 0 0 0 1px #ffcf6a47; color: #f7eadf; font: 600 13px/1 'Nunito', var(--tx, sans-serif); }
html.l3d-on.l3d-chat-dock .cy-chat .dm-f input:focus, html.l3d-on.l3d-chat-dock .cy-chat .dm-rep input:focus { outline: 0; box-shadow: 0 0 0 2px #ffcf6a; }
html.l3d-on.l3d-chat-dock .cy-chat .dm-f button { width: 34px; height: 34px; border-radius: 999px; background: #ffcf6a; color: #2a1d18; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) .dm-h, html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) .dm-f { display: none; }
html.l3d-on.l3d-chat-dock .cy-chat.l3d-idle:not(:hover):not(:focus-within) .dm-l { flex: 0 1 auto; max-height: 112px; overflow: hidden; -webkit-mask: linear-gradient(transparent, #000 22px); mask: linear-gradient(transparent, #000 22px); }
/* the site's small DM window (bottom-left, when LGDm has no chat to live in): above our canvas and UI layer, hidden with the HUD / over menus */
html.l3d-on .dm-float { z-index: 165; font-family: 'Nunito', var(--tx, sans-serif); box-shadow: 0 0 0 1.5px #ffcf6a47, 0 12px 30px #0008; }
html.l3d-on .dm-float .dm-f input { background: rgba(29,22,32,.94); }
html.l3d-on.l3d-dm-off .dm-float, html.l3d-on:has(#l3d-ui[hidden]) .dm-float { display: none !important; }
`;
