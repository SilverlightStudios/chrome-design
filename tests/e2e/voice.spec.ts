import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createServer as createSocketServer,
  type Socket,
  type Server as SocketServer,
} from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
  type Worker,
} from '@playwright/test';

/**
 * The voice link end to end: the real extension, the real bridge (bridge/host.mjs, started by
 * Chrome through native messaging) and a stand-in recorder on a Unix socket.
 */
const root = resolve(import.meta.dirname, '../..');
const extensionPath = resolve(root, 'dist-e2e');
const HOST = 'com.silverlightstudios.chrome_design.voice';

const PAGE = `<!doctype html><html><head><title>Voice</title><style>
  body { margin: 0; font: 16px system-ui; } h1 { font-size: 44px; margin: 40px; }
  button { font-size: 20px; margin: 0 40px; padding: 12px 20px; }
</style></head><body><h1 id="title">Checkout</h1><button id="pay">Pay now</button></body></html>`;

let server: Server;
let baseUrl = '';
let context: BrowserContext;
let worker: Worker;
let recorder: SocketServer;
let bridge: Socket | null = null;
const heard: Record<string, unknown>[] = [];
let outDir = '';

const say = (message: object) => bridge?.write(`${JSON.stringify(message)}\n`);

async function heardType(
  type: string,
  where: (m: Record<string, unknown>) => boolean = () => true,
) {
  await expect
    .poll(() => heard.some((m) => m.type === type && where(m)), { timeout: 20_000 })
    .toBe(true);
  return heard.find((m) => m.type === type && where(m))!;
}

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdv-'));
  const userData = join(dir, 'profile');
  const socketPath = join(dir, 'v.sock');
  outDir = join(dir, 'walkthroughs');
  mkdirSync(userData, { recursive: true });

  recorder = createSocketServer((socket) => {
    bridge = socket;
    socket.setEncoding('utf8');
    let pending = '';
    socket.on('data', (text: string) => {
      pending += text;
      for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
        const line = pending.slice(0, i).trim();
        pending = pending.slice(i + 1);
        if (line) heard.push(JSON.parse(line));
      }
    });
    say({ type: 'hello', app: 'Test recorder', protocol: 1 });
  });
  await new Promise<void>((r) => recorder.listen(socketPath, r));

  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  context = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
    env: {
      ...process.env,
      CHROME_DESIGN_VOICE_SOCKET: socketPath,
      CHROME_DESIGN_WALKTHROUGHS: outDir,
    },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  for (const p of context.pages()) if (p.url().includes('/options.html')) await p.close();

  // Register the bridge for this profile (what bridge/install.sh does for a real one).
  const id = new URL(worker.url()).host;
  const wrapper = join(dir, 'bridge.sh');
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec "${process.execPath}" "${resolve(root, 'bridge/host.mjs')}" "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  const hosts = join(userData, 'NativeMessagingHosts');
  mkdirSync(hosts, { recursive: true });
  writeFileSync(
    join(hosts, `${HOST}.json`),
    JSON.stringify({
      name: HOST,
      description: 'Chrome Design voice link (test)',
      path: wrapper,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`],
    }),
  );
  await worker.evaluate(() => chrome.storage.local.set({ 'voice:enabled': true }));
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
  recorder?.close();
});

test('the voice recorder starts and stops a walkthrough, and gets it back as files', async () => {
  // Chrome started the bridge; the bridge reached the recorder and passed on the hello.
  await heardType('hello');
  await expect
    .poll(() => worker.evaluate(() => chrome.storage.session.get('voice:status')), {
      timeout: 10_000,
    })
    .toMatchObject({ 'voice:status': { state: 'connected', app: 'Test recorder' } });

  const page: Page = await context.newPage();
  await page.goto(`${baseUrl}/voice`);
  await page.bringToFront();
  const ui = page.locator('chrome-design-root');
  const session = 'session-1';
  const audioStartedAt = Date.now() - 1500;
  say({
    type: 'recording.start',
    session,
    startedAt: audioStartedAt,
    app: 'Test recorder',
    onlyIfChromeInFront: false,
  });
  const started = await heardType('walkthrough.started', (m) => m.session === session);
  expect(started).toMatchObject({ origin: 'recorder', page: { title: 'Voice' } });
  await expect(ui.locator('.rec-time')).toBeVisible();

  // Circle the heading, click the button.
  const title = (await page.locator('#title').boundingBox())!;
  const cx = title.x + 120;
  const cy = title.y + title.height / 2;
  await page.mouse.move(cx + 140, cy);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  for (let i = 1; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    await page.mouse.move(cx + 140 * Math.cos(a), cy + 45 * Math.sin(a));
  }
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(700);
  await page.locator('#pay').click();
  say({ type: 'cue', session, at: Date.now(), word: 'here' });
  await page.waitForTimeout(800);

  say({ type: 'recording.stop', session, stoppedAt: Date.now() });
  await heardType('walkthrough.stopped', (m) => m.session === session && m.origin === 'recorder');
  const saved = (await heardType('walkthrough.saved', (m) => m.session === session)) as {
    dir: string;
    files: string[];
  };
  expect(saved.dir.startsWith(outDir)).toBe(true);
  expect(saved.files).toEqual(
    expect.arrayContaining([
      'summary.md',
      'walkthrough.json',
      'contact-sheet.jpg',
      'frames/frame-01.jpg',
    ]),
  );
  for (const f of saved.files) expect(existsSync(join(saved.dir, f))).toBe(true);
  const wt = JSON.parse(readFileSync(join(saved.dir, 'walkthrough.json'), 'utf8'));
  expect(wt.session).toMatchObject({
    id: session,
    app: 'Test recorder',
    audioStartedAtMs: audioStartedAt,
  });
  expect(wt.events.some((e: { kind: string }) => e.kind === 'cue')).toBe(true);
  expect(readFileSync(join(saved.dir, 'summary.md'), 'utf8')).toContain(
    'circled Heading “Checkout”',
  );

  // The recorder sends what was said back: the panel shows it, lined up by clock.
  say({
    type: 'transcript',
    session,
    app: 'Test recorder',
    transcript: {
      kind: 'chrome-design.transcript',
      startedAtMs: audioStartedAt,
      segments: [{ t0: 1600, t1: 2600, text: 'This heading is wrong.' }],
    },
  });
  const panel = ui.locator('.walkthrough-panel');
  await expect(panel.locator('.wt-sent')).toContainText('Sent to Test recorder');
  await expect(panel.locator('.wt-voice')).toContainText('Test recorder');
  await expect(panel.locator('.dial')).toHaveCount(0);

  // Started in Chrome instead: the recorder hears about it (and could start recording).
  await page.keyboard.press('w');
  await heardType('walkthrough.started', (m) => m.origin === 'extension');
  await ui.locator('.tb-btn[aria-label^="Stop"]').click();
  await heardType('walkthrough.saved', (m) => m.session !== session);
  await page.close();
});
