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

const CSP_PAGE = `<!doctype html><html><head><title>CSP</title></head><body><h1 id="title">Strict CSP</h1></body></html>`;

const FILES: Record<string, [string, string]> = {
  '/hostile': ['text/html', HOSTILE],
  '/spa': ['text/html', SPA],
  '/csp': ['text/html', CSP_PAGE],
  '/': ['text/html', readFileSync(resolve(import.meta.dirname, 'fixture.html'), 'utf8')],
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
  expect(manifest.permissions.toSorted()).toEqual(['activeTab', 'scripting', 'storage']);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
});

test('comment, draw and export a self-contained handoff from a live page', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl);
  await expect(page.locator('body[data-ready="1"]')).toHaveCount(1);
  await toggleToolbar(page);
  const ui = page.locator('chrome-design-root');

  // Comment on the headline
  await page.keyboard.press('c');
  const title = await page.locator('#title').boundingBox();
  await page.mouse.click(title!.x + 40, title!.y + 20);
  await ui.locator('.popover textarea').fill('Make this friendlier');
  await page.keyboard.press('Control+Enter');
  await expect(ui.locator('.pin')).toHaveCount(1);

  // Decision on the CTA via the inspector
  await page.keyboard.press('v');
  const cta = await page.locator('#cta').boundingBox();
  await page.mouse.click(cta!.x + 10, cta!.y + 10);
  await expect(ui.locator('.inspector .el-name')).toHaveText('button#cta');
  await page.keyboard.press('Enter');
  await ui.locator('.seg button[data-intent="decision"]').click();
  await ui.locator('.popover textarea').fill('Keep the button copy.');
  await ui.locator('.composer .btn.primary').click();
  await expect(ui.locator('.pin')).toHaveCount(2);

  // Draw a rectangle and an arrow, undo + redo
  await page.keyboard.press('d');
  await page.keyboard.press('r');
  await page.mouse.move(20, 300);
  await page.mouse.down();
  await page.mouse.move(400, 420, { steps: 5 });
  await page.mouse.up();
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
  expect(html).toContain('Instructions for the AI agent');
  expect(html).not.toContain('chrome-design-root');
  const payload = JSON.parse(
    html.match(
      /<script type="application\/json" id="chrome-design-payload">\n([\s\S]*?)\n<\/script>/,
    )![1]!,
  );
  expect(payload.summary).toMatchObject({ comments: 2, decisions: 1, shapes: 2 });
  expect(payload.blocks.screenshot).toBeTruthy(); // captureVisibleTab through the service worker
  expect(payload.warnings.map((w: { url?: string }) => w.url)).toContain(
    'https://unreachable.invalid/missing.png',
  );
  expect(payload.sanitize.eventHandlers).toBeGreaterThanOrEqual(1);
  await expect(ui.locator('.morph-pill[data-phase="done"]')).toContainText('Saved');
  await expect(ui.locator('.export-result')).toContainText('Allow in settings');

  // Toolbar hides during the screenshot and comes back
  await expect(ui.locator('.toolbar')).toBeVisible();

  // The exported file renders offline with no network requests
  const viewer = await context.newPage();
  const requests: string[] = [];
  viewer.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  const errors: string[] = [];
  viewer.on('pageerror', (e) => errors.push(e.message));
  await viewer.goto(`file://${path}`);
  await expect(viewer.locator('html.cd-js')).toHaveCount(1);
  const frameTitle = await viewer.evaluate(
    () => document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent,
  );
  expect(frameTitle).toBe('Hello, reviewer');
  expect(await viewer.locator('.cd-pin').count()).toBe(2);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);

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
  const intro = ui.getByText('Start reviewing');
  if (await intro.isVisible()) await intro.click();

  // Top layer: unaffected by the page's html transform, above a z-index 2147483647 widget.
  expect(
    await page.evaluate(() =>
      document.querySelector('chrome-design-root')?.matches(':popover-open'),
    ),
  ).toBe(true);
  const bar = (await ui.locator('.toolbar').boundingBox())!;
  expect(Math.round(bar.y + bar.height)).toBe(800 - 16);
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
  await ui.locator('.toolbar .tb-btn[aria-label^="Draw"]').click();
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
  const welcome = ui.getByText('Start reviewing');
  if (await welcome.isVisible()) await welcome.click();
  await page.keyboard.press('c');
  const title = (await page.locator('#title').boundingBox())!;
  await page.mouse.click(title.x + 10, title.y + 10);
  await ui.locator('.popover textarea').fill('Home headline');
  await page.keyboard.press('Enter');
  await expect(ui.locator('.pin')).toHaveCount(1);
  await page.evaluate(() => (document.getElementById('go') as HTMLButtonElement).click());
  await expect(ui.locator('.pin')).toHaveCount(0, { timeout: 3000 });
  await expect(ui.locator('.toast')).toContainText('New page');
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
