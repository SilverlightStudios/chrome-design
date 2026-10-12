import type { ElementAnchor } from '../shared/model';

/*
 * Plain-language names for page elements, for designers rather than developers:
 * "Button “Start free”" instead of `main > form.signup > button.btn`. Selectors still go
 * into the export for the AI agent; the UI only ever shows these names.
 */

const ROLE_NAMES: Record<string, string> = {
  button: 'Button',
  link: 'Link',
  img: 'Image',
  image: 'Image',
  heading: 'Heading',
  navigation: 'Navigation',
  dialog: 'Dialog',
  alertdialog: 'Dialog',
  tab: 'Tab',
  tablist: 'Tabs',
  checkbox: 'Checkbox',
  radio: 'Option',
  switch: 'Switch',
  textbox: 'Field',
  searchbox: 'Search field',
  combobox: 'Dropdown',
  listbox: 'List',
  list: 'List',
  listitem: 'List item',
  menu: 'Menu',
  menuitem: 'Menu item',
  banner: 'Header',
  contentinfo: 'Footer',
  main: 'Main area',
  region: 'Section',
  article: 'Card',
  figure: 'Figure',
  table: 'Table',
  slider: 'Slider',
  progressbar: 'Progress bar',
  tooltip: 'Tooltip',
};

const TAG_NAMES: Record<string, string> = {
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  p: 'Text',
  span: 'Text',
  small: 'Text',
  strong: 'Text',
  b: 'Text',
  em: 'Text',
  i: 'Text',
  label: 'Label',
  blockquote: 'Quote',
  code: 'Code',
  pre: 'Code',
  a: 'Link',
  button: 'Button',
  img: 'Image',
  picture: 'Image',
  video: 'Video',
  audio: 'Audio',
  canvas: 'Graphic',
  iframe: 'Embed',
  input: 'Field',
  textarea: 'Text box',
  select: 'Dropdown',
  form: 'Form',
  nav: 'Navigation',
  header: 'Header',
  footer: 'Footer',
  main: 'Main area',
  section: 'Section',
  article: 'Card',
  aside: 'Sidebar',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  table: 'Table',
  tr: 'Table row',
  td: 'Table cell',
  th: 'Table cell',
  figure: 'Figure',
  figcaption: 'Caption',
  dialog: 'Dialog',
  details: 'Disclosure',
  summary: 'Disclosure title',
  hr: 'Divider',
  body: 'Page',
  html: 'Page',
};

function hasOwnText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.nodeValue ?? '').trim()) return true;
  }
  return false;
}

/** A short noun for what the element is. */
export function friendlyName(el: Element): string {
  const role = el.getAttribute('role')?.split(/\s+/)[0]?.toLowerCase();
  if (role && ROLE_NAMES[role]) return ROLE_NAMES[role]!;
  const tag = el.localName.toLowerCase();
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (type === 'button' || type === 'submit' || type === 'reset') return 'Button';
    if (type === 'checkbox') return 'Checkbox';
    if (type === 'radio') return 'Option';
    if (type === 'range') return 'Slider';
    if (type === 'search') return 'Search field';
    if (type === 'image') return 'Button';
    return 'Field';
  }
  if (tag === 'svg') {
    const r = el.getBoundingClientRect();
    return Math.max(r.width, r.height) <= 40 ? 'Icon' : 'Graphic';
  }
  if (TAG_NAMES[tag]) return TAG_NAMES[tag]!;
  if (el.namespaceURI === 'http://www.w3.org/2000/svg') return 'Graphic';
  if (tag.includes('-')) return hasOwnText(el) ? 'Text' : 'Component';
  // Generic containers: text, picture boxes or groups.
  if (hasOwnText(el)) return 'Text';
  const view = el.ownerDocument.defaultView;
  const cs = view?.getComputedStyle(el);
  if (cs?.backgroundImage && cs.backgroundImage !== 'none' && el.children.length === 0)
    return 'Image';
  return el.children.length > 0 ? 'Group' : 'Box';
}

function excerpt(text: string, max = 30): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** What the element says or shows, if anything useful. */
export function friendlyContent(el: Element): string {
  const tag = el.localName.toLowerCase();
  const aria = el.getAttribute('aria-label');
  if (aria) return excerpt(aria);
  if (tag === 'img') return excerpt((el as HTMLImageElement).alt || '');
  if (tag === 'input' || tag === 'textarea') {
    const input = el as HTMLInputElement;
    return excerpt(input.placeholder || input.value || '');
  }
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  return excerpt(text);
}

/** `Button “Start free”`, `Heading “Notes that stay calm…”`, or just `Group`. */
export function friendlyLabel(el: Element): string {
  const name = friendlyName(el);
  const content = name === 'Page' ? '' : friendlyContent(el);
  return content ? `${name} “${content}”` : name;
}

/** Same naming for a stored anchor (the element may no longer exist). */
export function friendlyAnchorLabel(anchor: ElementAnchor): string {
  const role = anchor.role?.toLowerCase();
  const tag = anchor.tagName.toLowerCase();
  const name =
    (role && ROLE_NAMES[role]) ||
    TAG_NAMES[tag] ||
    (tag === 'svg' ? 'Graphic' : anchor.text ? 'Text' : 'Group');
  const content = anchor.ariaLabel || anchor.text || '';
  const short = excerpt(content);
  return short && name !== 'Page' ? `${name} “${short}”` : name;
}
