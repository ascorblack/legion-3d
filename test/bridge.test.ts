import { describe, it, expect, beforeAll } from 'vitest';

/* Minimal page environment: the bridge only touches window.EventSource and window.fetch. */
class FakeES {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
  static last: FakeES | null = null;
  url: string; ls = new Map<string, ((e: any) => void)[]>();
  constructor(url: string) { this.url = url; FakeES.last = this; }
  addEventListener(t: string, fn: (e: any) => void) { const a = this.ls.get(t) || []; a.push(fn); this.ls.set(t, a); }
  fire(t: string, data?: string) { for (const fn of this.ls.get(t) || []) fn({ type: t, data }); }
}
const g = globalThis as any;
let pageFetchCalls = 0;
let pageFetch: unknown;
beforeAll(async () => {
  g.window = g;
  g.EventSource = FakeES;
  g.fetch = pageFetch = async (url: string) => {
    pageFetchCalls++;
    const body = /\/api\/city\/enter/.test(url) ? { ok: true, a: [{ l: 'x' }] } : /\/api\/me/.test(url) ? { ok: true, hero: { login: 'me' } } : { ok: true, other: 1 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await import('../src/bridge/bridge');
});
const tee = () => g.__L3D_BUS.fetchTee;
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('bridge', () => {
  it('installs one non-writable bus', () => {
    expect(g.__L3D_BUS).toBeTruthy();
    expect(Object.getOwnPropertyDescriptor(g, '__L3D_BUS')!.writable).toBe(false);
  });

  it('tees named SSE events of /api/live, parsed', () => {
    const got: any[] = [];
    g.__L3D_BUS.on('sse:city', (d: any) => got.push(d));
    const es = new g.EventSource('/c/ch/api/live');
    expect(es).toBeInstanceOf(FakeES);           // the page still gets a real EventSource
    expect(g.EventSource.OPEN).toBe(1);
    FakeES.last!.fire('city', JSON.stringify({ n: 3 }));
    FakeES.last!.fire('me', 'not json');
    expect(got).toEqual([{ n: 3 }]);
    expect(g.__L3D_BUS.last['sse:me']).toBe('not json');
  });

  it('ignores other event sources', () => {
    const got: any[] = [];
    g.__L3D_BUS.on('sse:city', (d: any) => got.push(d));
    new g.EventSource('/somewhere/else');
    FakeES.last!.fire('city', '{}');
    expect(got.length).toBe(0);
  });

  it('leaves window.fetch alone until the 3D game asks for the tee, and gives it back exactly', () => {
    expect(g.fetch).toBe(pageFetch);
    expect(tee().installed()).toBe(false);
    expect(tee().on()).toBe(true);
    expect(g.fetch).not.toBe(pageFetch);
    expect(tee().installed()).toBe(true);
    expect(tee().on()).toBe(true);                 // idempotent: no second wrapper
    expect(tee().off()).toBe(true);
    expect(g.fetch).toBe(pageFetch);
    expect(tee().installed()).toBe(false);
    expect(tee().off()).toBe(true);                // off while off is fine
    expect(g.fetch).toBe(pageFetch);
  });

  it('copies watched fetch JSON and leaves the response body to the page', async () => {
    tee().on();
    const got: any[] = [];
    g.__L3D_BUS.on('city:enter', (d: any) => got.push(d));
    const r = await g.fetch('/c/ch/api/city/enter', { method: 'POST' });
    expect(await r.json()).toEqual({ ok: true, a: [{ l: 'x' }] });   // body not consumed by the tee
    await flush();
    expect(got).toEqual([{ ok: true, a: [{ l: 'x' }] }]);
    const n = pageFetchCalls;
    await g.fetch('/c/ch/api/other');
    await flush();
    expect(pageFetchCalls).toBe(n + 1);
    expect(g.__L3D_BUS.last['me']).toBeUndefined();
    await g.fetch('/c/ch/api/me');
    await flush();
    expect(g.__L3D_BUS.last['me']).toEqual({ ok: true, hero: { login: 'me' } });
    tee().off();
    expect(g.fetch).toBe(pageFetch);
  });

  it('a throwing bus listener does not reach the page', () => {
    const warn = console.warn; console.warn = () => {};
    g.__L3D_BUS.on('sse:q', () => { throw new Error('boom'); });
    new g.EventSource('/api/live');
    expect(() => FakeES.last!.fire('q', '{}')).not.toThrow();
    console.warn = warn;
  });
});
