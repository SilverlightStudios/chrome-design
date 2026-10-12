/**
 * Media queries, frozen to the designer's screen. The handoff file shows the page at the width
 * it was reviewed at, whatever window it's opened in, so drawings and pins stay on what they
 * point at. Capture records how every media query evaluated on the designer's screen; the file
 * then forces each one to that answer (the stored CSS keeps its original queries, so the page
 * code an AI agent revises stays responsive).
 */

export type MediaAnswers = Record<string, boolean>;

interface RuleWithMedia {
  media: MediaList;
}

function hasMedia(rule: CSSRule): rule is CSSRule & RuleWithMedia {
  return 'media' in rule && (rule as Partial<RuleWithMedia>).media instanceof Object;
}

function children(rule: CSSRule): CSSRuleList | null {
  return 'cssRules' in rule ? ((rule as CSSGroupingRule).cssRules ?? null) : null;
}

function eachMediaRule(rules: CSSRuleList, visit: (rule: CSSRule & RuleWithMedia) => void): void {
  for (const rule of Array.from(rules)) {
    if (hasMedia(rule) && rule.constructor.name !== 'CSSImportRule') visit(rule);
    const inner = children(rule);
    if (inner) eachMediaRule(inner, visit);
  }
}

/** Every media query in these stylesheets (and media attributes), with its answer right now. */
export function recordMediaAnswers(
  cssTexts: Iterable<string>,
  attributeQueries: Iterable<string> = [],
  matches: (query: string) => boolean = (q) => window.matchMedia(q).matches,
): MediaAnswers {
  const answers: MediaAnswers = {};
  const note = (query: string) => {
    const q = query.trim();
    if (!q || q === 'all' || q in answers) return;
    try {
      answers[q] = matches(q);
    } catch {
      // unparseable query: leave it to the browser
    }
  };
  for (const query of attributeQueries) note(query);
  if (typeof CSSStyleSheet === 'undefined') return answers;
  for (const text of cssTexts) {
    if (!/@media/i.test(text)) continue;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      eachMediaRule(sheet.cssRules, (rule) => note(rule.media.mediaText));
    } catch {
      // a sheet the engine can't parse standalone; its queries stay live
    }
  }
  return answers;
}

function freezeList(list: MediaList, answers: MediaAnswers): boolean {
  const answer = answers[list.mediaText.trim()];
  if (answer === undefined) return false;
  list.mediaText = answer ? 'all' : 'not all';
  return true;
}

/**
 * Force every recorded media query in the document (and open shadow roots) to the designer's
 * answer. Returns how many were frozen.
 */
export function freezeMediaQueries(doc: Document, answers: MediaAnswers): number {
  if (Object.keys(answers).length === 0) return 0;
  let frozen = 0;
  const sheets: CSSStyleSheet[] = Array.from(doc.styleSheets);
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const root = (node as Element).shadowRoot;
    if (root) sheets.push(...Array.from(root.styleSheets), ...root.adoptedStyleSheets);
  }
  for (const sheet of sheets) {
    try {
      if (sheet.media.length && freezeList(sheet.media, answers)) frozen++;
      eachMediaRule(sheet.cssRules, (rule) => {
        if (freezeList(rule.media, answers)) frozen++;
      });
    } catch {
      // unreadable sheet
    }
  }
  return frozen;
}
