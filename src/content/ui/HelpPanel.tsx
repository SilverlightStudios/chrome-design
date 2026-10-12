const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Tools',
    rows: [
      ['V', 'Inspect: hover to measure, click to select, drag for a region'],
      ['C', 'Comment: click to pin a comment to an element'],
      ['D', 'Draw (P pen · L line · A arrow · R rect · O ellipse · T text · E eraser)'],
      ['M', 'Toggle rulers — drag from a ruler to add a guide'],
      ['G', 'Toggle layout grid'],
      ['F', 'Feedback list'],
      ['⇧E', 'Export the AI handoff file'],
      ['Esc', 'Cancel · deselect · back to Inspect · pause tools'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      [`${mod}Z`, 'Undo'],
      [`⇧${mod}Z`, 'Redo'],
      ['⌫', 'Delete selected drawing or comment'],
      ['Arrows', 'Nudge selected drawing (⇧ = 10px)'],
      ['↑ / ↓', 'Inspect: select parent / first child'],
      ['Enter', 'Inspect: comment on selected element'],
      ['⇧ drag', 'Constrain lines to 45° and shapes to squares'],
      [`${mod}Enter`, 'Save comment'],
      ['⌥⇧D', 'Open / close Chrome Design'],
    ],
  },
];

export function HelpPanel() {
  return (
    <div className="panel help-panel" role="dialog" aria-label="Keyboard shortcuts">
      <div className="panel-head">
        <h2>Shortcuts</h2>
      </div>
      {SECTIONS.map((section) => (
        <section key={section.title}>
          <h3>{section.title}</h3>
          <dl className="kbd-list">
            {section.rows.map(([k, v]) => (
              <div key={k + v}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="muted small">
        Annotations are saved in this browser per page URL and never leave your machine until you
        export.
      </p>
    </div>
  );
}
