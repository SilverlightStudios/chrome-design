import { describe, expect, it } from 'vitest';
import {
  extractCssUrls,
  extractImports,
  rewriteCssUrls,
  rewriteDeclarations,
  rewriteViewportUnits,
  simplifyFontFaceSources,
} from '../src/capture/css';

const base = 'https://example.com/assets/site.css';

describe('css url handling', () => {
  it('extracts absolute urls and skips data/fragment urls', () => {
    const css = `a{background:url(img/a.png)} b{background:url("/b.svg#x")} c{mask:url('#m')} d{background:url(data:image/png;base64,AAAA)}`;
    expect(extractCssUrls(css, base)).toEqual([
      'https://example.com/assets/img/a.png',
      'https://example.com/b.svg#x',
    ]);
  });

  it('rewrites urls to embedded data or absolute form', () => {
    const assets = new Map([
      ['https://example.com/assets/img/a.png', 'data:image/png;base64,QQ=='],
    ]);
    const out = rewriteCssUrls(
      'a{background:url(img/a.png)} b{background:url(../c.jpg)} x{f:url(javascript:alert(1))}',
      base,
      assets,
    );
    expect(out).toContain('url("data:image/png;base64,QQ==")');
    expect(out).toContain('url("https://example.com/c.jpg")');
    expect(out).not.toContain('javascript:');
  });

  it('finds @import statements with conditions', () => {
    const imports = extractImports(
      '@import url("theme.css") screen;\n@import "print.css" print;',
      base,
    );
    expect(imports.map((i) => [i.url, i.condition])).toEqual([
      ['https://example.com/assets/theme.css', 'screen'],
      ['https://example.com/assets/print.css', 'print'],
    ]);
  });
});

describe('font-face simplification', () => {
  it('keeps only the woff2 source', () => {
    const css = `@font-face{font-family:X;src:url(a.eot);src:url(a.woff2) format("woff2"),url(a.woff) format("woff"),url(a.ttf) format("truetype")}`;
    const out = simplifyFontFaceSources(css);
    expect(out).toContain('src: url(a.woff2) format("woff2")');
    expect(out).not.toContain('a.ttf');
  });
});

describe('viewport units', () => {
  const vp = { width: 1200, height: 800 };

  it('rewrites vh/dvh/vw/vmin in declarations', () => {
    const out = rewriteViewportUnits(
      '.hero{min-height:100vh;height:50dvh;width:10vw;padding:5vmin}',
      vp,
    );
    expect(out).toBe('.hero{min-height:800px;height:400px;width:120px;padding:40px}');
  });

  it('does not touch selectors or class-like tokens', () => {
    const css = '.h-\\[100vh\\]{height:100vh}.mt-10vh{margin-top:10vh}';
    expect(rewriteViewportUnits(css, vp)).toBe(
      '.h-\\[100vh\\]{height:800px}.mt-10vh{margin-top:80px}',
    );
  });

  it('handles nested at-rules and inline style declarations', () => {
    expect(
      rewriteViewportUnits('@media (min-width:600px){.a{height:calc(100vh - 64px)}}', vp),
    ).toBe('@media (min-width:600px){.a{height:calc(800px - 64px)}}');
    expect(rewriteDeclarations('height: 100svh; color: red', vp)).toBe('height: 800px; color: red');
  });
});
