import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  escapeScriptText,
  jsonForScript,
  unescapeScriptText,
} from '../src/shared/escape';

describe('script text escaping', () => {
  const samples = [
    '<p>hello</p>',
    '<script>alert(1)</script>',
    'a </SCRIPT> b <!-- c --> d',
    'tricky <\\/script> and <\\\\!-- already escaped',
    '<style>a::before{content:"</script>"}</style>',
    '',
  ];

  it.each(samples)('round-trips %j', (sample) => {
    expect(unescapeScriptText(escapeScriptText(sample))).toBe(sample);
  });

  it('never leaves a closing script tag or comment opener', () => {
    for (const sample of samples) {
      const escaped = escapeScriptText(sample);
      expect(escaped).not.toMatch(/<\/script/i);
      expect(escaped).not.toMatch(/<!--/);
    }
  });
});

describe('jsonForScript', () => {
  it('cannot close the script element and parses back to the same value', () => {
    const value = {
      html: '</script><script>alert(1)</script>',
      amp: 'a&b',
      ls: '\u2028\u2029',
      n: 1,
    };
    const text = jsonForScript(value);
    expect(text).not.toMatch(/<\/script/i);
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual(value);
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
