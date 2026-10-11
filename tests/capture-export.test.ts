// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/landing"}
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import { capturePage } from '../src/capture/capture';
import { buildHandoff } from '../src/export/build';
import { unescapeScriptText } from '../src/shared/escape';
import { SCHEMA_VERSION } from '../src/shared/model';
import { handoffSchema } from '../src/shared/schema';
import { AT, fakeFetcher, sampleDoc } from './helpers';

const PAGE_URL = 'https://example.com/landing';

function setupPage() {
  document.open();
  document.write(`<!DOCTYPE html><html lang="en"><head>
    <title>Fixture page</title>
    <meta http-equiv="refresh" content="0;url=https://evil.example">
    <base href="https://example.com/">
    <link rel="stylesheet" href="https://example.com/site.css">
    <link rel="stylesheet" href="https://cdn.other.com/blocked.css">
    <style>.hero{min-height:100vh;background:url(/img/bg.png)}</style>
    <script>window.evil = 1</script>
  </head><body onload="alert(1)">
    <main class="hero"><h1 id="hero-title" onclick="steal()">Welcome</h1>
      <a href="javascript:alert(1)">bad link</a>
      <a href="/pricing">pricing</a>
      <img src="/img/logo.png" srcset="/img/logo@2x.png 2x" alt="Logo">
      <img src="https://cdn.other.com/missing.png" alt="Missing">
      <input id="email" value="old"><input type="password" id="pw">
      <iframe src="https://maps.example/embed"></iframe>
      <svg><a href="javascript:alert(2)"><text>x</text></a><script>alert(3)</script></svg>
      <noscript>Enable JS</noscript>
    </main>
    <chrome-design-root id="cd-host"></chrome-design-root>
  </body></html>`);
  document.close();
  (document.getElementById('email') as HTMLInputElement).value = 'designer@example.com';
  (document.getElementById('pw') as HTMLInputElement).value = 'hunter2';
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.localName === 'iframe') return { x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150, toJSON() {} } as DOMRect;
    return original.call(this);
  };
}

const fetchers = [
  fakeFetcher({
    'https://example.com/site.css': { body: 'body{color:#111;padding-top:10vh}.logo{background:url(img/icon.svg)}', mime: 'text/css' },
    'https://example.com/img/bg.png': { body: 'PNGDATA', mime: 'image/png' },
    'https://example.com/img/logo.png': { body: 'LOGO', mime: 'image/png' },
    'https://example.com/img/icon.svg': { body: '<svg/>', mime: 'image/svg+xml' },
  }),
];

describe('capture → export pipeline', () => {
  let snapshot = '';
  let result: Awaited<ReturnType<typeof capturePage>>;

  beforeAll(async () => {
    setupPage();
    result = await capturePage({
      skip: (n) => n instanceof Element && n.id === 'cd-host',
      anchors: [(sampleDoc(PAGE_URL).annotations[0] as { target: { anchor: never } }).target.anchor],
      fetchers,
      includeSource: true,
      shadowRootOf: (el) => el.shadowRoot,
    });
    snapshot = result.capture.snapshotHtml;
  });

  it('removes scripts, handlers, javascript: urls, refresh/base and noscript', () => {
    expect(snapshot).not.toMatch(/<script/i);
    expect(snapshot).not.toMatch(/\son\w+=/i);
    expect(snapshot).not.toContain('javascript:');
    expect(snapshot).not.toContain('http-equiv');
    expect(snapshot).not.toMatch(/<base/i);
    expect(snapshot).not.toContain('Enable JS');
    expect(result.capture.sanitize.scripts).toBe(2);
    expect(result.capture.sanitize.eventHandlers).toBe(2);
    expect(result.capture.sanitize.javascriptUrls).toBe(2);
  });

  it('excludes the extension UI from snapshot and source', () => {
    expect(snapshot).not.toContain('chrome-design-root');
    expect(result.capture.sourceHtml).not.toContain('chrome-design-root');
    expect(result.capture.sourceHtml).toContain('window.evil'); // source is preserved verbatim
  });

  it('inlines stylesheets, assets and rewrites viewport units', () => {
    expect(snapshot).toContain('data-cd-from="https://example.com/site.css"');
    expect(snapshot).toContain(`padding-top:${Math.round(result.capture.meta.viewport.height * 10) / 100}px`);
    expect(snapshot).toContain(`url("data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}")`);
    expect(snapshot).toContain(`src="data:image/png;base64,${Buffer.from('LOGO').toString('base64')}"`);
    expect(snapshot).not.toContain('logo@2x');
    expect(snapshot).toContain('href="https://example.com/pricing"');
  });

  it('reflects live form state without leaking passwords', () => {
    expect(snapshot).toContain('value="designer@example.com"');
    expect(snapshot).not.toContain('hunter2');
  });

  it('replaces frames with placeholders and warns about missing assets', () => {
    expect(snapshot).toContain('data-cd-placeholder="iframe"');
    const codes = result.capture.warnings.map((w) => `${w.code}:${w.url ?? ''}`);
    expect(codes).toContain('asset-not-embedded:https://cdn.other.com/missing.png');
    expect(codes).toContain('stylesheet-unreadable:https://cdn.other.com/blocked.css');
    expect(codes).toContain('frame-not-captured:https://maps.example/embed');
  });

  it('stamps annotation anchors with data-cd-ref', () => {
    expect(result.refs.get('#hero-title')).toBe('cd-1');
    expect(snapshot).toMatch(/<h1 id="hero-title" data-cd-ref="cd-1">/);
  });

  it('builds one self-contained HTML file with prompt, schema-valid payload and recoverable blocks', async () => {
    const doc = sampleDoc(PAGE_URL);
    const out = await buildHandoff({ capture: result.capture, doc, refs: result.refs, exportedAt: AT });
    const parsed = new DOMParser().parseFromString(out.html, 'text/html');

    // Prominent agent prompt
    const prompt = parsed.getElementById('agent-prompt')?.textContent ?? '';
    expect(prompt).toContain('Read EVERY comment thread and decision');
    expect(prompt).toContain('Revise the snapshot HTML');
    expect(out.html.indexOf('AGENT INSTRUCTIONS')).toBeLessThan(200);

    // Payload validates against the embedded schema
    const payload = JSON.parse(parsed.getElementById('chrome-design-payload')?.textContent ?? '');
    const schema = JSON.parse(parsed.getElementById('chrome-design-schema')?.textContent ?? '');
    expect(schema).toEqual(JSON.parse(JSON.stringify(handoffSchema)));
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const valid = ajv.validate(schema, payload);
    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(payload.schemaVersion).toBe(SCHEMA_VERSION);
    expect(payload.summary).toMatchObject({ comments: 2, decisions: 1, shapes: 2, openComments: 2 });
    expect(payload.annotations[0].target.anchor.ref).toBe('cd-1');

    // Snapshot and source are recoverable byte-for-byte
    const snapText = parsed.getElementById('chrome-design-snapshot')?.textContent ?? '';
    expect(unescapeScriptText(snapText)).toBe(result.capture.snapshotHtml);
    const source = JSON.parse(parsed.getElementById('chrome-design-source')?.textContent ?? '""');
    expect(source).toBe(result.capture.sourceHtml);

    // Comment text with markup is escaped, never live
    expect(parsed.querySelectorAll('script').length).toBe(5);
    expect(parsed.getElementById('change-1')?.textContent).toContain('</script> bolder');

    // Strict CSP with a hash for the single inline script
    const csp = parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    const inline = parsed.querySelector('script:not([type])')?.textContent ?? '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inline));
    const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(csp).toContain(`'sha256-${hash}'`);
    expect(inline).not.toMatch(/<\/script|<!--/i);

    // Snapshot iframe is sandboxed without scripts; overlay has pins
    const frame = parsed.querySelector('iframe[data-cd-frame]');
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(parsed.querySelectorAll('.cd-pin').length).toBe(2);
    expect(parsed.querySelectorAll('.cd-shape').length).toBe(2);
    expect(out.filename).toMatch(/^chrome-design-example\.com-\d{8}-\d{4}\.html$/);
  });
});
