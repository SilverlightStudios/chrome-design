// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fieldName, targetOf } from '../src/content/walkthrough/targets';

const el = (id: string) => document.getElementById(id)!;

describe('walkthroughs never record what was typed', () => {
  it('names a field by its label, placeholder or name, not its value', () => {
    document.body.innerHTML = `
      <label>Email <input id="a" value="jane@x.io"></label>
      <input id="b" placeholder="Search notes" value="salary">
      <input id="c" name="card" value="4242 4242 4242 4242">
      <textarea id="d" aria-label="Message">private words</textarea>
      <input id="e" type="checkbox" aria-label="Remember me">
      <button id="f">Start free</button>`;
    expect(fieldName(el('a'))).toBe('Field “Email”');
    expect(fieldName(el('b'))).toBe('Field “Search notes”');
    expect(fieldName(el('c'))).toBe('Field “card”');
    expect(fieldName(el('d'))).toBe('Text box “Message”');
    expect(fieldName(el('e'))).toBe('Checkbox “Remember me”');
    const all = ['a', 'b', 'c', 'd'].map((id) => JSON.stringify(targetOf(el(id)))).join(' ');
    for (const secret of ['jane@x.io', 'salary', '4242', 'private words'])
      expect(all).not.toContain(secret);
    expect(targetOf(el('f'))?.label).toBe('Button “Start free”');
  });
});
