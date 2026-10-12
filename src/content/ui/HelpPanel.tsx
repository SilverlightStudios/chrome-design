import { PanelHead } from './PanelHead';

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Tools',
    rows: [
      ['V', 'Select'],
      ['C', 'Comment'],
      ['P', 'Pencil'],
      ['R O A L', 'Rectangle · Ellipse · Arrow · Line'],
      ['T', 'Text'],
      [`⇧${mod}K`, 'Place an image (or drop / paste one)'],
      ['E', 'Eraser'],
      ['⇧E', 'Send to AI'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      [`${mod}Z`, 'Undo'],
      [`⇧${mod}Z`, 'Redo'],
      ['⌫', 'Delete the selected drawing or comment'],
      ['Arrows', 'Nudge a drawing (⇧ for 10)'],
      ['⇧ drag', 'Straight lines and perfect squares'],
      ['⌥ hover', 'Show spacing between things'],
      ['↵', 'Post a comment · ⇧↵ new line'],
      ['Esc', 'Step back · pause so the page works normally'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['F', 'Comments'],
      ['M', 'Rulers'],
      ['G', 'Columns'],
      ['⌥⇧D', 'Open or close Chrome Design'],
    ],
  },
];

export function HelpPanel() {
  return (
    <div className="panel help-panel">
      <PanelHead title="Keyboard shortcuts" />
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
    </div>
  );
}
