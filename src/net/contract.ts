/**
 * Runtime half of the site contract (src/data/site-contract.json; the static half is scripts/drift.mjs).
 * Checks what the extension really calls on the live page — globals, the keys of `window.LGCity`, DOM hooks of the
 * City — instead of searching the scripts' text (a key inside a `//` comment is text, not a method: 27.10 `where`).
 *   phase 'page': right after the page loaded (globals of the main scripts);
 *   phase 'city': the City tab is open and its client is up (LGCity.debug() answers): + LGCity keys, City DOM.
 * Checks with `when: 'lazy'` (scripts the site loads on demand: camp, district towns, mine) are verified only when
 * the global exists. Pure (window/document passed in) — test/contract-runtime.test.ts.
 */
export interface ContractCheck {
  id: string;
  /** 'keys' (obj + keys), 'global' (name [+ keys]), 'dom' (sel) or a plain static regex check (re only). */
  kind?: 'keys' | 'global' | 'dom';
  obj?: string; name?: string; keys?: string[];
  /** Type every key must have at runtime ('function' by default for 'keys', any defined value for 'global'). */
  type?: 'function' | 'any';
  sel?: string;
  file?: string; re?: string;
  when?: 'page' | 'city' | 'lazy';
  severity: 'break' | 'degrade';
  why?: string;
}
export interface ContractFail { id: string; severity: 'break' | 'degrade'; missing: string[]; why?: string }

const PHASES = { page: 0, city: 1 } as const;

/** Which checks fail on this page now. Plain regex checks (no runtime meaning) are skipped. */
export function runtimeContract(checks: readonly ContractCheck[], win: any, doc: Pick<Document, 'querySelector'>, phase: 'page' | 'city'): ContractFail[] {
  const out: ContractFail[] = [];
  const due = (c: ContractCheck) => c.when === 'lazy' || PHASES[(c.when || 'city') as 'page' | 'city'] <= PHASES[phase];
  for (const c of checks) {
    if (!c.kind || !due(c)) continue;
    const missing: string[] = [];
    if (c.kind === 'keys' || c.kind === 'global') {
      const name = (c.kind === 'keys' ? c.obj : c.name) || '';
      let o: any;
      try { o = win[name]; } catch { o = undefined; }
      if (o === undefined || o === null) {
        if (c.when === 'lazy') continue;   // not loaded on this page (yet)
        missing.push(name);
      } else {
        const fn = c.type ? c.type === 'function' : c.kind === 'keys';
        for (const k of c.keys || []) {
          let v: unknown;
          try { v = o[k]; } catch { v = undefined; }
          if (fn ? typeof v !== 'function' : v === undefined) missing.push(name + '.' + k);
        }
      }
    } else if (c.kind === 'dom' && c.sel) {
      try { if (!doc.querySelector(c.sel)) missing.push(c.sel); } catch { missing.push(c.sel); }
    }
    if (missing.length) out.push({ id: c.id, severity: c.severity, missing, why: c.why });
  }
  return out;
}

/** One line per failure, for the console / splash details. */
export const describeFails = (f: readonly ContractFail[]): string[] => f.map((x) => `${x.severity === 'break' ? 'BREAK' : 'degrade'} ${x.id}: ${x.missing.join(', ')}`);
