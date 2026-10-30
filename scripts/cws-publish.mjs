#!/usr/bin/env node
// Chrome Web Store: upload a store zip to the existing item and submit it for review (API v1.1).
// Env: CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN. Missing any → skipped (exit 0).
// Prints Google's error body (never the credentials) so a failure says why: e.g. an item still in review cannot take
// a new package (ITEM_NOT_UPDATABLE / "in review"), or the refresh token was revoked (invalid_grant).
//   node scripts/cws-publish.mjs legion-3d-0.4.4-store.zip [--no-publish]
// CWS_CANCEL_PUBLISHER=<publisher id>: first cancel the item's pending review (API v2 cancelSubmission) so a newer
// package can replace a version still in review. Without it a pending review makes the upload fail (ITEM_NOT_UPDATABLE).
import { readFileSync } from 'node:fs';

const { CWS_EXTENSION_ID: id, CWS_CLIENT_ID: cid, CWS_CLIENT_SECRET: cs, CWS_REFRESH_TOKEN: rt } = process.env;
const file = process.argv[2];
const noPublish = process.argv.includes('--no-publish');

async function call(url, init, what) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`${what}: HTTP ${r.status} ${typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 800)}`);
  return body;
}

async function main() {
  if (!id || !cid || !cs || !rt) { console.log('Chrome Web Store secrets missing; skipping.'); return; }
  if (!file) throw new Error('usage: cws-publish.mjs <store.zip> [--no-publish]');
  const tok = await call('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: cid, client_secret: cs, refresh_token: rt }),
  }, 'token');
  const H = { Authorization: `Bearer ${tok.access_token}`, 'x-goog-api-version': '2' };
  const base = `https://www.googleapis.com/chromewebstore/v1.1/items/${id}`;
  const pubId = process.env.CWS_CANCEL_PUBLISHER;
  if (pubId) {
    const r = await fetch(`https://chromewebstore.googleapis.com/v2/publishers/${pubId}/items/${id}:cancelSubmission`, { method: 'POST', headers: H });
    const t = (await r.text()).slice(0, 300);
    console.log(`cancel pending review: HTTP ${r.status}${r.ok ? '' : ' ' + t}`);   // no pending review → an error here is fine
  }
  const before = await call(`${base}?projection=DRAFT`, { headers: H }, 'item');
  console.log(`item draft version before upload: ${before.crxVersion ?? '?'}`);
  const up = await call(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${id}`, { method: 'PUT', headers: H, body: readFileSync(file) }, 'upload');
  console.log(`upload: ${up.uploadState}${up.itemError ? ' ' + JSON.stringify(up.itemError) : ''}`);
  if (up.uploadState !== 'SUCCESS') throw new Error('upload not accepted');
  if (noPublish) return;
  const pub = await call(`${base}/publish?publishTarget=default`, { method: 'POST', headers: H }, 'publish');
  console.log(`publish: ${JSON.stringify(pub.status)} ${JSON.stringify(pub.statusDetail ?? '')}`);
  if (!(pub.status || []).some((s) => s === 'OK' || s === 'PUBLISHED_WITH_FRICTION')) throw new Error('publish not accepted');
  console.log('Chrome Web Store update submitted for review.');
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
