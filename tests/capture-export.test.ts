// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/landing"}
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import { capturePage } from '../src/capture/capture';
import { buildHandoff } from '../src/export/build';
import { type CommentThread, SCHEMA_VERSION } from '../src/shared/model';
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
    if (this.localName === 'iframe')
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 300,
        bottom: 150,
        width: 300,
        height: 150,
        toJSON() {},
      } as DOMRect;
    return original.call(this);
  };
}

const fetchers = [
  fakeFetcher({
    'https://example.com/site.css': {
      body: 'body{color:#111;padding-top:10vh}.logo{background:url(img/icon.svg)}',
      mime: 'text/css',
    },
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
      anchors: [
        (sampleDoc(PAGE_URL).annotations[0] as CommentThread & { target: { type: 'element' } })
          .target.anchor,
      ],
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
    expect(snapshot).toContain(
      `padding-top:${Math.round(result.capture.meta.viewport.height * 10) / 100}px`,
    );
    expect(snapshot).toContain(
      `url("data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}")`,
    );
    expect(snapshot).toContain(
      `src="data:image/png;base64,${Buffer.from('LOGO').toString('base64')}"`,
    );
    expect(snapshot).not.toContain('logo@2x');
    expect(snapshot).toContain('href="https://example.com/pricing"');
  });

  it('never references un-embeddable remote assets from the rendered snapshot', () => {
    expect(snapshot).toContain('data-cd-original-src="https://cdn.other.com/missing.png"');
    expect(snapshot).not.toMatch(/\ssrc="https?:/);
    expect(snapshot).not.toMatch(/url\("https?:/);
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

  it('builds the page itself as one shareable file: prompt, valid payload, static layer, toolbar', async () => {
    const doc = sampleDoc(PAGE_URL);
    const runtime = 'window.__cdTest = "</script> and <!-- stay inert";';
    const out = await buildHandoff({
      capture: result.capture,
      doc,
      refs: result.refs,
      exportedAt: AT,
      runtime,
    });
    const parsed = new DOMParser().parseFromString(out.html, 'text/html');

    // The agent instructions come first, in a comment, with the feedback spelled out
    expect(out.html.indexOf('AGENT INSTRUCTIONS')).toBeLessThan(300);
    const prompt = out.payload.agentPrompt;
    expect(prompt).toContain('Read EVERY comment thread and decision');
    expect(prompt).toContain('scratch board');
    expect(prompt).toContain('PLACED IMAGES');
    expect(out.html).toContain('PLACED IMAGE images/placed-01-hero-mockup.png');
    expect(out.html).toContain('[attached image images/comment-02-1-brand.png');

    // The document is the page: marked as a handoff and held at the reviewed width
    expect(parsed.documentElement.getAttribute('data-chrome-design-handoff')).toBe(SCHEMA_VERSION);
    expect(parsed.getElementById('hero-title')?.textContent).toBe('Welcome');
    expect(out.html).toContain(`html{width:${result.capture.meta.viewport.width}px!important`);

    // Strip the marked wrapper and the root attribute: the page snapshot, byte for byte
    const begin = out.payload.blocks.snapshot.markers.begin;
    const end = out.payload.blocks.snapshot.markers.end;
    let clean = out.html;
    for (let i = clean.indexOf(begin); i !== -1; i = clean.indexOf(begin)) {
      clean = clean.slice(0, i) + clean.slice(clean.indexOf(end, i) + end.length);
    }
    clean = clean.replace(` data-chrome-design-handoff="${SCHEMA_VERSION}"`, '');
    expect(clean).toBe(result.capture.snapshotHtml);

    // Payload validates against the embedded schema and indexes every picture
    const payload = JSON.parse(parsed.getElementById('chrome-design-payload')?.textContent ?? '');
    const schema = JSON.parse(parsed.getElementById('chrome-design-schema')?.textContent ?? '');
    expect(schema).toEqual(JSON.parse(JSON.stringify(handoffSchema)));
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const valid = ajv.validate(schema, payload);
    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(payload.schemaVersion).toBe(SCHEMA_VERSION);
    expect(payload.summary).toMatchObject({
      comments: 2,
      decisions: 1,
      shapes: 3,
      images: 2,
      openComments: 2,
    });
    expect(payload.images.map((i: { file: string }) => i.file)).toEqual([
      'images/placed-01-hero-mockup.png',
      'images/comment-02-1-brand.png',
    ]);
    expect(payload.annotations[0].target.anchor.ref).toBe('cd-1');
    const source = JSON.parse(parsed.getElementById('chrome-design-source')?.textContent ?? '""');
    expect(source).toBe(result.capture.sourceHtml);

    // Without JavaScript: pins, drawings, the placed image and the comment list over the page
    const layer = parsed.querySelector('chrome-design-static > template')?.innerHTML ?? '';
    expect(layer.match(/class="cd-pin"/g)?.length).toBe(2);
    expect(layer.match(/class="cd-shape"/g)?.length).toBe(3);
    expect(layer).toMatch(/<image class="cd-shape"[^>]*href="data:image\/png/);
    expect(layer).toContain('2 comments');
    expect(layer).toContain('&lt;/script&gt; bolder');

    // Data blocks, then the built-in toolbar, allowed by hash and nothing else
    const scripts = Array.from(parsed.querySelectorAll('script')).map((el) => el.id);
    expect(scripts).toEqual([
      'chrome-design-payload',
      'chrome-design-schema',
      'chrome-design-source',
      'chrome-design-runtime',
    ]);
    const inline = parsed.getElementById('chrome-design-runtime')?.textContent ?? '';
    expect(inline).not.toMatch(/<\/script|<!--/i);
    const csp =
      parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ??
      '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inline));
    const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(csp).toContain(`script-src 'sha256-${hash}'`);
    expect(out.filename).toMatch(/^chrome-design-example\.com-\d{8}-\d{4}\.html$/);

    // Without a runtime: still the page and the feedback, and no script may run
    const bare = await buildHandoff({ capture: result.capture, doc, exportedAt: AT });
    const bareDoc = new DOMParser().parseFromString(bare.html, 'text/html');
    expect(
      bareDoc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
    ).toContain("script-src 'none'");
    expect(bare.html).not.toContain('id="chrome-design-runtime"');
  });
});
