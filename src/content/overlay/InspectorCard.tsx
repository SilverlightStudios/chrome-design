import { buildAnchor, describeElement, uniqueSelector } from '../../capture/anchor';
import { useEditor, useEnv, useViewport } from '../context';
import { copyText, rgbToHex, toPage } from '../dom';
import { Icon } from '../ui/icons';

function shorthand(cs: CSSStyleDeclaration, prop: 'margin' | 'padding'): string {
  const vals = ['Top', 'Right', 'Bottom', 'Left'].map((side) =>
    cs.getPropertyValue(`${prop}-${side.toLowerCase()}`),
  );
  const n = vals.map((v) => String(Math.round(Number.parseFloat(v) || 0)));
  if (n.every((v) => v === n[0])) return n[0]!;
  if (n[0] === n[2] && n[1] === n[3]) return `${n[0]} ${n[1]}`;
  return n.join(' ');
}

function Swatch({ color }: { color: string }) {
  const { toast } = useEnv();
  const hex = rgbToHex(color);
  return (
    <button
      type="button"
      className="color-value"
      title="Copy"
      onClick={() => {
        void copyText(hex).then((ok) => toast(ok ? `Copied ${hex}` : hex));
      }}
    >
      <span className="dot" style={{ background: color }} />
      {hex}
    </button>
  );
}

/** Details for the element picked with the Inspect tool. */
export function InspectorCard() {
  useViewport();
  const env = useEnv();
  const { store } = env;
  const pickedEl = useEditor((s) => s.pickedEl);
  const tool = useEditor((s) => s.tool);
  const rulers = useEditor((s) => s.rulers);
  if (!pickedEl?.isConnected || tool !== 'select') return null;

  const cs = getComputedStyle(pickedEl);
  const r = pickedEl.getBoundingClientRect();
  const family = cs.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '';
  const parent = pickedEl.parentElement;
  const child = pickedEl.firstElementChild;
  const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
  const hasBorder = Number.parseFloat(cs.borderTopWidth) > 0;

  const comment = () => {
    const anchor = buildAnchor(pickedEl);
    const p = toPage(r.left + Math.min(16, r.width / 2), r.top + Math.min(16, r.height / 2));
    store.set({ draft: { target: { type: 'element', point: p, anchor } }, openThreadId: null });
  };

  return (
    <aside
      className="inspector ui"
      aria-label="Element inspector"
      style={{ top: rulers ? 32 : 12 }}
    >
      <header>
        <code className="el-name" title={uniqueSelector(pickedEl)}>
          {describeElement(pickedEl)}
        </code>
        <button
          type="button"
          className="icon-btn"
          aria-label="Deselect"
          onClick={() => store.set({ pickedEl: null })}
        >
          <Icon.close />
        </button>
      </header>
      <dl>
        <dt>Size</dt>
        <dd>
          {Math.round(r.width)} × {Math.round(r.height)}
        </dd>
        <dt>Position</dt>
        <dd>
          {Math.round(r.left + window.scrollX)}, {Math.round(r.top + window.scrollY)}
        </dd>
        <dt>Padding</dt>
        <dd>{shorthand(cs, 'padding')}</dd>
        <dt>Margin</dt>
        <dd>{shorthand(cs, 'margin')}</dd>
        {cs.borderRadius !== '0px' && (
          <>
            <dt>Radius</dt>
            <dd>{cs.borderRadius}</dd>
          </>
        )}
        {cs.display.includes('flex') || cs.display.includes('grid') ? (
          <>
            <dt>Layout</dt>
            <dd>
              {cs.display}
              {cs.gap !== 'normal' ? ` · gap ${cs.gap}` : ''}
            </dd>
          </>
        ) : null}
        <dt>Font</dt>
        <dd title={cs.fontFamily}>
          {family} · {cs.fontWeight}
        </dd>
        <dt>Text</dt>
        <dd>
          {cs.fontSize} / {cs.lineHeight}
        </dd>
        <dt>Color</dt>
        <dd>
          <Swatch color={cs.color} />
        </dd>
        {hasBg && (
          <>
            <dt>Fill</dt>
            <dd>
              <Swatch color={cs.backgroundColor} />
            </dd>
          </>
        )}
        {hasBorder && (
          <>
            <dt>Border</dt>
            <dd>
              {cs.borderTopWidth} {cs.borderTopStyle} <Swatch color={cs.borderTopColor} />
            </dd>
          </>
        )}
      </dl>
      <footer>
        <button type="button" className="btn primary" onClick={comment}>
          <Icon.comment /> Comment <kbd>↵</kbd>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Select parent"
          data-tip="Parent ↑"
          disabled={!parent || parent === document.documentElement}
          onClick={() => parent && store.set({ pickedEl: parent })}
        >
          <Icon.parent />
        </button>
        <button
          type="button"
          className="icon-btn flip"
          aria-label="Select first child"
          data-tip="Child ↓"
          disabled={!child}
          onClick={() => child && store.set({ pickedEl: child })}
        >
          <Icon.parent />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Copy selector"
          data-tip="Copy selector"
          onClick={() => {
            const sel = uniqueSelector(pickedEl);
            void copyText(sel).then((ok) => env.toast(ok ? `Copied ${sel}` : sel));
          }}
        >
          <Icon.copy />
        </button>
      </footer>
    </aside>
  );
}
