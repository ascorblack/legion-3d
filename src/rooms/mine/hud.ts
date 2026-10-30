/**
 * Mine HUD (DOM, our own), styled like src/ui (dark plum glass, gold hairlines, Nunito / Comfortaa, pill chips):
 *  - one compact card top-right (under the «онлайн» chip): mine · floor · nature · 👥/⛏, «Сейчас» (the stone being
 *    dug with its bar, «Стоп»), earnings (coins + ore, «Скупщик»), today's time and mastery as two hairline meters.
 *    The card collapses to its header line (button or [L]+Shift… no: the ▾ button; state kept in localStorage).
 *  - the journal is hidden behind [L] / the «Журнал» button: a drawer with the hero stats + mine log. The mine chat is
 *    NOT here any more: it is the «⛏ Шахта» tab of the bottom-left chat dock (src/ui/chat.ts, attachMineChat); incoming
 *    lines are also bubbles over the miners.
 *  - tips, «+руда» popups over the dug stone, the «other tab» / «dark» notices, and the NPC cards: buyer «Скупщик
 *    Гром», supplier «Снабженец Кремень» / «Фонарщик», board «Поручения».
 * Re-renders only the parts whose HTML changed (buttons are not recreated under the cursor).
 */
import { moneyCompact } from '../../ui/money';
import type { MineClient } from './net';
import {
  TX, BIO_RU, stars, mmss, leftTxt, resName, qty, resList, blockTitle, stoneProgress, canClaimOf, markQcClaimed, qcStatus, qcReady, dayLimit, weekResetTxt, spanTxt, NewsGate,
  type Quest, type QuestC, type MineNews, type ChatLine, type MineView,
} from './state';
import { layerOf, layerSpan } from './layers';
import { liftInfo, drillsOf, drillFundable, drillLeft, drillLine, fundButtons, hmTxt, tmrTxt, objective, OreAsk, type DrillInfo, type Objective } from './fund';
import { setHtml } from '../../core/html';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const COIN: Record<string, string> = { g: '#f2c14e', s: '#c8ccd8', b: '#c07a44' };
export const coinsHtml = (n: number) => moneyCompact(Math.max(0, Math.floor(n))).map(([k, v]) => `<span class="l3m-coin"><i class="${k}"></i>${v}</span>`).join(' ');
/** Site coins(): whole coins as money; under 10 with tenths (a crowd stone pays 0.1–0.5). */
export const coinsFrac = (x: number) => { const v = Math.max(0, +x || 0), n = Math.floor(v + 1e-9); if (v - n < 0.05 || n >= 10) return coinsHtml(n); const t = v.toFixed(v < 1 ? 2 : 1).replace('.', ','); return `<span class="l3m-coin"><i class="b"></i>${t}</span>`; };
const pcs = (q: number) => { const v = Math.floor(q) / 100; return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')).replace('.', ','); };
/** Minutes, short: «45 мин», «2 ч», «2 ч 5 м». */
const hm = (min: number) => { const m = Math.max(0, Math.round(min)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} м` : ''}`; };
const val = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
void COIN;
/** The site's eye (city.js OTH_ICO): hidden → crossed out. */
const EYE_ICO = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="x" d="M3 3l18 18"/></svg>';

const CSS = `
.l3m{--bg:rgba(29,22,32,.8);--bg2:rgba(42,32,48,.94);--ink:#f7eadf;--mute:#bfaab7;--gold:#ffcf6a;--goldd:#b8862a;--acc:#ff8fa3;--up:#8fe39a;--dn:#ff8f8f;
  --line:rgba(255,207,106,.28);--hd:'Comfortaa','Nunito','Trebuchet MS',sans-serif;--tx:'Nunito','Golos Text','Segoe UI',sans-serif;--num:'Dela Gothic One','Russo One','Comfortaa','Arial Black',sans-serif;
  position:absolute;inset:0;pointer-events:none;font:500 13px/1.35 var(--tx);color:var(--ink);z-index:5;-webkit-font-smoothing:antialiased}
.l3m *{box-sizing:border-box}.l3m [hidden]{display:none!important}
.l3m button{font:inherit;color:inherit}
.l3m-box{background:var(--bg);box-shadow:0 0 0 1.5px var(--line),0 6px 18px #0006;border-radius:16px;backdrop-filter:blur(6px)}
.l3m-hud{position:absolute;right:16px;top:50px;width:284px;pointer-events:auto;overflow:hidden}
/* top-left under the player card and its chips (mine chip top 122, friends chip top 176 — src/ui/*-chip.ts); site: «карта этажа - слева сверху». Bottom-right was under the «Что нового» card */
.l3m-mm{position:absolute;left:16px;top:214px;padding:6px;border-radius:12px;background:rgba(21,18,46,.72);border:1px solid rgba(242,193,78,.35);box-shadow:0 6px 18px rgba(0,0,0,.35);pointer-events:none;line-height:0}
.l3m-mm canvas{display:block;border-radius:6px;image-rendering:pixelated}
.l3m-mm .cap{display:block;line-height:1.2;font:700 11px/1.2 Nunito,system-ui,sans-serif;color:#f2e6d8;opacity:.85;margin:0 0 4px 2px}
.l3m-hd{padding:8px 8px 7px 12px;cursor:pointer}
.l3m-hd .t{font:700 13px/1.15 var(--hd);color:var(--gold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.l3m-hd .t small{font:600 11px var(--tx);color:var(--mute)}
.l3m-hd .s{font-size:11px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.l3m-hd .g{display:flex;flex-direction:column;gap:4px}.l3m-hd .l1,.l3m-hd .l2{display:flex;align-items:center;gap:6px;justify-content:space-between}
.l3m-hd .ib{display:inline-flex;gap:4px;flex:none}.l3m-hd .l3m-hb{width:22px;height:22px}.l3m-hd .l3m-jb{height:22px}
.l3m-tg{width:24px;height:24px;border-radius:999px;border:0;background:#ffffff10;cursor:pointer;display:grid;place-items:center;transition:transform .2s;flex:none}
.l3m-hud.min .l3m-tg{transform:rotate(-90deg)}
.l3m-bd{padding:0 12px 10px;display:flex;flex-direction:column;gap:7px}
.l3m-hud.min .l3m-bd{display:none}
.l3m-mbar{height:3px;margin:0 12px 8px;border-radius:3px;background:#0006;overflow:hidden}.l3m-mbar i{display:block;height:100%}
.l3m-hud:not(.min) .l3m-mbar{display:none}
.l3m-sec{border-top:1px solid #ffffff14;padding-top:7px}
.l3m-bd>.l3m-sec:first-child{border-top:0;padding-top:0}
.l3m .nw{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.l3m-k{font:800 10px/1 var(--tx);letter-spacing:.09em;text-transform:uppercase;color:var(--mute);margin-bottom:5px;display:flex;justify-content:space-between;gap:6px;align-items:center}
.l3m-k small{text-transform:none;letter-spacing:0;font-weight:600}
.l3m-t{font-weight:700;margin:0}.l3m-t b{color:var(--gold)}.l3m-mut{color:var(--mute);margin:0;font-size:12px}
.l3m-bar{height:7px;border-radius:999px;background:#0007;overflow:hidden;margin:6px 0 5px;box-shadow:inset 0 0 0 1px #ffffff10}.l3m-bar i{display:block;height:100%;border-radius:999px;transition:width .4s linear}
.l3m-row{display:flex;justify-content:space-between;gap:8px;align-items:center}
.l3m-meters{display:grid;grid-template-columns:1fr 1fr;gap:10px;line-height:1.2}
.l3m .lb{font-size:11px;color:var(--mute);margin-right:4px}.l3m-meters .v{font-weight:800;font-size:12px}
.l3m-mini{height:3px;border-radius:3px;background:#0007;overflow:hidden;margin-top:4px}.l3m-mini i{display:block;height:100%;background:var(--up)}.l3m-mini.xp i{background:#b9a2ff}
.l3m-btn{pointer-events:auto;font:800 12px/1 var(--tx)!important;cursor:pointer;border:0;border-radius:999px;padding:7px 12px;background:linear-gradient(#ffe08a,#ffcf6a 55%,#e8ad3c);color:#2a1d18!important;box-shadow:0 2px 0 var(--goldd),inset 0 1px 0 #fff8;white-space:nowrap}
.l3m-btn:hover{filter:brightness(1.07)}.l3m-btn:active{transform:translateY(1px);box-shadow:0 1px 0 var(--goldd)}
.l3m-btn.ghost{background:#ffffff14;color:var(--ink)!important;box-shadow:0 0 0 1px var(--line)}.l3m-btn.ghost:hover{background:#ffffff22}
.l3m-btn.sm{padding:5px 9px;font-size:11px!important}.l3m-btn[disabled]{opacity:.5;cursor:default;filter:none}
.l3m-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.l3m-jb{display:inline-flex;gap:4px;align-items:center;padding:3px 5px!important;flex:none}
.l3m-kc{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:6px;font:400 10px/1 var(--num);color:var(--ink);background:linear-gradient(#4a3a54,#33263b);box-shadow:0 2px 0 #160f1a,inset 0 1px 0 #ffffff22}
.l3m-btn:not(.ghost) .l3m-kc{background:#2a1d18;color:var(--gold)}
.l3m-dot{display:inline-block;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--acc);color:#2a1d18;font:800 10px/16px var(--tx);text-align:center}
.l3m-coin{display:inline-flex;align-items:center;gap:3px;font-weight:800}.l3m-coin i{width:12px;height:12px;border-radius:50%;display:inline-block;box-shadow:inset 0 -2px 0 #0004,0 0 0 1.5px #2a2236}
.l3m-coin i.g{background:radial-gradient(circle at 35% 30%,#fff1b0,#f2c14e 60%,#b8862a)}.l3m-coin i.s{background:radial-gradient(circle at 35% 30%,#fff,#c8ccd8 60%,#8a90a4)}.l3m-coin i.b{background:radial-gradient(circle at 35% 30%,#f3c39a,#c07a44 60%,#7a4420)}
.l3m-jr{position:absolute;right:16px;top:50px;width:300px;max-height:min(440px,calc(100% - 200px));display:flex;flex-direction:column;pointer-events:auto;overflow:hidden}
.l3m-jr .tabs{display:flex;gap:4px;padding:8px 8px 6px;align-items:center}
.l3m-jr .tabs button{border:0;cursor:pointer;padding:6px 11px;border-radius:999px;font:800 11px/1 var(--tx);background:#ffffff10;color:var(--mute);display:inline-flex;gap:5px;align-items:center}
.l3m-jr .tabs button[aria-selected="true"]{background:var(--gold);color:#2a1d18}
.l3m-jr .tabs .x{margin-left:auto;width:26px;height:26px;padding:0;justify-content:center}
.l3m-jr .body{overflow:auto;padding:0 12px 10px;scrollbar-width:thin;flex:1;min-height:0}
.l3m-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 8px}
.l3m-stats>div{background:#ffffff0c;border-radius:10px;padding:6px 8px}
.l3m-stats dt{font-size:11px;color:var(--mute)}.l3m-stats dd{margin:0;font-weight:800}.l3m-stats .ok{color:var(--up)}
.l3m-log{list-style:none;margin:0;padding:0;font-size:12px;display:flex;flex-direction:column;gap:3px}
.l3m-log li{padding:4px 0;border-bottom:1px solid #ffffff0d;color:#e9dcd2}
.l3m-chat{display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.l3m-chat .ln b{font-weight:800;margin-right:4px}.l3m-chat .ln.me b{color:var(--gold)}
.l3m-chat .empty{color:var(--mute)}
.l3m-in{display:flex;gap:6px;padding:0 10px 10px}
.l3m-in input{flex:1;min-width:0;pointer-events:auto;border:0;border-radius:999px;padding:7px 12px;background:#0006;color:var(--ink);font:600 12.5px/1.2 var(--tx);box-shadow:0 0 0 1px var(--line);outline:none}
.l3m-in input:focus{box-shadow:0 0 0 1.5px var(--gold)}
.l3m-tip{z-index:4;position:absolute;left:50%;bottom:150px;transform:translateX(-50%);max-width:min(560px,90%);background:var(--bg2);box-shadow:0 0 0 1.5px var(--line),0 6px 18px #0006;border-radius:999px;padding:8px 18px;font-weight:700;text-align:center;transition:opacity .25s}
.l3m-tip.bad{box-shadow:0 0 0 1.5px var(--dn),0 6px 18px #0006;color:#ffd6d6}
.l3m-pop{position:absolute;transform:translate(-50%,-100%);font:800 17px/1 var(--tx);color:#ffe27a;text-shadow:0 2px 0 #2a1d18,0 0 8px rgba(0,0,0,.6);white-space:nowrap;transition:opacity .3s}
.l3m-other,.l3m-dark{position:absolute;left:50%;top:72px;transform:translateX(-50%);border-radius:999px;padding:7px 8px 7px 16px;display:flex;gap:10px;align-items:center;font-weight:700}
.l3m-other{pointer-events:auto;background:rgba(110,28,40,.92);box-shadow:0 0 0 1.5px var(--dn)}
.l3m-dark{background:rgba(10,8,20,.9);box-shadow:0 0 0 1.5px var(--dn);pointer-events:auto;max-width:min(640px,92%)}
.l3m-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(14,9,18,.5);pointer-events:auto}
.l3m-win{width:min(460px,94%);max-height:86%;overflow:auto;background:linear-gradient(#2a2030,#221a28);box-shadow:0 0 0 1.5px var(--line),0 16px 40px #000a;border-radius:20px;padding:16px 18px}
.l3m-win h3{margin:0 0 4px;font:700 18px/1.2 var(--hd);color:var(--gold)}.l3m-say{font-style:italic;margin:4px 0 10px;color:#e9dcd2}
.l3m-list{list-style:none;margin:8px 0;padding:0;display:flex;flex-direction:column;gap:5px}
.l3m-list li{display:flex;justify-content:space-between;gap:8px;background:#ffffff0c;border-radius:10px;padding:6px 9px;align-items:center}
.l3m-list li.done{box-shadow:0 0 0 1.5px var(--up)}.l3m-list li.cl{opacity:.55}.l3m-list li.no b{color:var(--dn)}.l3m-list li.ok b{color:var(--up)}
.l3m-tabs{display:flex;gap:6px;margin:8px 0}.l3m-tabs button[aria-selected="true"]{background:var(--gold);color:#2a1d18!important}
.l3m-offer{display:flex;justify-content:space-between;align-items:center;background:#ffcf6a1c;border-radius:12px;padding:8px 11px;margin-top:6px;font-weight:800}
.l3m-list li.qc{flex-wrap:wrap}.l3m-list li.qc .l3m-mini{flex:1 0 100%;margin-top:2px}.l3m-list li.qc.ready{box-shadow:0 0 0 1.5px var(--gold)}
.l3m-list li.qc>span:first-child{flex:1 1 60%;min-width:0}.l3m-list li.qc>b{margin-left:auto;white-space:nowrap}.l3m-qc .l3m-k small{font-size:11px;font-weight:700;color:var(--ink)}
.l3m-qc .l3m-mini i{background:var(--gold)}.l3m-qc.ready .l3m-mini i,.l3m-qc.done .l3m-mini i{background:var(--up)}.l3m-qc b.rdy{color:var(--up)}
.l3m-lim{margin-top:7px;border-radius:10px;padding:5px 9px;font-size:12px;font-weight:700;background:#ffcf6a1c;color:var(--gold)}
.l3m-lim.full{background:#ff8f8f1c;color:#ffd6d6;box-shadow:0 0 0 1px #ff8f8f55}
.l3m-mini.low i{background:var(--gold)}.l3m-mini.full i{background:var(--dn)}
.l3m-q{margin-top:6px;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}.l3m-q .lb{margin:0}
.l3m-q .qn{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#ff8fa3;color:#2a1d18;font:800 10px/1 var(--tx);margin-right:3px}
.l3m-hb{width:24px;height:24px;padding:0!important;display:grid;place-items:center;flex:none;font:800 12px/1 var(--tx)!important}
.l3m-help,.l3m-top{scrollbar-width:thin;scrollbar-color:#ffcf6a66 transparent;padding-bottom:0!important}
.l3m-help>.l3m-btns,.l3m-top>.l3m-btns{position:sticky;bottom:0;margin:6px -18px 0;padding:18px 18px 12px;background:linear-gradient(#221a2800,#221a28 45%);justify-content:center}
.l3m-x{position:sticky;top:0;float:right;margin:-6px -8px 0 0;width:28px;height:28px;border:0;border-radius:999px;background:#ffffff14;color:var(--ink);cursor:pointer;font:800 14px/1 var(--tx);z-index:1}
.l3m-x:hover{background:#ffffff26}
.l3m-help h4,.l3m-top h4{margin:12px 0 4px;font:700 13px/1.2 var(--hd);color:var(--gold)}
.l3m-help ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:#e9dcd2}
.l3m-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}.l3m-sum>div{background:#ffffff0c;border-radius:10px;padding:6px 8px;text-align:center}
.l3m-sum b{display:block;font:400 18px/1.1 var(--num);color:var(--gold)}.l3m-sum span{font-size:11px;color:var(--mute)}
.l3m-top ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.l3m-top li{display:grid;grid-template-columns:22px 1fr auto;gap:6px;background:#ffffff0c;border-radius:9px;padding:4px 9px;font-size:12.5px}
.l3m-top li span{color:var(--mute);font-weight:800}.l3m-top li em{font-style:normal;font-weight:800}.l3m-top li.me{box-shadow:0 0 0 1.5px var(--gold)}.l3m-top li.me b{color:var(--gold)}
.l3m-news{z-index:2}.l3m-news .l3m-win{width:min(420px,94%)}.l3m-news h3{font-size:19px}
.l3m-news .l3m-list li{flex-direction:column;align-items:flex-start;gap:1px;padding:7px 11px}.l3m-news .l3m-list li>span{font-size:11px;color:var(--mute)}.l3m-news .l3m-list li b{font-size:14px}.l3m-news .l3m-btns{justify-content:center}.l3m-news .l3m-btn{padding:9px 26px;font-size:14px!important}
/* mineux: objective, lift row, collections, floors, bag, coach, eye */
.l3m-obj{display:flex;align-items:center;gap:7px;background:linear-gradient(90deg,#ffcf6a26,#ffcf6a0a);border-radius:11px;padding:6px 8px;box-shadow:inset 0 0 0 1px #ffcf6a40;font-size:12px;font-weight:700;line-height:1.25}
.l3m-obj .ic{color:var(--gold);flex:none}.l3m-obj .tx{flex:1;min-width:0}.l3m-obj .l3m-btn{flex:none}
.l3m-obj[data-k="tab"],.l3m-obj[data-k="lamp"],.l3m-obj[data-k="wear"]{background:linear-gradient(90deg,#ff8f8f2a,#ff8f8f0a);box-shadow:inset 0 0 0 1px #ff8f8f55}
.l3m-obj[data-k="claim"],.l3m-obj[data-k="sell"]{background:linear-gradient(90deg,#8fe39a26,#8fe39a0a);box-shadow:inset 0 0 0 1px #8fe39a55}
.l3m-lift{cursor:pointer;pointer-events:auto}.l3m-lift:hover .lb{color:var(--gold)}.l3m-lift .l3m-mini i{background:var(--gold)}.l3m-lift .l3m-mini.up i{background:#7fe8ff}
.l3m-ft{display:inline-flex;gap:5px}
.l3m-fund{position:relative;height:22px;border-radius:999px;background:#0008;overflow:hidden;margin:8px 0 4px;box-shadow:inset 0 0 0 1px #ffcf6a40}
.l3m-fund>i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#b8862a,#ffcf6a);transition:width .5s}
.l3m-fund.up>i{background:linear-gradient(90deg,#3a8aa8,#7fe8ff)}.l3m-fund.dr>i{background:linear-gradient(90deg,#6a4aa8,#c9a0ff)}
.l3m-fund span{position:relative;display:flex;justify-content:center;align-items:center;gap:4px;height:100%;font-weight:800;font-size:12px;text-shadow:0 1px 2px #000}
.l3m-fls{display:flex;flex-wrap:wrap;gap:6px}
.l3m-fl{pointer-events:auto;cursor:pointer;border:0;border-radius:12px;min-width:62px;padding:6px 8px;background:#ffffff12;box-shadow:0 0 0 1px var(--line);display:flex;flex-direction:column;align-items:center;gap:2px}
.l3m-fl b{font:400 18px/1 var(--num);color:var(--gold)}.l3m-fl small{font-size:10px;color:var(--mute)}
.l3m-fl:hover:not([disabled]){background:#ffcf6a2a}.l3m-fl.cur{background:#ffcf6a;box-shadow:0 2px 0 var(--goldd)}.l3m-fl.cur b,.l3m-fl.cur small{color:#2a1d18}.l3m-fl[disabled]{cursor:default}
.l3m-by{margin:8px 0 0;font-size:12px;color:var(--mute)}.l3m-by b{color:var(--ink)}.l3m-by b.me{color:var(--gold)}
.l3m-win>.l3m-btns:last-child{position:sticky;bottom:-16px;margin:8px -18px -16px;padding:10px 18px 12px;background:linear-gradient(#221a2800,#221a28 40%)}
.l3m-res{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:var(--c);box-shadow:0 0 0 1.5px #2a2236,0 0 6px var(--c);transform:rotate(45deg)}
.l3m-ore li b{font-size:13px}
.l3m-hon{display:flex;align-items:baseline;gap:8px;background:#ffcf6a1c;border-radius:12px;padding:8px 11px;margin:6px 0}.l3m-hon b{font:400 20px/1 var(--num);color:var(--gold)}.l3m-hon small{color:var(--mute)}
.l3m-c-quests h4{margin:12px 0 4px;font:700 13px/1.2 var(--hd);color:var(--gold)}
.l3m-c-quests ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.l3m-c-quests ol li{display:grid;grid-template-columns:22px 1fr auto;gap:6px;background:#ffffff0c;border-radius:9px;padding:4px 9px;font-size:12.5px}
.l3m-c-quests ol li span{color:var(--mute);font-weight:800}.l3m-c-quests ol li em{font-style:normal;font-weight:800}.l3m-c-quests ol li.me{box-shadow:0 0 0 1.5px var(--gold)}
.l3m-eye svg .x{display:none}.l3m-eye.off svg .x{display:inline}.l3m-eye.off{color:var(--dn)!important}
/* right of the floor map, above the chat dock (which grows up from the bottom-left) */
.l3m-coach{position:absolute;left:236px;top:124px;width:300px;padding:10px 12px 12px;pointer-events:auto}
.l3m-coach .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}.l3m-coach .hd b{font:700 14px/1.2 var(--hd);color:var(--gold)}
.l3m-coach .l3m-x{position:static;float:none;margin:0;width:24px;height:24px}
.l3m-coach ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:12.5px}
.l3m-coach li{display:flex;gap:8px;align-items:flex-start}.l3m-coach li .n{flex:none;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#ffffff14;font:800 11px/1 var(--tx);color:var(--gold);box-shadow:0 0 0 1px var(--line)}
.l3m-coach li.ok{opacity:.6}.l3m-coach li.ok .n{background:var(--up);color:#1d2a1e;box-shadow:none}.l3m-coach li.ok>span:last-child{text-decoration:line-through}
.l3m-dark .l3m-btn{flex:none}
@media (max-width:700px){.l3m-hud{width:224px}.l3m-jr{width:240px}.l3m-coach{display:none}}
.l3m-coach.flat{left:16px}
`;

export interface MineHudHandlers {
  stop(): void;
  toBuyer(): void;
  exit(): void;
  /** Card opened/closed (the room releases / restores pointer lock and gameplay keys). */
  modal(on: boolean): void;
  /** The journal drawer opened / closed (a modal: the cursor is needed for its tabs). */
  journal?(on: boolean): void;
  /** The mine chat input got / lost focus (the room turns gameplay keys off while typing). */
  typing?(on: boolean): void;
  /** «Шахта 3.0»: ride the lift to floor f (the room sends /api/mineRide and opens the floor). */
  ride?(f: number): void;
  /** Walk to the lift (shaft card «К лифту», the HUD lift row). */
  toLift?(): void;
  /** Walk to the supplier and open his card. */
  toSup?(): void;
  /** «Скрыть других игроков» changed. */
  hideOthers?(on: boolean): void;
  /** A UI sound (src/audio/defs.ts id). */
  sfx?(id: string): void;
}
export type CardKind = 'buy' | 'lamp' | 'quests' | 'news' | 'help' | 'top' | 'lift' | 'drill' | 'shaft' | 'bag' | null;
type JTab = 'log';
const LS_MIN = 'l3d.mineHudMin';
/** «Скрыть других игроков» (site lgMineHide; ours, the site's key is read once as the default). */
export const LS_HIDE = 'l3d.mineHide';
/** First-entry coach card dismissed. */
export const LS_COACH = 'l3d.mineCoach';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

/** Shared quest row for the «Поручения» card (site qcHtml): text, reward, own contribution vs threshold, participants, a bar. */
export function qcRowHtml(qc: QuestC): string {
  const need = Math.max(0, qc.min - qc.me), pct = Math.min(100, qc.p / Math.max(1, qc.g) * 100);
  return `<li class="qc${qc.done ? ' done' : ''}${qcReady(qc) ? ' ready' : ''}${qc.cl ? ' cl' : ''}"><span>${esc(qc.t)}<br><small class="l3m-mut">Награда +${qc.c} каждому, кто вложил от ${qc.min}. Твой вклад: ${qc.me}${qc.ok ? ' — хватает' : ` — ещё ${need}`}. Участников: ${qc.n || 0}</small></span>`
    + `<b>${qcStatus(qc)}</b><span class="l3m-mini"><i style="width:${pct.toFixed(1)}%"></i></span></li>`;
}
/** Compact shared-quest block of the HUD card. */
export function qcHudHtml(qc: QuestC): string {
  const pct = Math.min(100, qc.p / Math.max(1, qc.g) * 100), ready = qcReady(qc);
  return `<div class="l3m-sec l3m-qc${qc.done ? ' done' : ''}${ready ? ' ready' : ''}" title="${esc(`${qc.t}. Награда +${qc.c} каждому, кто вложил от ${qc.min}. Твой вклад: ${qc.me}. Участников: ${qc.n || 0}`)}">`
    + `<div class="l3m-k">Общее поручение недели<small>вклад ${qc.me} / ${qc.min}${qc.ok ? ' ✓' : ''}</small></div>`
    + `<div class="l3m-row" style="align-items:flex-start"><span class="l3m-mut">${esc(qc.t)}</span><b class="${ready ? 'rdy' : ''}" style="flex:none;white-space:nowrap">${qcStatus(qc)}</b></div>`
    + `<div class="l3m-mini"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
}
/** «Пока тебя не было» card body (site news()): stones, rare finds, ore into the hero's bag, pay for work. */
export function newsHtml(nw: MineNews, buyerOn: boolean, idle: boolean): string {
  const res = resList({ c: 0, r: nw.r || {}, p: nw.p || {} });
  return `<h3>Пока тебя не было</h3><ul class="l3m-list"><li><span>${TX_UNIT}</span><b>${nw.b || 0}${nw.f ? ` · редких находок: ${nw.f}` : ''}</b></li>`
    + (res.length ? `<li><span>${buyerOn ? 'В сумку героя' : 'В сумке'}</span><b>${res.map(([k, n, p]) => `${esc(resName(k))} ${esc(qty(n, p))}`).join('<br>')}</b></li>` : '')
    + `<li><span>${buyerOn ? 'Оплата за работу (уже в кошельке)' : 'Заработок (выдаст скупщик)'}</span><b>+${coinsFrac(nw.cx != null ? nw.cx : nw.c || 0)}</b></li></ul>`
    + `<p class="l3m-mut">${idle ? 'Герой выкопал свой камень и ждёт — выбери ему новый.' : 'Герой всё ещё копает свой камень.'}</p>`;
}
const TX_UNIT = 'Выкопано камней';

/** «Дальше: ① железо 26 ур. ② …» under the own stone (site fx.q queue); a hint when the queue is on but empty. */
export function queueHtml(on: boolean, queue: readonly number[], cells: { i: number; t: string; lv: number; r: string | null; a: number; k: 0 | 1 }[]): string {
  if (!on) return '';
  if (!queue.length) return `<p class="l3m-mut" style="margin-top:5px;font-size:11px"><span class="l3m-kc">Shift</span>+<span class="l3m-kc">E</span> по камню — в очередь (до 2): герой возьмёт его сам</p>`;
  return `<div class="l3m-q" title="Очередь хранит игра. Сбросить — «Стоп» или E по другому камню"><span class="lb">Дальше</span>${queue.map((i, k) => { const c = cells[i]; return c ? `<span class="nw"><i class="qn">${k + 1}</i>${esc(blockTitle(c))}</span>` : ''; }).join('')}</div>`;
}

/** Depth reward ladder of the week (site help(): weekCoinsAt defaults). */
export const WEEK_REWARDS: [number, number][] = [[10, 80], [20, 200], [30, 400], [40, 550], [60, 900]];
export interface HelpVars { lampFrom: number; darkFrom: number; cap: number; pick: boolean; q2: boolean; queue: boolean; n: number; /** «Шахта 3.0» big floor: lift and drill rigs. */ v3?: boolean }
/** «Как устроена шахта» — the site's HELP text (mine.js 26.10, lift / drills 30.10), with the 3D controls instead of clicks. */
export function helpParts(v: HelpVars): [string, string[]][] {
  const week = WEEK_REWARDS.map(([f, c]) => `${f}-й этаж — ${c}`).join(', ') + ' монет';
  const L = layerOf(v.n);
  return [
    ['Копать', [
      'Подойди к камню с жёлтым кругом, наведи прицел и нажми E — герой докопает его сам, даже если закроешь сайт. Следующий камень выбираешь ты.',
      ...(v.queue ? ['Очередь: пока герой копает, Shift+E по другому камню ставит его следующим (до 2). Сбросить — «Стоп» или E по другому камню.'] : []),
      'Копать можно только камни фронта — рядом с уже расчищенным местом.',
      'Вместе быстрее: на одном камне могут работать несколько героев. Добыча делится по вкладу — сколько работы вложил каждый.',
      'Число на камне — его уровень: чем выше, тем дольше копать. Табличка над камнем — оценка «≈»: сколько осталось, твоя доля, монет в час.',
    ]],
    ...(v.v3 ? [['Лифт и этажи', [
      'Этаж большой, дальше — туман: копай проходы, ищи жилы и шахту лифта. Карта этажа — слева сверху.',
      'Новый этаж открывает лифт. На самом глубоком этаже найдите шахту лифта и докопайтесь до неё.',
      'Потом все скидываются у лифта монетами или рудой (по цене скупщика, руда — в казну Ратуши); чем глубже, тем больше нужно.',
      'Собрали — лифт улучшается сам по таймеру, потом открывается следующий этаж. Копать в это время можно.',
      'Лифт возит на любой открытый этаж: подойди к нему, нажми E и выбери этаж. Там же — «В город».',
    ]], ['Буровые', [
      'Жилу выкопали на 70% — на ней площадка буровой. На этаже — не больше 2 буровых.',
      'Скиньтесь монетами или рудой (подойди к буровой, E) — она строится по таймеру, уровни 1–3. Строителям — бонус рудой жилы по вкладу.',
      'Буровая сама добывает руду жилы, пока та не иссякнет: 70% — в казну Ратуши, 30% — тем, кто копал в шахте за последний час.',
    ]]] as [string, string[]][] : []),
    ['Этажи', [
      v.v3 ? 'Чем глубже, тем выше уровень камней (копать дольше); в глубоких пластах — другая руда.' : 'Расчистили этаж — клеть наверху зала горит, шахта спускается на следующий этаж.',
      'Чем глубже, тем выше уровень камней (копать дольше); в глубоких пластах — другая руда.',
      `Каждые 5 этажей — новый пласт. Сейчас: «${L.name}» (этажи ${layerSpan(L)}).`,
      'В каждом десятке этажей один — угольный (какой — заранее не узнать): на нём кучи угля, а вокруг каждой — жила угольных камней.',
    ]],
    ['Добыча', [
      'Руда приходит осколками по вкладу: 100 осколков = 1 штука.',
      'Окаменевший сундук — осколки руды и монеты всем, кто его копал; может выпасть сфера или звезда — одному из копавших (шанс — по вкладу).',
      'Редкая жила светится — за неё ещё бонус монетами всем копавшим.',
      'Самоцвет у каждой шахты свой — по природе места.',
    ]],
    ['Скупщик', [
      'За работу у скупщика копятся монеты и руда в рудной сумке. Сдай сумку скупщику: монеты — тебе, руда — в казну Ратуши города. Кнопка «Скупщик» в карточке ведёт героя к прилавку; продаёшь только ты, кнопкой в окне.',
      'Поручения скупщика: каждый день — 3, каждую неделю — 2. Награду монетами забирай у скупщика.',
      ...(v.q2 ? ['«Наработай N» — вклад в любые камни (засчитывается сразу, и недокопанное); «Собери N осколков» — любая руда и порода, доля камня по сделанному; общее поручение шахты — всей шахтой за неделю, награда каждому, кто вложил не меньше порога.'] : []),
    ]],
    ...(v.pick ? [['Кирка и рудная сумка', [
      'У входа стоит Снабженец Кремень — торговец снаряжением для шахт: кирки, рудная сумка и «Каска шахтёра».',
      'Кирка — навсегда и только твоя. Лучше кирка — сильнее удар: медная +10%, железная +20%, стальная +35%, золотая +50%, адамантитовая +70%. Камни копаются быстрее, доля добычи по вкладу больше; оплата за время работы не меняется.',
      'Рудная сумка — тоже навсегда: руда кладётся в неё и не занимает места в сумке героя. Полна — руда идёт в обычную сумку, потом на склад.',
    ]] as [string, string[]]] : []),
    ['Темнота и каска', [
      v.pick ? 'Снабженец продаёт «Каску шахтёра» с любого этажа.' : `С ${v.lampFrom}-го этажа у входа стоит Фонарщик — продаёт «Каску шахтёра».`,
      `С ${v.darkFrom}-го этажа без надетой каски темно: камней не видно, копать нельзя.`,
    ]],
    ['Время', [
      v.cap > 0 ? `Копать можно до ${mmss(v.cap)} в сутки (на все шахты). Новые сутки — в 05:00 МСК.` : 'Время работы за сутки считается от 05:00 МСК.',
      'Неделя: каждую субботу в 18:00 МСК — новая шахта с 1-го этажа. Сумка, казна и мастерство остаются.',
      `Кто вложил за неделю хотя бы 1 час работы — награда за глубину: ${week}. С 30-го этажа ещё сфера, с 60-го — звезда.`,
    ]],
  ];
}
export function helpHtml(v: HelpVars): string {
  return `<h3>Как устроена шахта</h3><p class="l3m-mut">По правилам сайта на 30.10</p>`
    + helpParts(v).map(([h, li]) => `<h4>${esc(h)}</h4><ul>${li.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`).join('');
}
interface HistWeek { floor?: number; players?: number; top?: { l: string; u: number }[] }
/** «Итоги шахты» from the view we already have (site board(): st.top, st.hist[0], st.rec, st.working) — no request. */
export function topHtml(st: MineView, login: string): string {
  const me = String(login || '').toLowerCase();
  const row = (l: string, u: number, i: number) => `<li class="${String(l).toLowerCase() === me ? 'me' : ''}"><span>${i + 1}</span><b class="nw">${esc(String(l).toLowerCase() === me ? l + ' (ты)' : l)}</b><em>${esc(u)}</em></li>`;
  const h0 = (st.hist && (st.hist[0] as HistWeek)) || null;
  const title = st.name && st.id !== 'home' ? `Итоги шахты · ${st.name}` : 'Итоги шахты';
  return `<h3>${esc(title)}</h3><p class="l3m-mut">${stars(st.danger || 1)} · ${esc(BIO_RU[st.biome || ''] || '')}${st.gem ? ` · самоцвет — ${esc(resName(st.gem))}` : ''}</p>`
    + `<div class="l3m-sum"><div><b>${st.n}</b><span>этаж сейчас</span></div><div><b>${st.rec || st.n}</b><span>рекорд</span></div><div><b>${st.working || 0}</b><span>копают</span></div></div>`
    + `<h4>Лучшие копатели недели</h4><ol>${(st.top || []).map(([l, u], i) => row(l, u, i)).join('') || '<li><b class="l3m-mut">Пока никто не копал</b></li>'}</ol>`
    + (h0 ? `<h4>Прошлая неделя — до этажа ${esc(h0.floor)}, копателей: ${esc(h0.players)}</h4><ol>${(h0.top || []).slice(0, 5).map((x, i) => row(x.l, x.u, i)).join('')}</ol>` : '')
    + `<p class="l3m-mut" style="margin-top:8px">Вклад — сколько работы вложил герой. Каждую субботу в 18:00 — новая шахта.</p>`;
}

/** An ore heap that can go into a collection: uid, name, shards, price per piece (buyer's). */
export interface OreRow { uid: string; name: string; q: number; price: number; res?: string }
/**
 * «Руда из сумки» rows of a collection (site oreRows): «Отдать ≈N» — the first press turns the button into
 * «Точно отдать X шт.?» for THIS heap (8 s), the second press sends (OreAsk).
 */
export function oreRowsHtml(rows: OreRow[], ask: OreAsk, act: string, now: number, busy: boolean): string {
  if (!rows.length) return '';
  return '<div class="l3m-k" style="margin-top:8px">Руда из сумки</div><p class="l3m-mut">Руда уходит из твоей сумки в казну Ратуши — отдаётся вся кучка. Нажми «Отдать», потом подтверди.</p>'
    + `<ul class="l3m-list">${rows.map((r) => { const on = ask.asked(r.uid, now), q = qty(Math.floor(r.q / 100), r.q % 100);
      return `<li><span>${esc(r.name)}<br><small class="l3m-mut">${esc(q)}</small></span><button type="button" class="l3m-btn sm${on ? '' : ' ghost'}" data-a="${act}" data-uid="${esc(r.uid)}" data-q="${r.q}"${busy ? ' disabled' : ''}${on ? ` aria-label="Точно отдать ${esc(r.name)} ${esc(q)}?"` : ''}>${on ? `Точно отдать ${esc(pcs(r.q))} шт.?` : `Отдать ≈${coinsHtml(Math.floor(r.q * r.price / 100))}`}</button></li>`; }).join('')}</ul>`;
}
/** Collection block (site fundBlock): bar «c из need», coin buttons 100 / 500 / 1000 / «Весь остаток», ore rows. */
export function fundHtml(c: number, need: number, act: string, oreAct: string, rows: OreRow[], ask: OreAsk, now: number, busy: boolean, money: number): string {
  const p = need ? Math.min(100, c / need * 100) : 0;
  return `<div class="l3m-fund" role="progressbar" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${c}"><i style="width:${p.toFixed(1)}%"></i><span>${coinsHtml(c)} из ${coinsHtml(need)}</span></div>`
    + `<div class="l3m-btns">${fundButtons(c, need).map((b) => `<button type="button" class="l3m-btn sm${b.all ? '' : ' ghost'}" data-a="${act}" data-v="${b.v}"${busy || money < b.v ? ' disabled' : ''}${money < b.v ? ' title="Не хватает монет"' : ''}>${b.all ? 'Весь остаток ' : ''}${coinsHtml(b.v)}</button>`).join('')}</div>`
    + `<p class="l3m-mut">У тебя: ${coinsHtml(money)}</p>`
    + oreRowsHtml(rows, ask, oreAct, now, busy);
}
/** «Скинулись: a 15, b 6 и ещё N» — one line (site drillMenuHtml), own contribution marked. */
const byHtml = (by: [string, number][], me: string) => (by.length ? `<p class="l3m-by">Скинулись: ${by.slice(0, 4).map(([l, v]) => `<b class="${l.toLowerCase() === me ? 'me' : ''}">${esc(l)}</b> ${coinsHtml(v)}`).join(', ')}${by.length > 4 ? ` и ещё ${by.length - 4}` : ''}</p>` : '');

export interface FundCtx { rows: OreRow[]; ask: OreAsk; now: number; stAt: number; busy: boolean; money: number; me: string }
/**
 * «Шахта 3.0» lift card (site liftHtml + the bubble «В город» / «Этажи»): «В город», the open floors (ride: POST
 * /api/mineRide), the stage — dig (find the shaft) / fund (coins and ore: /api/mineLift) / up (timer), who chipped in.
 */
export function liftHtml(st: MineView, f: FundCtx): string {
  const I = liftInfo(st, f.stAt, f.now), deep = I.deep;
  const fl: string[] = []; for (let n = 1; n <= deep; n++) fl.push(`<button type="button" class="l3m-fl${n === st.n ? ' cur' : ''}" data-a="ride" data-f="${n}"${n === st.n ? ' aria-current="true" disabled' : f.busy ? ' disabled' : ''} title="${n === st.n ? 'Ты здесь' : `Поехать на этаж ${n}`}"><b>${n}</b><small>${n === st.n ? 'ты здесь' : n === deep ? 'самый глубокий' : 'этаж'}</small></button>`);
  let stage: string;
  if (I.st === 'fund') stage = `<p>Шахта лифта найдена! Скидываемся на этаж ${deep + 1} — монетами и рудой (руда — по цене скупщика, уходит в казну Ратуши). Потом лифт улучшается ${hmTxt(I.ms)}.</p>`
    + fundHtml(I.c, I.need, 'lfund', 'lore', f.rows, f.ask, f.now, f.busy, f.money);
  else if (I.st === 'up') stage = `<p>Собрали! Лифт улучшается: этаж ${deep + 1} откроется ${I.leftMs > 0 ? `через <b>${tmrTxt(I.leftMs)}</b>` : '<b>вот-вот</b>'}. Копать можно.</p>`
    + (I.ms > 0 ? `<div class="l3m-fund up"><i style="width:${Math.max(0, Math.min(100, (1 - I.leftMs / I.ms) * 100)).toFixed(1)}%"></i><span>улучшение лифта</span></div>` : '');
  else stage = `<p>Этаж ${deep + 1}: сначала докопайтесь до <b>шахты лифта</b> на этаже ${deep} — она далеко от лифта, под туманом (на карте этажа — оранжевая точка, когда найдёте). Потом — сбор ${coinsHtml(I.need)} и таймер ${hmTxt(I.ms)}.</p>`;
  return `<h3>Лифт</h3><p class="l3m-say">Ты на этаже <b>${st.n}</b>. Открыто этажей: ${deep}.</p>`
    + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="exit">В город ↑</button></div>`
    + `<div class="l3m-k" style="margin-top:10px">Этажи</div><div class="l3m-fls" role="group" aria-label="Этажи">${fl.join('')}</div>`
    + `<div class="l3m-k" style="margin-top:10px">Этаж ${deep + 1}</div>${stage}${byHtml(I.by, f.me)}`;
}
/** Drill rig card (site drillHtml / drillMenuHtml): stage, output, collection for the next level (/api/mineDrill), who chipped in. */
export function drillHtml(d: DrillInfo | null, f: FundCtx): string {
  if (!d) return '<h3>Буровая</h3><p>Буровой здесь нет.</p>';
  const v = (x: number) => String(Math.round(x * 10) / 10).replace('.', ','), nm = esc(resName(d.res));
  const head = d.stg === 'site' ? `<p>Жила «${nm}» почти выкопана — здесь можно поставить буровую. Она сама добывает руду жилы: 70% — в казну Ратуши, 30% — тем, кто копал в шахте за последний час. Строителям — бонус рудой.</p>`
    : d.stg === 'build' ? `<p>Стройка ур. ${d.lv + 1}: готово через <b>${hmTxt(drillLeft(d, f.stAt, f.now))}</b>.${d.lv ? ` Пока строится — добывает как ур. ${d.lv}.` : ''}</p>`
    : d.stg === 'dry' ? `<p>Жила иссякла — буровая добыла всё, что могла (${v(d.out)} шт.).</p>`
    : `<p>Буровая ур. ${d.lv}: ${v(d.rate)} шт./ч руды «${nm}». Добыто ${v(d.out)} из ${v(d.cap)} шт.</p>`;
  const prog = d.lv && d.stg !== 'dry' ? `<div class="l3m-fund dr"><i style="width:${d.cap ? Math.min(100, d.out / d.cap * 100).toFixed(1) : 0}%"></i><span>добыто ${v(d.out)} из ${v(d.cap)} шт.</span></div>` : '';
  const fund = drillFundable(d) ? `<div class="l3m-k" style="margin-top:10px">${d.lv ? `На ур. ${d.lv + 1}` : 'На постройку'}</div>${fundHtml(d.c, d.need, 'dfund', 'dore', f.rows, f.ask, f.now, f.busy, f.money)}` : '';
  return `<h3>Буровая · ${nm}${d.lv ? ` · ур. ${d.lv}` : ''}</h3>${head}${prog}${fund}${byHtml(d.by, f.me)}`;
}
/** «Шахта лифта» card (site liftMenu 'shaft'): it is not a way down — the lift is. */
export function shaftHtml(st: MineView): string {
  const deep = st.deep || st.n, L = st.lift || {};
  const t = st.n < deep ? 'Это шахта лифта — чтобы спуститься ниже, воспользуйся лифтом.'
    : L.st === 'fund' ? `Шахта лифта найдена! Скинуться на этаж ${deep + 1} можно у лифта в зале.`
    : L.st === 'up' ? `Шахта лифта готова — лифт улучшается, скоро этаж ${deep + 1}.` : 'Это шахта лифта — спуститься по ней нельзя, только лифтом.';
  return `<h3>Шахта лифта</h3><p>${t}</p><div class="l3m-btns"><button type="button" class="l3m-btn" data-a="tolift">К лифту</button></div>`;
}
/** «Доска почёта» tab of the board (site boardHtml 'hon'): my week, the week's top, last week. */
export function honHtml(st: MineView, wk: number, login: string): string {
  const me = String(login || '').toLowerCase(), top = st.top || [], k = top.findIndex(([l]) => String(l).toLowerCase() === me), h0 = (st.hist || [])[0] as any;
  const row = (l: string, u: number, i: number) => `<li class="${String(l).toLowerCase() === me ? 'me' : ''}"><span>${i + 1}</span><b>${esc(String(l).toLowerCase() === me ? l + ' (ты)' : l)}</b><em>${u}</em></li>`;
  return `<div class="l3m-hon"><span>Твой вклад за неделю</span><b>${wk || 0}</b>${k >= 0 ? `<small>${k + 1}-е место</small>` : ''}</div>`
    + `<h4>Лучшие копатели недели</h4><ol>${top.map(([l, u], i) => row(l, u, i)).join('') || '<li><b class="l3m-mut">Пока никто не копал</b></li>'}</ol>`
    + (h0 ? `<h4>Прошлая неделя — до этажа ${esc(h0.floor)}</h4><ol>${(h0.top || []).slice(0, 3).map((x: any, i: number) => row(x.l, x.u, i)).join('')}</ol>` : '')
    + '<p class="l3m-mut" style="margin-top:8px">Вклад — сколько работы вложил герой. Каждую субботу в 18:00 — новая шахта.</p>';
}
/** «Сумка» card: ore heaps with the buyer's price, the ore bag, the helmet; actions go to the buyer / supplier. */
export function bagHtml(o: { rows: OreRow[]; total: number; ob: { cap: number; used: number } | 0 | null; lamp: 'on' | 'bag' | 'none'; lampUid?: string; earn: number; buyerOn: boolean; wait: string }): string {
  const ore = o.rows.length
    ? `<ul class="l3m-list l3m-ore">${o.rows.map((r) => `<li><span><i class="l3m-res" style="--c:${resColor(r.res || '')}"></i>${esc(r.name)}<br><small class="l3m-mut">${esc(qty(Math.floor(r.q / 100), r.q % 100))} · ${r.price ? `${val(r.price)} за шт.` : 'скупщик не берёт'}</small></span><b>${r.price ? '≈ ' + coinsHtml(Math.floor(r.q * r.price / 100)) : '—'}</b></li>`).join('')}</ul>`
      + `<div class="l3m-offer"><span>Всё вместе у скупщика</span><b>≈ ${coinsHtml(o.total)}</b></div>`
    : '<p class="l3m-mut">Руды в сумке нет — накопай: из каждого камня выпадают осколки (100 осколков = 1 шт.).</p>';
  const ob = o.ob ? `<li><span>Рудная сумка</span><b>${o.ob.used} / ${o.ob.cap} ячеек</b></li>` : '<li><span>Рудная сумка</span><b class="l3m-mut">нет — у Снабженца</b></li>';
  const hat = `<li><span>Каска шахтёра</span><b class="${o.lamp === 'on' ? 'ok' : ''}">${o.lamp === 'on' ? 'надета' : o.lamp === 'bag' ? 'в сумке' : 'нет'}</b></li>`;
  return `<h3>Сумка шахтёра</h3><p class="l3m-mut">Руда — в сумке героя (100 осколков = 1 шт.), цены — скупщика.${o.buyerOn ? ` Оплата за работу уже в кошельке: ${coinsFrac(o.earn)}.` : ''}</p>${o.wait ? `<p class="l3m-lim">${esc(o.wait)}</p>` : ''}${ore}`
    + `<ul class="l3m-list">${ob}${hat}</ul>`
    + `<div class="l3m-btns">${o.rows.length && o.buyerOn ? '<button type="button" class="l3m-btn" data-a="buyer">К скупщику</button>' : ''}${o.lamp === 'bag' && o.lampUid ? `<button type="button" class="l3m-btn" data-a="wear" data-uid="${esc(o.lampUid)}">Надеть каску</button>` : ''}<button type="button" class="l3m-btn ghost" data-a="tosup">К Снабженцу</button></div>`
    + '<p class="l3m-mut" style="margin-top:6px">Вся сумка героя — клавиша <span class="l3m-kc">I</span></p>';
}
/** A stable tint per ore name (the bag rows' dot). */
const RES_TINT: Record<string, string> = { iron: '#b9c2cf', coal: '#6a6272', copper: '#d9824a', silver: '#e3e7ef', gold: '#f2c14e', crystal: '#9fe7ff', sulfur: '#e8e05a', obsidian: '#7a5aa8', limestone: '#e6dcc4', sandstone: '#e0b878', clay: '#c88a64', salt: '#f4f0ea', amber: '#ffb347', topaz: '#ffc35a', emerald: '#56d68a', ruby: '#ff5f7a', sapphire: '#5a8cff', malachite: '#3fbf8a', aquamarine: '#7fe8e0', fire_opal: '#ff7a3c', adamant: '#9ad0ff', morion: '#4a3a3a', runestone: '#b9a2ff' };
const resColor = (res: string) => RES_TINT[res] || '#c9a77e';
/** The objective line (what to do next) of the HUD card. */
export function objHtml(o: Objective): string {
  const btn = o.act === 'wear' ? 'Надеть' : o.act === 'buyer' ? 'К скупщику' : o.act === 'quests' ? 'Забрать' : o.act === 'lift' ? 'К лифту' : '';
  return `<div class="l3m-obj" data-k="${o.k}" role="status"><span class="ic" aria-hidden="true">➜</span><span class="tx">${esc(o.t)}</span>${btn ? `<button type="button" class="l3m-btn sm" data-a="obj" data-act="${o.act}">${btn}</button>` : ''}</div>`;
}

export class MineHud {
  readonly el: HTMLElement;
  private parts: Record<string, string> = {};
  private tipT = 0;
  card: CardKind = null;
  private supTab: 'pick' | 'bag' | 'lamp' = 'pick';
  private noUse = new Set<string>();
  private pops: { el: HTMLElement; x: number; y: number; z: number; t: number }[] = [];
  /** Card collapsed to its header line. */
  min = lsGet(LS_MIN) === '1';
  /** Journal drawer: closed / log. */
  jr: JTab | null = null;
  private typingOn = false;
  /** «Пока тебя не было»: shown once, in the first 15 s (site rules); the summary on screen. */
  private gate = new NewsGate();
  private newsNw: MineNews | null = null; private newsFocus = false;
  /** The idle hint shows for the first 90 s in the mine or until the first stone. */
  private born = Date.now(); private dug = false;
  /** Drill rig of the open «Буровая» card (site S.drillK). */
  drillK: string | null = null;
  /** Board tab: quests / honour board (site S.qTab). */
  boardTab: 'q' | 'hon' = 'q';
  /** «Отдать» ore in two presses (site oreAsk). */
  readonly ask = new OreAsk();
  /** Other miners hidden (site eye). */
  hide = (lsGet(LS_HIDE) ?? lsGet('lgMineHide')) === '1';
  /** First-entry coach: shown until «Понятно»; its steps tick off as they happen. */
  coach = lsGet(LS_COACH) !== '1';
  private coachSteps = { dig: false, sell: false, lift: false };
  constructor(host: HTMLElement, private client: MineClient, private h: MineHudHandlers) {
    this.el = document.createElement('div'); this.el.className = 'l3m'; this.el.setAttribute('aria-live', 'polite');
    setHtml(this.el, `<style>${CSS}</style>`
      + `<section class="l3m-box l3m-hud" data-p0="hud" aria-label="Шахта"><div data-p="hd"></div><div class="l3m-mbar" data-p="mbar"></div><div class="l3m-bd" data-p="bd"></div></section>`
      + `<section class="l3m-box l3m-jr" data-p0="jr" hidden aria-label="Журнал шахты"><div class="tabs" data-p="jtabs"></div><div class="body" data-p="jbody"></div></section>`
      + `<div class="l3m-other" data-p="other" hidden><span>Шахта открыта в другой вкладке — копать можно только в одной.</span><button type="button" class="l3m-btn sm" data-a="here">Копать здесь</button><button type="button" class="l3m-btn ghost sm" data-a="exit">В город</button></div>`
      + `<div class="l3m-dark" data-p="dark" hidden role="status"></div>`
      + `<section class="l3m-box l3m-coach" data-p="coach" hidden aria-label="Как начать"></section>`
      + `<div class="l3m-mm" data-p="mm" hidden aria-label="Карта этажа"></div>`
      + `<div class="l3m-tip" data-p="tip" hidden></div><div class="l3m-pops" data-p="pops"></div><div data-p="modal"></div>`);
    host.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t && t.dataset.use) { if (t.checked) this.noUse.delete(t.dataset.use); else this.noUse.add(t.dataset.use); this.render(); } });
    // the wheel over our panels scrolls them, not the camera
    this.el.addEventListener('wheel', (e) => { if ((e.target as HTMLElement).closest('.l3m-jr,.l3m-win')) e.stopPropagation(); }, { passive: true });
  }
  private q<T extends HTMLElement = HTMLElement>(p: string): T { return this.el.querySelector(`[data-p="${p}"]`) as T; }
  private q0<T extends HTMLElement = HTMLElement>(p: string): T { return this.el.querySelector(`[data-p0="${p}"]`) as T; }
  private set(p: string, html: string): void { if (this.parts[p] === html) return; this.parts[p] = html; setHtml(this.q(p), html); }
  get typing(): boolean { return this.typingOn; }

  tip(text: string, bad = false): void {
    const el = this.q('tip'); el.textContent = text; el.hidden = false; el.classList.toggle('bad', bad);
    clearTimeout(this.tipT); this.tipT = window.setTimeout(() => { el.hidden = true; }, 4200);
  }
  /** Floating text over a world point (room metres), projected each frame by update(). */
  popup(text: string, x: number, y: number, z: number): void {
    const el = document.createElement('div'); el.className = 'l3m-pop'; el.textContent = text;
    this.q('pops').appendChild(el); this.pops.push({ el, x, y, z, t: 0 });
  }
  /** Project popups: project(x,y,z) → [sx, sy] in CSS px or null (behind the camera). */
  update(dt: number, project: (x: number, y: number, z: number) => [number, number] | null): void {
    for (let k = this.pops.length - 1; k >= 0; k--) {
      const p = this.pops[k]; p.t += dt;
      const s = project(p.x, p.y + p.t * 0.6, p.z);
      if (s) { p.el.style.left = s[0].toFixed(0) + 'px'; p.el.style.top = s[1].toFixed(0) + 'px'; p.el.style.display = ''; } else p.el.style.display = 'none';
      p.el.style.opacity = String(Math.max(0, Math.min(1, 2.2 - p.t)));
      if (p.t > 2.4) { p.el.remove(); this.pops.splice(k, 1); }
    }
  }

  open(kind: CardKind): void {
    const was = !!this.card;
    if (kind !== this.card) { if (kind && kind !== 'news') this.h.sfx?.('ui.open'); else if (!kind && was) this.h.sfx?.('ui.close'); }
    if (kind === 'lift') this.coachTick('lift');
    if (kind !== 'lift' && kind !== 'drill') this.ask.clear();
    this.openCard(kind, was);
  }
  private openCard(kind: CardKind, was: boolean): void { this.card = kind; if (kind !== 'news') this.newsFocus = false; if (!!kind !== was) this.h.modal(!!kind); this.parts.modal = '\u0000'; this.render(); }   // sentinel: always redraw (closing too — '' would match the cleared slot and leave the card on screen)
  close(): void { this.open(null); }
  /** Collapse / expand the card. */
  toggleMin(on = !this.min): void { this.min = on; lsSet(LS_MIN, on ? '1' : '0'); this.render(); }
  /** Journal drawer ([L]): closed → log → (same key) closed; tab = open that tab. */
  journal(tab: JTab | null | 'toggle' = 'toggle'): void {
    const was = !!this.jr;
    this.jr = tab === 'toggle' ? (this.jr ? null : 'log') : tab;
    if (!!this.jr !== was) this.h.journal?.(!!this.jr);
    this.render();
  }
  /** New mine chat lines arrived: the bottom-left chat dock shows them (and the room draws bubbles over the miners); nothing to do here. */
  chatIn(_lines: ChatLine[]): void { /* the chat lives in the dock */ }

  /** Re-render from the client state (cheap: compares strings). */
  render(): void {
    const c = this.client, M = c.model, st = M.st; if (!st) return;
    const now = Date.now(), me = M.me || { i: -1, day: 0, cap: 480, bag: { c: 0, r: {} }, mx: { lv: 1, xp: 0, need: 60 }, wk: 0 };
    const left = (st.reset || 0) - now, dd = Math.floor(left / 864e5), hh = Math.floor((left % 864e5) / 36e5);
    const w = M.hw != null ? M.hw : st.working || 0, all = M.here != null ? Math.max(M.here, w) : w + (M.nOthers || 0);
    const hud = this.q0('hud'), jrOpen = !!this.jr;
    hud.hidden = jrOpen; hud.classList.toggle('min', this.min);
    // header: mine · floor · nature, counters, collapse
    const name = st.name && st.id !== 'home' ? `Шахта · ${st.name}` : 'Шахта';
    const eyeT = this.hide ? 'Показать других игроков' : 'Скрыть других игроков';
    this.set('hd', `<div class="l3m-hd" data-a="min" title="${this.min ? 'Развернуть' : 'Свернуть'}"><div class="g"><div class="l1"><span class="t" title="${esc(`Пласт «${layerOf(st.n).name}» (этажи ${layerSpan(layerOf(st.n))})`)}">⛏ ${esc(name)} · этаж ${st.n}${M.F && M.F.v3 && (st.deep || st.n) > st.n ? ` <small>из ${st.deep}</small>` : ''}</span>`
      + `<button type="button" class="l3m-tg" data-a="min" aria-label="${this.min ? 'Развернуть' : 'Свернуть'}" aria-expanded="${!this.min}">▾</button></div>`
      + `<div class="l2"><span class="s" title="${esc(weekResetTxt(st.reset, now) || (left > 0 ? `Новая шахта через ${dd ? dd + ' д ' : ''}${hh} ч` : ''))}">${stars(st.danger || 1)} ${esc(BIO_RU[st.biome || ''] || '')}`
      + ` · <span title="${M.hm ? `Были в шахте за последние ${M.hm} мин` : 'Сейчас в шахте'}">👥 ${all}</span> · <span title="Сейчас копают">⛏ ${w}</span></span>`
      + `<span class="ib"><button type="button" class="l3m-btn ghost sm l3m-hb l3m-eye${this.hide ? ' off' : ''}" data-a="hide" aria-pressed="${this.hide}" title="${eyeT}" aria-label="${eyeT}">${EYE_ICO}</button>`
      + `<button type="button" class="l3m-btn ghost sm l3m-hb" data-a="top" title="Итоги шахты: лучшие копатели недели" aria-label="Итоги шахты">🏆</button>`
      + `<button type="button" class="l3m-btn ghost sm l3m-hb" data-a="help" title="Как устроена шахта" aria-label="Как устроена шахта">?</button>`
      + `<button type="button" class="l3m-btn ghost sm l3m-jb" data-a="jr" title="Журнал шахты [L]"><span class="l3m-kc">L</span></button></span></div></div></div>`);
    // Сейчас
    const dig = M.myI >= 0 && M.F ? M.F.cells[M.myI] : null;
    const pr = dig ? stoneProgress(st, M.myI, now) : null, rem = pr ? 1 - pr.p : 1;
    const barCol = rem > 0.5 ? '#8fe39a' : rem > 0.2 ? '#ffcf6a' : '#ff8f6a';
    this.set('mbar', dig ? `<i style="width:${(rem * 100).toFixed(1)}%;background:${barCol}"></i>` : '');
    let nowH: string;
    if (dig) {
      nowH = `<div><div class="l3m-k">Сейчас<small>${pr && pr.n > 1 ? `копают: ${pr.n}` : ''}</small></div><p class="l3m-t">${TX.doing}: <b>${esc(blockTitle(dig))}</b></p>`
        + `<div class="l3m-bar"><i style="width:${(rem * 100).toFixed(1)}%;background:${barCol}"></i></div>`
        + `<div class="l3m-row"><span class="l3m-mut">${esc(leftTxt((pr ? pr.eta : 0) * 1000))}</span><button type="button" class="l3m-btn ghost sm" data-a="stop">Стоп</button></div>${queueHtml(c.queueOn, c.queue(), M.F ? M.F.cells : [])}</div>`;
    } else nowH = '';
    if (dig) { this.dug = true; this.coachTick('dig'); }
    if (c.buySaid) this.coachTick('sell');
    // Заработок
    const bag = me.bag || { c: 0, r: {} }, res = resList(bag);
    const ore = c.oreItems();
    const orePcs = ore.reduce((a, it) => a + (+it.q || 0), 0);
    const earnL = M.buyerOn ? `${coinsFrac(bag.cx != null ? bag.cx : bag.c)}<span class="l3m-mut" title="${esc(ore.map((it) => `${resName(it.res)} ${qty(Math.floor(it.q / 100), it.q % 100)}`).join(', ') || 'Руды в сумке нет')}"> · руда ${pcs(orePcs)}</span>`
      : `${coinsFrac(bag.c)}<span class="l3m-mut"> · ${res.length ? res.map(([k, n]) => `${esc(resName(k))} ${n}`).slice(0, 2).join(', ') : 'сумка пуста'}</span>`;
    const q = me.q || { d: [], w: [] }, qc = q.c || null;
    const canClaim = canClaimOf(q, c.claimed, now);
    // what to do next (fund.ts objective): one line with its own button; while digging only when something is more urgent
    const ob = objective({ st, me: M.me, myI: M.myI, dark: M.dark, lampHave: !!M.lampHave(), pickOn: M.pickOn, buyerOn: M.buyerOn, capFull: dayLimit(me, now).kind === 'full',
      canClaim, oreValue: c.priceOf(c.allLines()), v3: !!(M.F && M.F.v3), other: c.other, stAt: M.stAt, now });
    const objH = dig && ob.k === 'dig' ? '' : objHtml(ob);
    // «Шахта 3.0»: the lift's line (stage of the next floor) — a click walks to the lift
    let liftH = '';
    if (M.F && M.F.v3) {
      const I = liftInfo(st, M.stAt, now);
      const t = !I.onDeep ? `этажи 1–${I.deep} · ты на ${st.n}-м` : I.st === 'fund' ? `сбор на этаж ${I.deep + 1}: ${Math.floor(I.p)}%` : I.st === 'up' ? `этаж ${I.deep + 1} через ${I.leftMs > 0 ? tmrTxt(I.leftMs) : 'минуту'}` : `ищем шахту лифта для этажа ${I.deep + 1}`;
      const pct = I.st === 'fund' ? I.p : I.st === 'up' && I.ms ? Math.max(0, Math.min(100, (1 - I.leftMs / I.ms) * 100)) : 0;
      liftH = `<div class="l3m-sec l3m-lift" data-a="tolift" role="button" tabindex="0" title="Лифт в зале: этажи, сбор на новый этаж, выход в город — нажми, чтобы дойти"><div class="l3m-row"><span class="nw"><span class="lb">Лифт</span> ${esc(t)}</span><span class="l3m-mut">→</span></div>${I.st !== 'dig' && I.onDeep ? `<div class="l3m-mini ${I.st}"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}</div>`;
    }
    const earnH = `<div class="l3m-sec l3m-row" title="${M.buyerOn ? 'Оплата за работу — сразу в кошелёк; руду купит скупщик' : 'Всё выдаст скупщик'}"><span class="nw"><span class="lb">Доход</span> ${earnL}</span><button type="button" class="l3m-btn sm" data-a="buyer">${M.buyerOn ? 'Скупщик' : 'Сдать'}</button></div>`;
    const mxx = me.mx || { lv: 1, xp: 0, need: 60 }, dayP = me.cap ? Math.min(100, me.day / me.cap * 100) : 0;
    const lim = dayLimit(me, now);
    const limTitle = me.cap > 0 ? `Копать можно до ${hm(me.cap)} в сутки (на все шахты). Новые сутки в 05:00 МСК — через ${spanTxt(lim.resetIn)}` : 'Время работы за сутки считается от 05:00 МСК';
    const metH = `<div class="l3m-sec"><div class="l3m-meters"><div title="${esc(limTitle)}"><div class="lb">Сегодня</div><div class="v">${hm(me.day)}${me.cap > 0 ? ` <span class="l3m-mut">/ ${hm(me.cap)}</span>` : ''}</div>${me.cap > 0 ? `<div class="l3m-mini ${lim.kind}"><i style="width:${dayP.toFixed(1)}%"></i></div>` : ''}</div>`
      + `<div><div class="lb">${TX.mast}</div><div class="v">ур. ${mxx.lv}</div><div class="l3m-mini xp"><i style="width:${mxx.need ? Math.min(100, mxx.xp / mxx.need * 100).toFixed(1) : 100}%"></i></div></div></div>${lim.text ? `<div class="l3m-lim ${lim.kind}" role="status" title="${esc(limTitle)}">${esc(lim.text)}</div>` : ''}</div>`;
    const ftH = `<div class="l3m-row"><span class="l3m-mut">${canClaim ? '<b style="color:var(--gold)">Награда готова!</b>' : `Поручения: ${[...q.d, ...q.w].filter((x) => x.done).length} / ${q.d.length + q.w.length}`}</span><span class="l3m-ft"><button type="button" class="l3m-btn ghost sm" data-a="bag" title="Руда, рудная сумка, каска">Сумка</button><button type="button" class="l3m-btn ghost sm" data-a="quests">Поручения${canClaim ? ' <span class="l3m-dot">★</span>' : ''}</button></span></div>`;
    this.set('bd', objH + nowH + earnH + liftH + metH + (qc ? qcHudHtml(qc) : '') + ftH);
    // journal drawer
    const jr = this.q0('jr'); jr.hidden = !jrOpen;
    if (jrOpen) {
      this.set('jtabs', `<button type="button" role="tab" data-a="jtab" data-tab="log" aria-selected="true">Журнал</button>`
        + `<button type="button" class="x" data-a="jr" aria-label="Закрыть журнал" title="Закрыть [L]">✕</button>`);
      const lamp = M.lampOn() ? 'надета' : M.lampHave() ? 'в сумке' : 'нет';
      this.set('jbody', `<dl class="l3m-stats">`
        + `<div><dt>Вклад за неделю</dt><dd>${me.wk || 0}</dd></div>`
        + `<div><dt>Каска шахтёра</dt><dd class="${M.lampOn() ? 'ok' : ''}">${lamp}</dd></div>`
        + `<div><dt>${TX.mast}</dt><dd>ур. ${mxx.lv} <small class="l3m-mut">${mxx.xp} / ${mxx.need}</small></dd></div>`
        + `<div><dt>Сегодня</dt><dd>${mmss(me.day)}${me.cap > 0 ? ` <small class="l3m-mut">из ${mmss(me.cap)}</small>` : ''}</dd></div>`
        + (st.gem ? `<div style="grid-column:1/3"><dt>Самоцвет этих мест</dt><dd>${esc(resName(st.gem))}</dd></div>` : '')
        + (ore.length ? `<div style="grid-column:1/3"><dt>Руда в сумке</dt><dd>${ore.map((it) => `${esc(resName(it.res))} ${esc(qty(Math.floor(it.q / 100), it.q % 100))}`).join(', ')}</dd></div>` : '')
        + `</dl><p class="l3m-mut">💬 Чат шахты — внизу слева</p><div class="l3m-k">Журнал шахты</div><ul class="l3m-log">${(st.log || []).slice(0, 12).map((e) => `<li>${esc(e.t)}</li>`).join('') || '<li>Пока тихо</li>'}</ul>`);
    }
    this.q('other').hidden = !c.other;
    // site hatLine: the helmet is needed on this floor and not on — what to do about it, with its button
    {
      const need = st.n >= (st.darkFrom || 5) && !M.lampOn(), have = M.lampHave();
      const hat = !need ? '' : have ? `<span>Темно — нужна каска шахтёра. Она в сумке — надень её.</span><button type="button" class="l3m-btn sm" data-a="wear" data-uid="${esc(have.uid)}">Надеть</button>`
        : `<span>Темно — без каски с фонарём не видно, куда бить. Купи её у ${M.pickOn ? 'Снабженца' : 'Фонарщика'} в зале.</span><button type="button" class="l3m-btn sm" data-a="tosup">К ${M.pickOn ? 'Снабженцу' : 'Фонарщику'}</button>`;
      this.set('dark', hat); this.q('dark').hidden = !hat;
    }
    this.coachRender(!!(M.F && M.F.v3));
    // «Пока тебя не было»: the site's rules (first 15 s only; later silently marked read) live in NewsGate
    const nw = this.gate.tick(M.me, c.c, now, () => c.seen());
    if (nw) { this.newsNw = nw; this.open('news'); return; }
    this.renderModal();
  }

  /**
   * «Шахта 3.0» mini-map (site mine3.js minimap): dug / open cells light, seen rock grey, fog black; the lift, you, veins,
   * special halls, drill rigs and the lift shaft (only where the site shows them). Hidden on the classic floor. Redrawn only
   * when the view or the own cell changes (canvas, no per-frame work).
   */
  minimap(me: number): void {
    const el = this.q('mm'), M = this.client.model, F = M.F, st = M.st;
    if (!F || !F.v3 || !st || !F.vis) { if (!el.hidden) el.hidden = true; return; }
    const key = `${st.v}|${st.dug.length}|${st.fl ? st.fl.c.length : 0}|${me}|${st.n}|${(st.drills || []).length}`;
    if (this.mmKey === key && !el.hidden) return;
    this.mmKey = key; el.hidden = false;
    const w = F.w!, h = F.h!, k = Math.max(3, Math.min(7, Math.floor(200 / w)));
    let cv = el.querySelector('canvas') as HTMLCanvasElement | null;
    if (!cv) { setHtml(el, '<span class="cap">Карта этажа</span><canvas></canvas>'); cv = el.querySelector('canvas'); }
    if (!cv) return;
    if (cv.width !== w * k || cv.height !== h * k) { cv.width = w * k; cv.height = h * k; }
    const g = cv.getContext('2d'); if (!g) return;
    g.fillStyle = '#07060a'; g.fillRect(0, 0, w * k, h * k);
    for (let i = 0; i < w * h; i++) {
      const x = (i % w) * k, y = Math.floor(i / w) * k;
      if (M.dug[i] || (F.vis[i] && (F.cells[i].t === 'lift' || F.cells[i].t === 'void' || F.cells[i].t === 'shaft'))) g.fillStyle = '#c9a77e';
      else if (F.vis[i]) g.fillStyle = '#3a3442'; else continue;
      g.fillRect(x, y, k, k);
    }
    const dot = (i: number | undefined, c: string, r: number) => { if (i == null || i < 0) return; g.beginPath(); g.arc((i % w) * k + k / 2, Math.floor(i / w) * k + k / 2, r, 0, Math.PI * 2); g.fillStyle = c; g.fill(); g.lineWidth = 1; g.strokeStyle = '#000'; g.stroke(); };
    for (const v of F.veins || []) dot(v[2] >= 0 ? v[2] : (v[3] || [])[0], '#ffd27a', k);
    for (const hl of F.halls || []) dot(+hl[2], '#7fe8ff', k);
    for (const i of (F.drills || new Map()).keys()) dot(i, '#c9a0ff', k * 1.1);
    if (F.shaft != null && F.shaft >= 0 && F.vis[F.shaft]) dot(F.shaft, '#ff9a3c', k * 1.3);
    dot(F.lift, '#9fe39a', k * 1.4);
    if (me >= 0) dot(me, '#ff5f8a', k * 1.1);
  }
  private mmKey = '';

  /* ---------------------------------------------------------------- cards */
  private renderModal(): void {
    if (!this.card) { this.set('modal', ''); return; }
    if (this.card === 'news' && this.newsNw) {
      const M = this.client.model;
      this.set('modal', `<div class="l3m-modal l3m-news" data-a="bg"><div class="l3m-win" role="dialog" aria-modal="true" aria-label="Пока тебя не было">${newsHtml(this.newsNw, M.buyerOn, M.myI < 0)}<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="news-ok">Понятно</button></div></div></div>`);
      const ok = this.el.querySelector('[data-a="news-ok"]') as HTMLElement | null; if (ok && !this.newsFocus) { this.newsFocus = true; try { ok.focus({ preventScroll: true }); } catch { /* */ } }
      return;
    }
    if (this.card === 'help' || this.card === 'top') {
      const M = this.client.model, st = M.st!, me = M.me;
      const body = this.card === 'help'
        ? helpHtml({ lampFrom: st.lampFrom || 4, darkFrom: st.darkFrom || 5, cap: (me && +me.cap) || 0, pick: M.pickOn, q2: !!(me && me.q && me.q.c), queue: this.client.queueOn, n: st.n, v3: !!(M.F && M.F.v3) })
        : topHtml(st, this.client.login);
      const lbl = this.card === 'help' ? 'Как устроена шахта' : 'Итоги шахты';
      this.set('modal', `<div class="l3m-modal" data-a="bg"><div class="l3m-win l3m-${this.card}" role="dialog" aria-modal="true" aria-label="${lbl}"><button type="button" class="l3m-x" data-a="back" aria-label="Закрыть" title="Закрыть [Esc]">✕</button>${body}<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="back">Понятно</button></div></div></div>`);
      return;
    }
    const M = this.client.model, st = M.st!, k = this.card;
    const body = k === 'buy' ? this.buyerHtml() : k === 'lamp' ? this.supHtml() : k === 'lift' ? liftHtml(st, this.fundCtx())
      : k === 'drill' ? drillHtml(drillsOf(st).find((d) => d.k === this.drillK) || null, this.fundCtx()) : k === 'shaft' ? shaftHtml(st) : k === 'bag' ? this.bagCard() : this.questsHtml();
    const lbl = k === 'buy' ? TX.seller : k === 'lamp' ? (M.pickOn ? TX.sup : TX.lampNpc) : k === 'lift' ? 'Лифт' : k === 'drill' ? 'Буровая' : k === 'shaft' ? 'Шахта лифта' : k === 'bag' ? 'Сумка шахтёра' : 'Доска поручений';
    this.set('modal', `<div class="l3m-modal" data-a="bg"><div class="l3m-win l3m-c-${k}" role="dialog" aria-modal="true" aria-label="${esc(lbl)}"><button type="button" class="l3m-x" data-a="back" aria-label="Закрыть" title="Закрыть [Esc]">✕</button>${body}<div class="l3m-btns"><button type="button" class="l3m-btn ghost" data-a="back">Назад <span class="l3m-kc">Esc</span></button></div></div></div>`);
  }
  private buyerHtml(): string {
    const c = this.client, M = c.model, st = M.st!;
    if (!M.buyerOn) {
      const me = M.me, res = resList((me && me.bag) || undefined);
      return `<h3>${TX.seller}</h3><p class="l3m-say">«${esc(TX.hello)}»</p>${res.length ? `<ul class="l3m-list">${res.map(([k, n, p]) => `<li><span>${esc(resName(k))}</span><b>${esc(qty(n, p))}</b></li>`).join('')}</ul>` : `<p class="l3m-mut">${TX.bagEmpty}</p>`}`
        + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="sell">Сдать всё</button></div>`;
    }
    const P = st.bp || {}, its = c.oreItems(), price = c.priceOf(c.allLines()), wait = !!c.buyWait;
    const thx = c.buySaid && Date.now() - c.buySaid.at < 120000 ? c.buySaid : null;
    const say = thx ? esc(thx.t).replace(/\{coins\}/g, String(thx.c)) : !its.length ? 'Клади руду на прилавок — скажу, сколько дам.' : price > 0 ? `Дам за всё ${price}.` : 'За это и медяка не дам — добавь ещё.';
    return `<h3>${TX.seller}</h3><p class="l3m-say">«${say}»</p>`
      + (its.length ? `<ul class="l3m-list">${its.map((it) => `<li><span>${esc(it.name || resName(it.res))}<br><small class="l3m-mut">${esc(qty(Math.floor(it.q / 100), it.q % 100))}</small></span><b>≈ ${val(it.q * (+P[it.res] || 0) / 100)}</b></li>`).join('')}</ul>` : '<p class="l3m-mut">Руды в сумке нет — накопай в шахте или забери со склада.</p>')
      + `<div class="l3m-offer"><span>Скупщик даст</span><b>${coinsHtml(price)}</b></div>`
      + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="sell"${!(price > 0) || wait ? ' disabled' : ''}>${wait ? 'Скупщик считает…' : 'Сдать скупщику'}</button></div>`
      + `<p class="l3m-mut">Купленное скупщик отправит в казну Ратуши — на развитие города.</p>`;
  }
  private questsHtml(): string {
    const c = this.client, M = c.model, me = M.me, q = (me && me.q) || { d: [], w: [] };
    const li = (x: Quest) => `<li class="${x.done ? 'done' : ''}${x.cl ? ' cl' : ''}"><span>${esc(x.t)}${x.h ? `<br><small class="l3m-mut">Где: ${esc(x.h)}</small>` : ''}</span><b>${x.cl ? 'получено' : x.done ? 'готово' : `${x.p} / ${x.g}`} · +${x.c}</b></li>`;
    const canClaim = canClaimOf(q, c.claimed, Date.now());
    const tabs = `<div class="l3m-tabs" role="tablist" aria-label="Доска">${([['q', 'Поручения'], ['hon', 'Доска почёта']] as const).map(([k, t]) => `<button type="button" role="tab" class="l3m-btn ghost sm" data-a="btab" data-tab="${k}" aria-selected="${this.boardTab === k}">${t}</button>`).join('')}</div>`;
    if (this.boardTab === 'hon') return `<h3>Доска почёта</h3>${tabs}${honHtml(M.st!, (me && me.wk) || 0, c.login)}`;
    return `<h3>Поручения скупщика</h3>${tabs}<p class="l3m-mut">Награду выдаёт ${TX.seller} — кнопка «Забрать награду», когда поручение готово.</p>`
      + `<div class="l3m-k" style="margin-top:8px">Поручения на сегодня</div><ul class="l3m-list">${q.d.map(li).join('') || '<li>Нет</li>'}</ul>`
      + `<div class="l3m-k">Поручения недели</div><ul class="l3m-list">${q.w.map(li).join('') || '<li>Нет</li>'}</ul>`
      + (q.c ? `<div class="l3m-k">Общее поручение шахты</div><ul class="l3m-list">${qcRowHtml(q.c)}</ul>` : '')
      + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="claim"${canClaim && !c.busyOp ? '' : ' disabled'}>Забрать награду</button></div>`;
  }
  private supHtml(): string {
    const c = this.client, M = c.model, st = M.st!;
    const lampBody = () => M.lampOn() ? '<p>«Каска шахтёра» на тебе — фонарь светит на любом этаже.</p>'
      : !M.lampHave() && c.lampBought && Date.now() - c.lampBought < 60000 ? '<p>Каска куплена — несу в сумку, через пару секунд появится.</p>'
      : M.lampHave() ? `<p>«Каска шахтёра» у тебя в сумке — надень её, и фонарь загорится.</p><div class="l3m-btns"><button type="button" class="l3m-btn" data-a="wear" data-uid="${esc(M.lampHave()!.uid)}">Надеть каску</button></div>`
      : `<p>С ${st.darkFrom || 5}-го этажа без света ничего не видно и копать нельзя. «Каска шахтёра» — обычная вещь в сумку: надел — светит.</p><div class="l3m-btns"><button type="button" class="l3m-btn" data-a="lamp"${c.busyOp ? ' disabled' : ''}>Купить каску${st.lampPrice ? ` · ${st.lampPrice}` : ''}</button></div>`;
    if (!M.pickOn) return `<h3>${TX.lampNpc}</h3>${lampBody()}`;
    const x = M.me && M.me.pkx, mx = (M.me && M.me.mx) || { lv: 1, xp: 0, need: 0 }, money = c.heroMoney();
    const tab = this.supTab, wait = !!c.supWait;
    const tabs = `<div class="l3m-tabs" role="tablist">${([['pick', 'Кирка'], ['bag', 'Рудная сумка'], ['lamp', 'Каска']] as const).map(([k, t]) => `<button type="button" role="tab" class="l3m-btn ghost sm" data-a="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`).join('')}</div>`;
    const say = c.supSay && Date.now() - c.supSay.at < 60000 ? c.supSay.t : 'Снаряжение для шахты: кирки, рудные сумки, каски. Хорошая кирка — полдела.';
    let body = '';
    if (tab === 'pick') {
      if (!x) body = '<p class="l3m-mut">Снабженец раскладывает товар — загляни через пару секунд.</p>';
      else {
        const T = x.t || [], lv = x.lv, nx = lv + 1 < T.length ? lv + 1 : -1, cur = T[lv] || ['Кирка', 1];
        body = `<p>Твоя кирка: <b>${esc(cur[0])}</b> · сила удара ×${val(+cur[1])}</p>`;
        if (nx < 0) body += '<p>Лучше кирки не бывает — у тебя адамантитовая.</p>';
        else {
          const N = T[nx], hv = this.oreHave(), reqs: string[] = []; let ok = true;
          const mOk = (mx.lv || 1) >= N[2]; ok = ok && mOk;
          reqs.push(`<li class="${mOk ? 'ok' : 'no'}"><span>Горное дело</span><b>ур. ${mx.lv || 1} / ${N[2]}</b></li>`);
          const cOk = money >= N[3]; ok = ok && cOk;
          if (N[3] > 0) reqs.push(`<li class="${cOk ? 'ok' : 'no'}"><span>Монеты</span><b>${coinsHtml(money)} / ${coinsHtml(N[3])}</b></li>`);
          const opt = N[5] || {}, can = Object.keys(opt).filter((r) => (hv[r] || 0) > 0), use = can.filter((r) => !this.noUse.has(r)), pay = pickPay(N[4] || {}, opt, hv, use);
          for (const [r, need] of Object.entries(pay.s)) { const got = hv[r] || 0, o2 = got >= need; ok = ok && o2; reqs.push(`<li class="${o2 ? 'ok' : 'no'}"><span>${esc(resName(r))}${pay.used[r] ? ' <small>(скидка)</small>' : ''}</span><b>${pcs(got)} / ${pcs(need)}</b></li>`); }
          body += `<div class="l3m-k">Следующая: ${esc(N[0])} <small>+${Math.round((N[1] - 1) * 100)}% к силе удара</small></div><ul class="l3m-list">${reqs.join('')}</ul>`
            + (can.length ? `<div class="l3m-k">Можно дешевле</div>${can.map((r) => `<label class="l3m-row" style="justify-content:flex-start"><input type="checkbox" data-use="${esc(r)}"${use.includes(r) ? ' checked' : ''}${wait ? ' disabled' : ''}> ${esc(resName(r))}: 1 шт. вместо ${val(+opt[r][1])} шт. ${esc(resName(opt[r][0]))}</label>`).join('')}` : '')
            + `<p class="l3m-mut">Руда — из сумки героя (и рудной сумки), 100 осколков = 1 шт.</p>`
            + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="pick" data-to="${nx}" data-use2="${esc(use.join(','))}"${!ok || wait ? ' disabled' : ''}>${wait ? 'Снабженец работает…' : 'Улучшить'}</button></div>`;
        }
      }
    } else if (tab === 'bag') {
      const ob = x && x.ob;
      if (ob) body = `<p>Рудная сумка у тебя: <b>${ob.used} / ${ob.cap}</b> ячеек. Новая руда кладётся в неё и не занимает места в сумке героя.</p>`;
      else if (x) {
        const mOk = (mx.lv || 1) >= x.obL, cOk = money >= x.obP;
        body = `<p><b>Рудная сумка</b> — ${x.obC} ячеек для руды, навсегда и только твоя.</p><ul class="l3m-list"><li class="${mOk ? 'ok' : 'no'}"><span>Горное дело</span><b>ур. ${mx.lv || 1} / ${x.obL}</b></li>${x.obP > 0 ? `<li class="${cOk ? 'ok' : 'no'}"><span>Монеты</span><b>${coinsHtml(money)} / ${coinsHtml(x.obP)}</b></li>` : ''}</ul>`
          + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="orebag"${!mOk || !cOk || wait ? ' disabled' : ''}>${wait ? 'Снабженец работает…' : 'Купить'}</button></div>`;
      } else body = '<p class="l3m-mut">Снабженец раскладывает товар — загляни через пару секунд.</p>';
    } else body = lampBody();
    return `<h3>${TX.sup}</h3><p class="l3m-mut">Торговец снаряжением</p><p class="l3m-say">«${esc(say)}»</p>${tabs}${body}`;
  }
  /** Ore rows of a collection and the rest of the collection context (lift / drill cards). */
  private fundCtx() {
    const c = this.client, M = c.model, P = (M.st && M.st.bp) || {};
    const rows: OreRow[] = c.fundOre(8).map((it) => ({ uid: String(it.uid), name: String(it.name || resName(it.res)), q: +it.q || 0, price: +P[it.res] || 0 }));
    return { rows, ask: this.ask, now: Date.now(), stAt: M.stAt, busy: c.busyOp, money: c.heroMoney(), me: c.login };
  }
  private bagCard(): string {
    const c = this.client, M = c.model, P = (M.st && M.st.bp) || {}, now = Date.now();
    const rows: OreRow[] = c.oreItems().filter((it) => !c.oreGone.has(it.uid, now)).map((it) => ({ uid: String(it.uid), name: String(it.name || resName(it.res)), q: +it.q || 0, price: +P[it.res] || 0, res: String(it.res || '') }));
    const me = M.me, bag = (me && me.bag) || { c: 0, r: {} }, res = resList(bag);
    const wait = res.length && M.buyerOn ? `Сумка и склад полны — ждёт в шахте: ${res.map(([k, n, p]) => `${resName(k)} ${qty(n, p)}`).join(', ')}. Освободи место — перенесём сами.` : '';
    const have = M.lampHave();
    return bagHtml({ rows, total: c.priceOf(c.allLines()), ob: (me && me.pkx) ? me.pkx.ob : null, lamp: M.lampOn() ? 'on' : have ? 'bag' : 'none', lampUid: have ? have.uid : undefined, earn: bag.cx != null ? bag.cx : bag.c, buyerOn: M.buyerOn, wait });
  }
  /** Open a drill rig's card. */
  openDrill(k: string): void { this.drillK = k; this.ask.clear(); this.open('drill'); }
  /** Coach step happened (dig / sell / lift). */
  coachTick(k: 'dig' | 'sell' | 'lift'): void { if (!this.coach || this.coachSteps[k]) return; this.coachSteps[k] = true; this.h.sfx?.('ui.tick'); }
  private coachRender(v3: boolean): void {
    const el = this.q('coach');
    const show = this.coach && !this.card && !this.jr && !this.client.other;
    if (!show) { if (!el.hidden) el.hidden = true; return; }
    const S = this.coachSteps, li = (on: boolean, n: number, t: string) => `<li class="${on ? 'ok' : ''}"><span class="n">${on ? '✓' : n}</span><span>${t}</span></li>`;
    this.set('coach', `<div class="hd"><b>Как начать</b><button type="button" class="l3m-x" data-a="coach-x" aria-label="Скрыть подсказку" title="Скрыть">✕</button></div><ol>`
      + li(S.dig, 1, 'Подойди к камню с <b>жёлтым кругом</b> и нажми <span class="l3m-kc">E</span> — герой копает сам, даже если закрыть сайт.')
      + li(S.sell, 2, 'Руда падает в сумку — продай её <b>Скупщику Грому</b> у прилавка в зале.')
      + (v3 ? li(S.lift, 3, 'В тумане — жилы и <b>шахта лифта</b>. Нашли её — вся шахта скидывается у <b>лифта</b> на новый этаж.') : li(S.lift, 3, 'Лифт в зале — дорога в город.'))
      + `</ol><div class="l3m-btns"><button type="button" class="l3m-btn sm" data-a="coach-x">Понятно</button><button type="button" class="l3m-btn ghost sm" data-a="help">Как устроена шахта</button></div>`);
    el.classList.toggle('flat', !v3); el.hidden = false;
  }
  private oreHave(): Record<string, number> { const o: Record<string, number> = {}; for (const it of this.client.oreItems()) o[it.res] = (o[it.res] || 0) + (+it.q || 0); return o; }

  private onClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!t) return;
    const a = t.dataset.a, c = this.client;
    if ((t as HTMLButtonElement).disabled) return;
    if (a === 'bg') { if (e.target === t) { if (this.card === 'news') this.newsOk(); else this.close(); } return; }
    e.stopPropagation();
    switch (a) {
      case 'stop': (t as HTMLButtonElement).disabled = true; this.h.stop(); break;
      case 'buyer': if (this.card === 'bag') this.close(); this.h.toBuyer(); break;
      case 'quests': this.open('quests'); break;
      case 'help': this.open('help'); break;
      case 'top': this.open('top'); break;
      case 'min': this.toggleMin(); break;
      case 'jr': this.journal('toggle'); break;
      case 'jtab': this.journal((t.dataset.tab as JTab) || 'log'); break;
      case 'back': this.close(); break;
      case 'exit': this.close(); this.h.exit(); break;
      case 'here': c.takeOver(); break;
      case 'sell': void c.sell().then(() => this.render()); this.render(); break;
      case 'claim': void c.claim().then((ok) => { if (ok) markQcClaimed(c.model.me && c.model.me.q); this.render(); }); break;
      case 'news-ok': this.newsOk(); break;
      case 'lamp': void c.lamp().then(() => this.render()); break;
      case 'wear': void c.wear(t.dataset.uid || '').then(() => this.render()); break;
      case 'tab': this.supTab = (t.dataset.tab as 'pick') || 'pick'; this.render(); break;
      case 'pick': void c.pick(+(t.dataset.to || 0), (t.dataset.use2 || '').split(',').filter(Boolean)).then(() => this.render()); this.render(); break;
      case 'orebag': void c.oreBag().then(() => this.render()); this.render(); break;
      case 'hide': this.hide = !this.hide; lsSet(LS_HIDE, this.hide ? '1' : '0'); this.h.hideOthers?.(this.hide); this.h.sfx?.('ui.tick'); this.render(); break;
      case 'bag': this.open(this.card === 'bag' ? null : 'bag'); break;
      case 'btab': this.boardTab = t.dataset.tab === 'hon' ? 'hon' : 'q'; this.render(); break;
      case 'tolift': this.close(); this.h.toLift?.(); break;
      case 'tosup': this.close(); this.h.toSup?.(); break;
      case 'ride': { const f = +(t.dataset.f || 0); if (f > 0) this.h.ride?.(f); break; }
      case 'lfund': void c.liftFund(+(t.dataset.v || 0)).then((ok) => { if (ok) this.h.sfx?.('mine.chest'); this.render(); }); this.render(); break;
      case 'dfund': { const k = this.drillK; if (k) { void c.drillFund(k, +(t.dataset.v || 0)).then((ok) => { if (ok) this.h.sfx?.('mine.chest'); this.render(); }); this.render(); } break; }
      case 'lore': case 'dore': {
        const uid = t.dataset.uid || '', q = +(t.dataset.q || 0), k = this.drillK;
        const r = this.ask.press(uid, Date.now());
        if (r === 'send') {
          const ln: [string, number][] = [[uid, q]];
          void (a === 'lore' ? c.liftFund(0, ln) : k ? c.drillFund(k, 0, ln) : Promise.resolve(false)).then((ok) => { if (ok) this.h.sfx?.('mine.chest'); this.render(); });
        } else if (r === 'ask') this.h.sfx?.('ui.tick');
        this.render(); break;
      }
      case 'obj': { const act = t.dataset.act; if (act === 'buyer') this.h.toBuyer(); else if (act === 'quests') this.open('quests'); else if (act === 'lift') this.h.toLift?.(); else if (act === 'wear') { const hv = c.model.lampHave(); if (hv) void c.wear(hv.uid).then(() => this.render()); } break; }
      case 'coach-x': this.coach = false; lsSet(LS_COACH, '1'); this.render(); break;
    }
  }
  /** «Понятно» (button or backdrop, like the site): close the window and send the one /api/mineSeen. */
  private newsOk(): void {
    const nw = this.newsNw; this.newsNw = null; this.newsFocus = false;
    if (nw) this.gate.ack(nw, this.client.c, () => this.client.seen());
    this.close();
  }
  dispose(): void { clearTimeout(this.tipT); if (this.card) this.h.modal(false); if (this.jr) this.h.journal?.(false); this.el.remove(); }
}

/** Price with discounts — as minecore.pickPay (the game computes the same). */
export function pickPay(s: Record<string, number>, opt: Record<string, [string, number]>, have: Record<string, number>, use: string[]) {
  const out: Record<string, number> = { ...(s || {}) }, used: Record<string, number> = {};
  for (const [r, a] of Object.entries(opt || {})) {
    if (!use.includes(r)) continue;
    const t = a[0], k = +a[1] || 1, need = out[t] || 0, u = Math.min(Math.max(0, Math.floor(+have[r] || 0)), Math.ceil(need / k));
    if (!(u > 0)) continue;
    out[t] = Math.max(0, need - u * k); if (!out[t]) delete out[t]; out[r] = (out[r] || 0) + u; used[r] = u;
  }
  return { s: out, used };
}
