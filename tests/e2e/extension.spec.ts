import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
  type Worker,
} from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const extensionPath = resolve(root, 'dist-e2e');

const HOSTILE = `<!doctype html><html><head><title>Hostile</title><style>
  html { transform: scale(0.96); transform-origin: 0 0; }
  body { margin: 0; font: 16px system-ui; }
  .widget { position: fixed; right: 0; bottom: 0; left: 0; height: 120px; z-index: 2147483647; background: rgba(255,0,0,.15); }
  #scroller { height: 200px; overflow: auto; border: 1px solid #ccc; margin: 20px; }
  #scroller div { height: 80px; border-bottom: 1px solid #eee; }
</style></head><body>
  <h1 id="title">Hostile page</h1>
  <p id="count">0</p>
  <div id="scroller"><div id="row1">row 1</div><div id="row2">row 2</div><div id="row3">row 3</div><div>4</div><div>5</div><div>6</div></div>
  <dialog id="dlg"><p>Modal dialog</p><button id="dlg-close">Close</button></dialog>
  <div class="widget">chat widget</div>
  <script>
    let n = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'c') document.getElementById('count').textContent = String(++n); });
  </script>
</body></html>`;

const SPA = `<!doctype html><html><head><title>SPA</title></head><body>
  <h1 id="title">Home</h1>
  <button id="go" onclick="history.pushState({}, '', '/spa/other'); document.getElementById('title').textContent = 'Other'">Other page</button>
</body></html>`;

const WALK = `<!doctype html><html><head><title>Pricing</title><style>
  body { margin: 0; font: 16px system-ui; } h1 { font-size: 48px; margin: 40px; } .tall { height: 2400px; }
  button { font-size: 20px; margin: 0 40px; padding: 12px 20px; }
</style></head><body>
  <h1 id="title">Simple pricing</h1>
  <button id="cta" onclick="document.getElementById('msg').textContent = 'Thanks!'">Start free</button>
  <p id="msg"></p>
  <label style="margin: 40px">Email <input id="email"></label>
  <div class="tall"></div>
</body></html>`;

const SHOP = `<!doctype html><html lang="en"><head><title>Shop</title><style>
  body { margin: 0; font: 16px system-ui; } h1 { font-size: 40px; margin: 40px; }
  button, a { font-size: 18px; margin: 0 40px; }
  .toast { position: fixed; right: 24px; top: 24px; padding: 14px 18px; background: #111; color: #fff; border-radius: 10px; }
  p { margin: 24px 40px; max-width: 520px; line-height: 1.5; }
</style></head><body>
  <h1 id="title">Shop</h1>
  <p>Ten things you can buy here, all of them carefully chosen and none of them strictly necessary for anybody.</p>
  <button id="save" onclick="setTimeout(() => { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = 'Saved to your list'; document.body.append(t); }, 300)">Save</button>
  <a id="next" href="/shop-cart">Go to cart</a>
</body></html>`;

const CART = `<!doctype html><html lang="en"><head><title>Cart</title><style>
  body { margin: 0; font: 16px system-ui; } h1 { font-size: 40px; margin: 40px; }
</style></head><body><h1 id="title">Your cart</h1><p style="margin: 40px">Nothing here yet.</p></body></html>`;

const CSP_PAGE = `<!doctype html><html><head><title>CSP</title></head><body><h1 id="title">Strict CSP</h1></body></html>`;

const FILES: Record<string, [string, string]> = {
  '/hostile': ['text/html', HOSTILE],
  '/spa': ['text/html', SPA],
  '/csp': ['text/html', CSP_PAGE],
  '/walk': ['text/html', WALK],
  '/shop': ['text/html', SHOP],
  '/shop-cart': ['text/html', CART],
  '/': ['text/html', readFileSync(resolve(import.meta.dirname, 'fixture.html'), 'utf8')],
  '/phone': ['text/html', readFileSync(resolve(import.meta.dirname, 'fixture.html'), 'utf8')],
  '/sizes': ['text/html', readFileSync(resolve(import.meta.dirname, 'fixture.html'), 'utf8')],
  '/style.css': [
    'text/css',
    'body{font-family:system-ui;margin:0;color:#123}h1{font-size:48px;padding:24px}',
  ],
  '/bg.svg': [
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#e0f2fe"/></svg>',
  ],
  '/logo.svg': [
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#0f766e"/></svg>',
  ],
};

let server: Server;
let baseUrl = '';
let context: BrowserContext;
let worker: Worker;
let installPageTitle = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const file = FILES[req.url ?? '/'];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    const headers: Record<string, string> = { 'content-type': file[0] };
    if (req.url === '/csp')
      headers['content-security-policy'] = "default-src 'self'; img-src 'self'; style-src 'self'";
    res.writeHead(200, headers).end(file[1]);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // First install opens the welcome/settings page in a tab; check it and put it away.
  let welcome: Page | undefined;
  for (let i = 0; i < 50 && !welcome; i++) {
    welcome = context.pages().find((p) => p.url().includes('/options.html'));
    if (!welcome) await new Promise((r) => setTimeout(r, 100));
  }
  await welcome?.waitForLoadState();
  installPageTitle = welcome ? await welcome.title() : '';
  await welcome?.close();
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
});

/** A file from a stored (uncompressed) zip, as the .zip download writes them. */
function zipEntry(zip: Buffer, suffix: string): string {
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extraLength;
    if (name.endsWith(suffix)) return zip.subarray(start, start + size).toString('utf8');
    at = start + size;
  }
  throw new Error(`${suffix} not in zip`);
}

/** Where each pin is placed on the page (not its box, which pops in with an animation). */
const pinSpots = (pins: Element[]) =>
  pins.map((p) => [
    Math.round(Number.parseFloat((p as HTMLElement).style.left)),
    Math.round(Number.parseFloat((p as HTMLElement).style.top)),
  ]);

/** Same path the popup / keyboard command uses: inject on demand, then toggle. */
async function toggleToolbar(page: Page): Promise<void> {
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (!tab?.id) throw new Error('fixture tab not found');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'cd:toggle' });
  }, page.url());
  await expect(page.locator('chrome-design-root')).toHaveCount(1);
}

test('manifest requests only minimal permissions (production build)', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'dist/manifest.json'), 'utf8'));
  expect(manifest.manifest_version).toBe(3);
  // unlimitedStorage (no install warning): placed and attached images would outgrow storage.local's 10 MB.
  expect(manifest.permissions.toSorted()).toEqual([
    'activeTab',
    'scripting',
    'storage',
    'unlimitedStorage',
  ]);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  // The voice link asks for native messaging only when it's turned on.
  expect(manifest.optional_permissions).toEqual(['nativeMessaging']);
});

test('comment, draw and export a self-contained handoff from a live page', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl);
  await expect(page.locator('body[data-ready="1"]')).toHaveCount(1);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');

  // First run: a short welcome; starting puts the Comment tool in hand.
  await ui.getByText('Start commenting').click();
  await expect(ui.locator('.root')).toHaveAttribute('data-tool', 'comment');

  // Comment on the headline: hover names it in plain words, Enter sends.
  const title = await page.locator('#title').boundingBox();
  await page.mouse.move(title!.x + 40, title!.y + 20);
  await expect(ui.locator('.name-tag')).toHaveText('Comment on heading');
  await page.mouse.click(title!.x + 40, title!.y + 20);
  await ui.locator('.popover textarea').fill('Make this friendlier');
  await page.keyboard.press('Enter');
  await expect(ui.locator('.pin')).toHaveCount(1);

  // Select the CTA: the selection bar names it; comment from there as a decision.
  await page.keyboard.press('v');
  const cta = await page.locator('#cta').boundingBox();
  await page.mouse.click(cta!.x + 10, cta!.y + 10);
  await expect(ui.locator('.selection-bar .sel-label')).toHaveText('Button “Buy now”');
  // The bar is Liquid Glass, like the toolbar; up and back down return to the button.
  await expect(ui.locator('.selection-bar')).toHaveAttribute('data-glass', /svg|css/);
  await ui.locator('.selection-bar [aria-label="Select the surrounding element"]').click();
  await expect(ui.locator('.selection-bar .sel-label')).not.toHaveText('Button “Buy now”');
  await ui.locator('.selection-bar [aria-label="Select inside"]').click();
  await expect(ui.locator('.selection-bar .sel-label')).toHaveText('Button “Buy now”');
  await ui.locator('.selection-bar .chip-btn[aria-label="Comment"]').click();
  await ui.locator('.seg button[data-intent="decision"]').click();
  await ui.locator('.popover textarea').fill('Keep the button copy.');
  await ui.locator('.popover .send').click();
  await expect(ui.locator('.pin')).toHaveCount(2);

  // Draw a rectangle: Select comes back with it selected, ready to move and resize.
  await page.keyboard.press('r');
  await page.mouse.move(20, 300);
  await page.mouse.down();
  await page.mouse.move(400, 420, { steps: 5 });
  await page.mouse.up();
  await expect(ui.locator('.root')).toHaveAttribute('data-tool', 'select');
  await expect(ui.locator('.sel-handle')).toHaveCount(4);
  const rectBox = async () => (await ui.locator('.shape-layer rect').first().boundingBox())!;
  const drawn = await rectBox();
  // Drag the shape by its frame…
  await page.mouse.move(drawn.x + 100, drawn.y + 2);
  await page.mouse.down();
  await page.mouse.move(drawn.x + 140, drawn.y + 32, { steps: 4 });
  await page.mouse.up();
  const moved = await rectBox();
  expect(Math.round(moved.x - drawn.x)).toBe(40);
  expect(Math.round(moved.y - drawn.y)).toBe(30);
  // …and resize it from the bottom-right handle.
  const handle = (await ui.locator('.sel-handle[data-handle="se"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 60, handle.y + 40, { steps: 4 });
  await page.mouse.up();
  const resized = await rectBox();
  expect(Math.round(resized.width - moved.width)).toBeGreaterThan(40);
  expect(Math.round(resized.x)).toBe(Math.round(moved.x));

  // An arrow, then undo + redo
  await page.keyboard.press('a');
  await page.mouse.move(500, 500);
  await page.mouse.down();
  await page.mouse.move(300, 350, { steps: 5 });
  await page.mouse.up();
  await expect(ui.locator('.shape-layer > *')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(ui.locator('.shape-layer > *')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(ui.locator('.shape-layer > *')).toHaveCount(2);

  // Persisted in extension storage (not on the site)
  const stored = await worker.evaluate(async () =>
    Object.keys(await chrome.storage.local.get(null)),
  );
  expect(stored.some((k) => k.startsWith('doc:'))).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

  // Export
  await page.keyboard.press('Shift+E');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    ui.locator('[data-testid="cd-export-download"]').click(),
  ]);
  const path = resolve(root, 'test-results/last-export.html');
  await download.saveAs(path);
  const html = readFileSync(path, 'utf8');
  expect(download.suggestedFilename()).toMatch(/^chrome-design-127\.0\.0\.1-\d{8}-\d{4}\.html$/);
  expect(html.indexOf('AGENT INSTRUCTIONS')).toBeLessThan(300);
  expect(html).not.toContain('<chrome-design-root');
  const payload = JSON.parse(
    html.match(
      /<script type="application\/json" id="chrome-design-payload" data-chrome-design>([\s\S]*?)<\/script>/,
    )![1]!,
  );
  expect(payload.summary).toMatchObject({ comments: 2, decisions: 1, shapes: 2 });
  expect(payload.blocks.screenshot).toBeTruthy(); // captureVisibleTab through the service worker
  expect(payload.blocks.runtime).toBeTruthy(); // the toolbar is built in
  expect(payload.warnings.map((w: { url?: string }) => w.url)).toContain(
    'https://unreachable.invalid/missing.png',
  );
  expect(payload.sanitize.eventHandlers).toBeGreaterThanOrEqual(1);
  await expect(ui.locator('.morph-pill[data-phase="done"]')).toContainText('Saved');
  await expect(ui.locator('.export-result')).toContainText('Allow other websites');

  // Toolbar hides during the screenshot and comes back
  await expect(ui.locator('.toolbar')).toBeVisible();
  const livePins = await ui.locator('.pin').evaluateAll(pinSpots);

  // The .zip for agents: the file, instructions, payload, clean page, screenshot
  const [zipDownload] = await Promise.all([
    page.waitForEvent('download'),
    ui.locator('[data-testid="cd-export-zip"]').click(),
  ]);
  expect(zipDownload.suggestedFilename()).toMatch(/\.zip$/);
  const zipPath = resolve(root, 'test-results/last-export.zip');
  await zipDownload.saveAs(zipPath);
  const zipText = readFileSync(zipPath).toString('latin1');
  expect(zipText.startsWith('PK')).toBe(true);
  for (const name of [
    'AGENTS.md',
    'handoff.json',
    'page.html',
    'screenshot.jpg',
    'page-annotated.jpg',
  ])
    expect(zipText).toContain(`/${name}`);

  // The shared file opens offline as the page, with the toolbar on and the feedback on top
  const viewer = await context.newPage();
  const requests: string[] = [];
  viewer.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  const errors: string[] = [];
  viewer.on('pageerror', (e) => errors.push(e.message));
  viewer.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await viewer.goto(`file://${path}`);
  const shared = viewer.locator('chrome-design-root');
  await expect(shared.locator('.toolbar')).toBeVisible();
  await expect(shared.locator('.root')).toHaveAttribute('data-tool', 'select');
  expect(await viewer.locator('h1').first().textContent()).toBe('Hello, reviewer');
  await expect(viewer.locator('chrome-design-static')).toHaveCount(0);
  await expect(shared.locator('.pin')).toHaveCount(2);
  const sharedPins = await shared.locator('.pin').evaluateAll(pinSpots);
  expect(sharedPins).toEqual(livePins);

  // A teammate replies in the file and downloads an updated copy
  await shared.locator('.pin').first().click();
  await shared.locator('.popover textarea').fill('Agreed, ship it');
  await viewer.keyboard.press('Enter');
  await expect(shared.locator('.popover .message')).toHaveCount(2);
  await viewer.keyboard.press('Escape');
  await viewer.keyboard.press('Shift+E');
  const [again] = await Promise.all([
    viewer.waitForEvent('download'),
    shared.locator('[data-testid="cd-export-download"]').click(),
  ]);
  const againPath = resolve(root, 'test-results/reexport.html');
  await again.saveAs(againPath);
  const updated = readFileSync(againPath, 'utf8');
  expect(updated).toContain('Agreed, ship it');
  expect(updated.match(/id="chrome-design-runtime"/g)?.length).toBe(1);
  expect(updated.match(/<meta name="chrome-design-snapshot" content="http/g)?.length).toBe(1);
  expect(updated).toContain('Hello, reviewer');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);

  // Back on the live site: open the teammate's file and their reply joins the thread
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await ui.locator('.tb-btn[aria-label="More"]').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    ui.locator('.tile', { hasText: 'Open file' }).click(),
  ]);
  await chooser.setFiles(againPath);
  await expect(ui.locator('.toast')).toContainText('Added 1 reply');
  await ui.locator('.pin').first().click();
  await expect(ui.locator('.popover .message')).toHaveCount(2);
  await expect(ui.locator('.popover')).toContainText('Agreed, ship it');
  await page.keyboard.press('Escape');

  // Close removes every trace from the page
  await page.bringToFront();
  await page.keyboard.press('Alt+Shift+D');
  await expect(page.locator('chrome-design-root')).toHaveCount(0);
});

test('installing opens the welcome & settings page', () => {
  expect(installPageTitle).toContain('Chrome Design');
});

test('popup explains restricted pages', async () => {
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.getByText('Not available on this page')).toBeVisible();
});

test('integrates with hostile pages: transformed root, max z-index overlay, page shortcuts, inner scroll, modal dialog, cleanup', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/hostile`);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');
  const intro = ui.getByText('Start commenting');
  if (await intro.isVisible()) await intro.click();

  // Top layer: unaffected by the page's html transform, above a z-index 2147483647 widget.
  expect(
    await page.evaluate(() =>
      document.querySelector('chrome-design-root')?.matches(':popover-open'),
    ),
  ).toBe(true);
  // (after the toolbar's slide-in settles)
  await expect
    .poll(async () => {
      const b = (await ui.locator('.toolbar').boundingBox())!;
      return Math.round(b.y + b.height);
    })
    .toBe(800 - 16);
  const bar = (await ui.locator('.toolbar').boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.localName,
    [bar.x + bar.width / 2, bar.y + bar.height / 2],
  );
  expect(hit).toBe('chrome-design-root');

  // While a tool is active the page never sees our single-key shortcuts…
  await page.keyboard.press('c');
  await expect(page.locator('#count')).toHaveText('0');
  // …and once paused (Esc to browse) the page's own shortcuts work again.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(ui.locator('.status-chip')).toContainText('Paused');
  await page.keyboard.press('c');
  await expect(page.locator('#count')).toHaveText('1');
  await ui.locator('.status-chip .chip-btn').click();

  // A pin on an element inside an inner scroller follows it when the scroller scrolls.
  await page.keyboard.press('c');
  const row = (await page.locator('#row2').boundingBox())!;
  await page.mouse.click(row.x + 20, row.y + 10);
  await ui.locator('.popover textarea').fill('Row spacing');
  await page.keyboard.press('Enter');
  const before = (await ui.locator('.pin').boundingBox())!;
  await page.locator('#scroller').evaluate((el) => {
    el.scrollTop = 60;
  });
  await page.waitForTimeout(100);
  const after = (await ui.locator('.pin').boundingBox())!;
  expect(Math.round(before.y - after.y)).toBeGreaterThan(50);

  // A page modal dialog does not lock the toolbar (we re-enter the top layer above it).
  await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).showModal());
  await page.waitForTimeout(150);
  await ui.locator('.toolbar .tb-btn[aria-label^="Pencil"]').click();
  await expect(ui.locator('.subbar')).toBeVisible();
  await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).close());

  // Closing removes everything; the page gets its keys back.
  await ui.locator('.toolbar .tb-btn[aria-label^="Close"]').click();
  await expect(page.locator('chrome-design-root')).toHaveCount(0);
  await page.keyboard.press('c');
  await expect(page.locator('#count')).toHaveText('2');
});

test('single-page apps: notes follow the URL', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/spa`);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');
  const welcome = ui.getByText('Start commenting');
  if (await welcome.isVisible()) await welcome.click();
  await page.keyboard.press('c');
  const title = (await page.locator('#title').boundingBox())!;
  await page.mouse.click(title.x + 10, title.y + 10);
  await ui.locator('.popover textarea').fill('Home headline');
  await page.keyboard.press('Enter');
  await expect(ui.locator('.pin')).toHaveCount(1);
  await page.evaluate(() => (document.getElementById('go') as HTMLButtonElement).click());
  await expect(ui.locator('.pin')).toHaveCount(0, { timeout: 3000 });
  // Switching pages is silent: no notice, just that page's notes.
  await expect(ui.locator('.toast[data-on]')).toHaveCount(0);
  await page.goBack();
  await expect(ui.locator('.pin')).toHaveCount(1, { timeout: 3000 });
});

test('strict CSP pages: tools work and the glass falls back to CSS', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/csp`);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');
  await expect(ui.locator('.toolbar')).toHaveAttribute('data-glass', 'css', { timeout: 3000 });
  await page.keyboard.press('d');
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(300, 260, { steps: 5 });
  await page.mouse.up();
  await expect(ui.locator('.shape-layer > *')).toHaveCount(1);
});

test('images dropped on a strict-CSP page are placed, shown and kept', async () => {
  // The toggle finds its tab by URL: put away the CSP tab the previous test left open.
  for (const p of context.pages()) if (p.url().endsWith('/csp')) await p.close();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/csp`);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');
  await expect(ui.locator('.toolbar')).toBeVisible();
  const refused: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) refused.push(m.text());
  });
  // Drop a 400×200 red PNG from the "desktop" onto the page.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 400, 200);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'red.png', { type: 'image/png' }));
    const target = document
      .querySelector('chrome-design-root')!
      .shadowRoot!.querySelector('.capture')!;
    const init = {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: 500,
      clientY: 400,
      dataTransfer: dt,
    };
    target.dispatchEvent(new DragEvent('dragover', init));
    target.dispatchEvent(new DragEvent('drop', init));
  });
  const placed = ui.locator('image.placed-image');
  await expect(placed).toHaveCount(1);
  await expect(placed).toHaveAttribute('width', '400');
  await expect(ui.locator('.size-pill')).toHaveText('400 × 200');
  // The picture actually paints despite the page's img-src 'self'.
  const shot = await page.screenshot({ clip: { x: 490, y: 390, width: 4, height: 4 } });
  // (Decoded in a blank tab: this page's own CSP refuses data: images.)
  const scratch = await context.newPage();
  const rgb = await scratch.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(1, 1, 1, 1).data.slice(0, 3));
  }, shot.toString('base64'));
  await scratch.close();
  expect(rgb[0]).toBeGreaterThan(200);
  expect(rgb[1]).toBeLessThan(60);
  expect(refused).toEqual([]);

  // A tall page: the .zip carries the whole page stitched from several screens, with the
  // image drawn on, and the image cropped in its place.
  await page.evaluate(() => {
    document.body.style.minHeight = '2400px';
  });
  await page.keyboard.press('Shift+E');
  const [zipDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    ui.locator('[data-testid="cd-export-zip"]').click(),
  ]);
  const zipPath = resolve(root, 'test-results/csp-export.zip');
  await zipDownload.saveAs(zipPath);
  const zipText = readFileSync(zipPath).toString('latin1');
  expect(zipText).toContain('/page-annotated.jpg');
  expect(zipText).toContain('/images/placed-01-red-in-context.jpg');
  const handoffJson = JSON.parse(zipEntry(readFileSync(zipPath), 'handoff.json'));
  const full = handoffJson.blocks.fullPage;
  expect(full.height / full.scale).toBeGreaterThan(2300);
  await page.keyboard.press('Escape');

  // Hide the heading with a blurred box: the download keeps none of its text.
  await page.keyboard.press('b');
  const title = (await page.locator('#title').boundingBox())!;
  await page.mouse.move(title.x - 4, title.y - 4);
  await page.mouse.down();
  await page.mouse.move(title.x + title.width + 4, title.y + title.height + 4, { steps: 4 });
  await page.mouse.up();
  await expect(ui.locator('.redact-box')).toHaveCount(1);
  await page.keyboard.press('Shift+E');
  const [hiddenDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    ui.locator('[data-testid="cd-export-download"]').click(),
  ]);
  const hiddenPath = resolve(root, 'test-results/csp-hidden.html');
  await hiddenDownload.saveAs(hiddenPath);
  const hiddenHtml = readFileSync(hiddenPath, 'utf8');
  expect(hiddenHtml).not.toContain('Strict CSP');
  expect(hiddenHtml).toContain('•••••• •••');
  expect(hiddenHtml).toContain('HIDDEN AREA');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(ui.locator('.redact-box')).toHaveCount(0);
  // Undo takes it away in one step.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(placed).toHaveCount(0);
  await page.close();
});

test('screen sizes: comments can be for one size; presets live in More', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sizes`);
  await expect(page.locator('body[data-ready="1"]')).toHaveCount(1);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');
  await ui.locator('.tb-btn[aria-label^="Comment (C)"]').click();
  const title = (await page.locator('#title').boundingBox())!;
  await page.mouse.click(title.x + 60, title.y + 20);
  const chip = ui.locator('.popover .scope-chip');
  await expect(chip).toHaveText('All sizes');
  await chip.click();
  await expect(chip).toHaveText('Phone');
  await ui.locator('.popover textarea').fill('Stack these on phones');
  await page.keyboard.press('Enter');
  // Written at 1280px (desktop): the phone-only pin steps back.
  await expect(ui.locator('.pin[data-other-size]')).toHaveCount(1);
  // Copy for AI puts a chat-ready message on the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  await page.keyboard.press('Shift+E');
  await ui.locator('[data-testid="cd-copy-for-ai"]').click();
  await expect(ui.locator('[data-testid="cd-copy-for-ai"][data-done]')).toHaveCount(1);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Design feedback on');
  expect(copied).toContain('Stack these on phones');
  expect(copied).toContain('only at phone widths');
  await page.keyboard.press('Escape');
  await ui.locator('.tb-btn[aria-label="More"]').click();
  await ui.locator('.tile', { hasText: 'Screen size' }).click();
  await expect(ui.locator('.screen-readout')).toContainText('1280 px · Desktop');
  await expect(ui.locator('.screen-panel .tile')).toHaveCount(4);
  await page.close();
});

test('phones: panels are bottom sheets that keep their content while they move', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${baseUrl}/phone`);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');
  await ui.locator('.toolbar .tb-btn[aria-label^="More"]').click();
  await expect(ui.locator('.bsheet-root[data-phase="open"] .more-panel')).toBeVisible();
  // The toolbar steps aside while a sheet is up.
  await expect(ui.locator('.dock')).toHaveAttribute('data-covered', '');

  // Switching panels crossfades: the outgoing panel stays drawn during the swap.
  const swap = await ui.locator('.tile', { hasText: 'Comments' }).evaluate(async (tile) => {
    const shadow = tile.getRootNode() as ShadowRoot;
    (tile as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return [...shadow.querySelectorAll('.bsheet-frame')].map((f) =>
      f.classList.contains('leaving') ? 'leaving' : 'entering',
    );
  });
  expect(swap).toEqual(['leaving', 'entering']);
  await expect(ui.locator('.bsheet .list-panel')).toBeVisible();

  // Tapping outside slides the sheet away with its content fully drawn until it is gone.
  const closing = await ui.locator('.bsheet-scrim').evaluate(async (scrim) => {
    (scrim as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sheetRoot = scrim.closest('.bsheet-root') as HTMLElement;
    const frame = sheetRoot.querySelector('.bsheet-frame:not(.leaving)') as HTMLElement;
    return {
      phase: sheetRoot.dataset.phase,
      opacity: getComputedStyle(frame).opacity,
      text: frame.textContent,
    };
  });
  expect(closing).toMatchObject({ phase: 'closing', opacity: '1' });
  expect(closing.text).toContain('Comments');
  await expect(ui.locator('.bsheet-root')).toHaveCount(0);
  await expect(ui.locator('.dock')).not.toHaveAttribute('data-covered', '');
});

test('walkthrough: laser, ink and clicks become numbered pictures and a summary', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/walk`);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');
  // Walkthrough is on the toolbar itself (W does the same).
  await ui.locator('.toolbar .tb-btn[aria-label^="Walkthrough"]').click();
  await expect(ui.locator('.rec-time')).toBeVisible();
  await expect(ui.locator('.rec-edge[data-on]')).toHaveCount(1);
  // The page works while recording: the button still answers clicks.
  const title = (await page.locator('#title').boundingBox())!;
  // ⇧ + move: the laser across the heading.
  await page.mouse.move(title.x + 10, title.y + title.height / 2);
  await page.keyboard.down('Shift');
  for (let i = 0; i <= 12; i++)
    await page.mouse.move(title.x + 10 + i * 20, title.y + title.height / 2, { steps: 2 });
  await page.waitForTimeout(400);
  // ⇧ + drag: a circle round the heading.
  const cx = title.x + Math.min(title.width, 420) / 2;
  const cy = title.y + title.height / 2;
  await page.mouse.move(cx + 220, cy);
  await page.mouse.down();
  for (let i = 1; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    await page.mouse.move(cx + 220 * Math.cos(a), cy + 50 * Math.sin(a));
  }
  await page.mouse.up();
  await expect(ui.locator('.wt-stroke')).toHaveCount(1);
  // ⇧ + click: pin 1 on the button.
  const cta = (await page.locator('#cta').boundingBox())!;
  await page.mouse.click(cta.x + cta.width - 8, cta.y + 8);
  await expect(ui.locator('.wt-pin')).toHaveCount(1);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(700);
  // A plain click goes to the page.
  await page.locator('#cta').click();
  await expect(page.locator('#msg')).toHaveText('Thanks!');
  await page.locator('#email').fill('nobody@example.com');
  await page.waitForTimeout(1200);
  await ui.locator('.tb-btn[aria-label^="Stop"]').click();

  // Stop opens Send to AI: the walkthrough goes with the rest of the feedback.
  const panel = ui.locator('[data-testid="cd-wt-card"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('.wt-preview')).toBeVisible();
  await expect(panel.locator('.summary-row').first()).toContainText('picture');
  await expect(ui.locator('.tb-btn[aria-label^="Send to AI"]')).toHaveAttribute(
    'aria-label',
    /walkthrough/,
  );

  const downloading = page.waitForEvent('download');
  await ui.locator('[data-testid="cd-export-zip"]').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^chrome-design-127\.0\.0\.1-.*\.zip$/);
  const zip = readFileSync((await download.path())!);
  expect(zipEntry(zip, 'AGENTS.md')).toContain('`walkthrough/`');
  const summary = zipEntry(zip, 'walkthrough/summary.md');
  expect(summary).toContain('circled Heading “Simple pricing”');
  expect(summary).toContain('pin 1 on Button “Start free”');
  expect(summary).toContain('pointed at Heading “Simple pricing”');
  expect(summary).toContain('[clicked Button “Start free”]');
  expect(summary).toContain('typed in Field “Email”');
  expect(summary).not.toContain('nobody@example.com');
  const wt = JSON.parse(zipEntry(zip, 'walkthrough/walkthrough.json'));
  expect(wt.kind).toBe('chrome-design.walkthrough');
  expect(wt.frames.length).toBeGreaterThanOrEqual(4);
  expect(wt.frames[0].reason).toBe('start');
  expect(zip.includes(Buffer.from('walkthrough/contact-sheet.jpg'))).toBe(true);
  expect(zip.includes(Buffer.from('walkthrough/frames/frame-01.jpg'))).toBe(true);

  // The whole walkthrough as one picture.
  const saving = page.waitForEvent('download');
  await ui.locator('[data-testid="cd-wt-image"]').click();
  expect((await saving).suggestedFilename()).toMatch(/^walkthrough-.*\.jpg$/);

  // A transcript from any tool lines up with the pictures.
  const said = '1\n00:00:00,300 --> 00:00:01,000\nThis heading is too big.\n';
  const picking = page.waitForEvent('filechooser');
  await ui.locator('[data-testid="cd-wt-transcript"]').click();
  await (await picking).setFiles({
    name: 'said.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from(said),
  });
  await expect(panel.locator('.wt-voice')).toContainText('said.srt');
  await expect(panel.locator('.dial')).toBeVisible();
  // What the AI gets is shown as it will be copied.
  await ui.locator('summary', { hasText: 'What the AI gets' }).click();
  await expect(ui.locator('[data-testid="cd-ai-preview"]')).toContainText('WALKTHROUGH');
  await expect(ui.locator('[data-testid="cd-ai-preview"]')).toContainText(
    '“This heading is too big.”',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  await ui.locator('[data-testid="cd-copy-for-ai"]').click();
  await expect(ui.locator('[data-testid="cd-copy-for-ai"][data-done]')).toHaveCount(1);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('WALKTHROUGH');
  expect(copied).toContain('“This heading is too big.”');

  // The shareable file carries it too.
  const saving2 = page.waitForEvent('download');
  await ui.locator('[data-testid="cd-export-download"]').click();
  const html = readFileSync((await (await saving2).path())!, 'utf8');
  expect(html).toContain('id="chrome-design-walkthrough"');
  expect(html).toContain('id="chrome-design-walkthrough-sheet"');
  expect(html).toContain('THE WALKTHROUGH');
  await page.close();
});

test('walkthrough: crops, page changes, a flag that leaves a comment, and a second page', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/shop`);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');
  await ui.locator('.toolbar .tb-btn[aria-label^="Walkthrough"]').click();
  await expect(ui.locator('.rec-time')).toBeVisible();
  await page.waitForTimeout(700);

  // A toast appears by itself after the click: its own picture.
  await page.locator('#save').click();
  await expect(page.locator('.toast')).toBeVisible();
  await page.waitForTimeout(1500);

  // Flag: a picture, and a comment where the pointer is.
  const title = (await page.locator('#title').boundingBox())!;
  await page.mouse.move(title.x + 30, title.y + title.height / 2);
  await page.keyboard.press('Alt+Shift+KeyF');
  await page.waitForTimeout(900);

  // Follow a link: the walkthrough carries on on the next page.
  await page.locator('#next').click();
  await page.waitForURL(/shop-cart/);
  await expect(page.locator('chrome-design-root .rec-time')).toBeVisible({ timeout: 10_000 });
  const cart = (await page.locator('#title').boundingBox())!;
  const cx = cart.x + 120;
  const cy = cart.y + cart.height / 2;
  await page.mouse.move(cx + 150, cy);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  for (let i = 1; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    await page.mouse.move(cx + 150 * Math.cos(a), cy + 40 * Math.sin(a));
  }
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(800);
  const ui2 = page.locator('chrome-design-root');
  await ui2.locator('.tb-btn[aria-label^="Stop"]').click();
  await expect(ui2.locator('[data-testid="cd-wt-card"]')).toBeVisible({ timeout: 20_000 });

  const downloading = page.waitForEvent('download');
  await ui2.locator('[data-testid="cd-export-zip"]').click();
  const zip = readFileSync((await (await downloading).path())!);
  const summary = zipEntry(zip, 'walkthrough/summary.md');
  const wt = JSON.parse(zipEntry(zip, 'walkthrough/walkthrough.json'));
  // One walkthrough over both pages, on one clock.
  expect(wt.page.title).toBe('Shop');
  expect(summary).toContain('Message “Saved to your list” appeared');
  expect(summary).toMatch(/⚑ flagged Heading “Shop” \(comment \d+\)/);
  expect(summary).toContain('went to “Cart”');
  expect(summary).toContain('circled Heading “Your cart”');
  // The toast's own picture keeps the toast (top right) in its crop.
  const toast = wt.frames.find((f: { reason: string }) => f.reason === 'change');
  expect(toast).toBeTruthy();
  expect(toast.crop.kind === 'full' || toast.crop.x + toast.crop.width >= 1200).toBe(true);
  expect(toast.crop.kind === 'full' || toast.crop.y <= 30).toBe(true);
  expect(wt.frames.some((f: { reason: string }) => f.reason === 'flag')).toBe(true);
  // Page details read from Chrome.
  expect(wt.context).toMatchObject({ screen: 'Shop', route: '/shop', lang: 'en' });
  expect(summary).toContain('Screen: Shop · route: /shop');
  expect(summary).toContain('⟨Your cart⟩');
  // Auto-crop, with the full pictures beside the cropped ones.
  expect(wt.autocrop).toMatchObject({ label: 'the activity', fullFrames: 'frames-full' });
  expect(wt.frames.some((f: { crop?: { kind: string } }) => f.crop?.kind === 'activity')).toBe(
    true,
  );
  expect(summary).toContain('Cropped to: the activity');
  expect(zip.includes(Buffer.from('walkthrough/frames-full/frame-01.jpg'))).toBe(true);
  expect(zip.includes(Buffer.from('walkthrough/contact-sheet-full.jpg'))).toBe(true);

  // Removing it can be undone.
  await ui2.locator('[data-testid="cd-wt-remove"]').click();
  await expect(ui2.locator('[data-testid="cd-wt-card"]')).toHaveCount(0);
  await ui2.locator('.toast-btn', { hasText: 'Undo' }).click();
  await expect(ui2.locator('[data-testid="cd-wt-card"]')).toBeVisible();
  await page.close();
});
