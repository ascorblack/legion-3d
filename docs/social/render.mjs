// Renders docs/social/banner.html → docs/social/preview.png (GitHub social preview, 1280×640).
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1280, height: 640 } });
await p.goto('file://' + resolve('docs/social/banner.html')); await p.waitForTimeout(500);
await p.screenshot({ path: 'docs/social/preview.png' }); await b.close();
