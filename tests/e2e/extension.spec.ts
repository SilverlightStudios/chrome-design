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

const FILES: Record<string, [string, string]> = {
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

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const file = FILES[req.url ?? '/'];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': file[0] }).end(file[1]);
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
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
});

/** Same path the popup / keyboard command uses: inject on demand, then toggle. */
async function toggleToolbar(page: Page): Promise<void> {
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    if (!tab?.id) throw new Error('fixture tab not found');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'cd:toggle' });
  }, baseUrl);
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
  await ui.locator('.intent-picker button[data-intent="decision"]').click();
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
  await expect(ui.locator('.export-result')).toContainText('Saved');

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

test('popup explains restricted pages', async () => {
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.getByText('Not available here')).toBeVisible();
});
