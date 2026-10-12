import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { isComment, PALETTE } from '../../shared/model';
import { useEditor, useEnv } from '../context';
import { capturePointer } from '../dom';
import { loadUiPrefs, saveUiPrefs } from '../persistence';
import type { DrawToolId, PanelId, ToolId } from '../store';
import { ExportPanel } from './ExportPanel';
import { FeedbackPanel } from './FeedbackPanel';
import { GridPanel } from './GridPanel';
import { HelpPanel } from './HelpPanel';
import { Icon, type IconName } from './icons';

interface ButtonProps {
  icon: IconName;
  label: string;
  kbd?: string;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  onClick: () => void;
}

export function ToolButton({ icon, label, kbd, active, disabled, badge, onClick }: ButtonProps) {
  const Glyph = Icon[icon];
  return (
    <button
      type="button"
      className="tb-btn"
      data-tip={label}
      data-kbd={kbd}
      aria-label={kbd ? `${label} (${kbd})` : label}
      aria-pressed={active ?? undefined}
      data-active={active ? '' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Glyph />
      {badge ? <span className="tb-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

function Divider() {
  return <span className="tb-divider" aria-hidden="true" />;
}

const DRAW_TOOLS: { id: DrawToolId; icon: IconName; label: string; kbd: string }[] = [
  { id: 'pen', icon: 'pen', label: 'Pen', kbd: 'P' },
  { id: 'line', icon: 'line', label: 'Line', kbd: 'L' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', kbd: 'A' },
  { id: 'rect', icon: 'rect', label: 'Rectangle', kbd: 'R' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', kbd: 'O' },
  { id: 'text', icon: 'text', label: 'Text', kbd: 'T' },
];

const WIDTHS = [2, 3, 5, 8];

function DrawBar() {
  const { store } = useEnv();
  const drawTool = useEditor((s) => s.drawTool);
  const style = useEditor((s) => s.style);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasShapes = useEditor((s) => s.doc.annotations.some((a) => a.type === 'shape'));
  const [popover, setPopover] = useState<'color' | 'stroke' | null>(null);

  return (
    <div className="subbar" role="toolbar" aria-label="Drawing tools">
      {DRAW_TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          icon={t.icon}
          label={t.label}
          kbd={t.kbd}
          active={drawTool === t.id}
          onClick={() => store.set({ drawTool: t.id, selectedId: null })}
        />
      ))}
      <ToolButton
        icon="eraser"
        label="Eraser"
        kbd="E"
        active={drawTool === 'eraser'}
        onClick={() => store.set({ drawTool: 'eraser', selectedId: null })}
      />
      <Divider />
      <div className="tb-pop-anchor">
        <button
          type="button"
          className="tb-btn"
          data-tip="Stroke colour"
          aria-label="Stroke colour"
          aria-expanded={popover === 'color'}
          onClick={() => setPopover(popover === 'color' ? null : 'color')}
        >
          <span className="swatch" style={{ background: style.color }} />
        </button>
        {popover === 'color' && (
          <div className="mini-pop" role="dialog" aria-label="Stroke colour">
            <div className="swatches">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch-btn"
                  aria-label={c}
                  data-active={style.color.toLowerCase() === c.toLowerCase() ? '' : undefined}
                  style={{ background: c }}
                  onClick={() => {
                    store.set({ style: { ...style, color: c } });
                    setPopover(null);
                  }}
                />
              ))}
            </div>
            <label className="field-row">
              <span>Custom</span>
              <input
                type="color"
                value={style.color.length === 7 ? style.color : '#3b82f6'}
                onChange={(e) =>
                  store.set({ style: { ...style, color: e.target.value.toUpperCase() } })
                }
              />
            </label>
          </div>
        )}
      </div>
      <div className="tb-pop-anchor">
        <button
          type="button"
          className="tb-btn"
          data-tip="Stroke width"
          aria-label="Stroke width"
          aria-expanded={popover === 'stroke'}
          onClick={() => setPopover(popover === 'stroke' ? null : 'stroke')}
        >
          <span
            className="stroke-preview"
            style={{
              height: Math.min(8, style.width),
              borderStyle: style.dashed ? 'dashed' : 'solid',
            }}
          />
        </button>
        {popover === 'stroke' && (
          <div className="mini-pop" role="dialog" aria-label="Stroke width">
            <div className="width-row">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="width-btn"
                  aria-label={`${w}px`}
                  data-active={style.width === w ? '' : undefined}
                  onClick={() => store.set({ style: { ...style, width: w } })}
                >
                  <span style={{ height: w }} />
                </button>
              ))}
            </div>
            <label className="field-row">
              <span>Dashed</span>
              <input
                type="checkbox"
                checked={style.dashed}
                onChange={(e) => store.set({ style: { ...style, dashed: e.target.checked } })}
              />
            </label>
          </div>
        )}
      </div>
      <Divider />
      <ToolButton icon="undo" label="Undo" kbd="⌘Z" disabled={!canUndo} onClick={store.undo} />
      <ToolButton icon="redo" label="Redo" kbd="⇧⌘Z" disabled={!canRedo} onClick={store.redo} />
      <ToolButton
        icon="trash"
        label="Clear drawings"
        disabled={!hasShapes}
        onClick={() => store.clearShapes()}
      />
    </div>
  );
}

const PANELS: Record<Exclude<PanelId, 'none'>, () => ReactNode> = {
  grid: () => <GridPanel />,
  list: () => <FeedbackPanel />,
  export: () => <ExportPanel />,
  help: () => <HelpPanel />,
};

export function Toolbar() {
  const env = useEnv();
  const { store } = env;
  const tool = useEditor((s) => s.tool);
  const panel = useEditor((s) => s.panel);
  const rulers = useEditor((s) => s.rulers);
  const gridVisible = useEditor((s) => s.grid.visible);
  const openCount = useEditor(
    (s) => s.doc.annotations.filter((a) => isComment(a) && a.status === 'open').length,
  );
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadUiPrefs().then((p) => setOffset(p.toolbarOffset));
  }, []);

  const setTool = (next: ToolId) => {
    const s = store.getState();
    store.set({
      tool: s.tool === next ? (next === 'select' ? 'browse' : 'select') : next,
      selectedId: null,
      draft: null,
      pickedEl: next === 'select' ? s.pickedEl : null,
      hoverEl: null,
    });
  };
  const togglePanel = (next: PanelId) => store.set({ panel: panel === next ? 'none' : next });
  const onGrid = () => {
    const s = store.getState();
    if (!s.grid.visible) store.set({ grid: { ...s.grid, visible: true }, panel: 'grid' });
    else if (s.panel === 'grid') store.set({ grid: { ...s.grid, visible: false }, panel: 'none' });
    else store.set({ panel: 'grid' });
  };

  const onGripDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    capturePointer(e.currentTarget, e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onGripMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const maxX = window.innerWidth / 2 - 40;
    const maxY = window.innerHeight - 80;
    setOffset({
      x: Math.max(-maxX, Math.min(maxX, d.ox + e.clientX - d.startX)),
      y: Math.max(-maxY, Math.min(0, d.oy + e.clientY - d.startY)),
    });
  };
  const onGripUp = () => {
    if (!drag.current) return;
    drag.current = null;
    void saveUiPrefs({ toolbarOffset: offset });
  };

  const Panel = panel !== 'none' ? PANELS[panel] : null;

  return (
    <div
      ref={dockRef}
      className="dock ui"
      style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
    >
      {Panel && <Panel key={panel} />}
      {tool === 'draw' && <DrawBar />}
      <div className="toolbar" role="toolbar" aria-label="Chrome Design toolbar">
        <div className="tb-group">
          <ToolButton
            icon="select"
            label="Inspect"
            kbd="V"
            active={tool === 'select'}
            onClick={() => setTool('select')}
          />
          <ToolButton
            icon="comment"
            label="Comment"
            kbd="C"
            active={tool === 'comment'}
            onClick={() => setTool('comment')}
          />
          <ToolButton
            icon="draw"
            label="Draw"
            kbd="D"
            active={tool === 'draw'}
            onClick={() => setTool('draw')}
          />
        </div>
        <Divider />
        <ToolButton
          icon="rulers"
          label="Rulers & guides"
          kbd="M"
          active={rulers}
          onClick={() => store.set({ rulers: !rulers })}
        />
        <ToolButton icon="grid" label="Layout grid" kbd="G" active={gridVisible} onClick={onGrid} />
        <Divider />
        <ToolButton
          icon="list"
          label="Feedback"
          kbd="F"
          active={panel === 'list'}
          badge={openCount}
          onClick={() => togglePanel('list')}
        />
        <ToolButton
          icon="export"
          label="Export for AI"
          kbd="⇧E"
          active={panel === 'export'}
          onClick={() => togglePanel('export')}
        />
        <Divider />
        <ToolButton
          icon="help"
          label="Shortcuts"
          kbd="?"
          active={panel === 'help'}
          onClick={() => togglePanel('help')}
        />
        <ToolButton icon="close" label="Close" kbd="⌥⇧D" onClick={env.close} />
        <button
          type="button"
          className="tb-grip"
          aria-label="Move toolbar"
          data-tip="Drag to move"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onDoubleClick={() => {
            setOffset({ x: 0, y: 0 });
            void saveUiPrefs({ toolbarOffset: { x: 0, y: 0 } });
          }}
        >
          <Icon.grip />
        </button>
      </div>
    </div>
  );
}
