import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { isComment, PALETTE } from '../../shared/model';
import { useEditor, useEnv } from '../context';
import { capturePointer, HOST_TAG } from '../dom';
import {
  GLASS_FILTER_ID,
  GlassFilters,
  useBackdropTone,
  useCspGlassFallback,
  useGlassMap,
} from '../motion/glass';
import { MorphSheet, type SheetPhase } from '../motion/MorphSheet';
import { MorphTooltipGroup } from '../motion/MorphTooltip';
import { loadUiPrefs, saveUiPrefs, type UiPrefs } from '../persistence';
import type { DrawToolId, EditorState, PanelId, ToolId } from '../store';
import { ExportPanel } from './ExportPanel';
import { FeedbackPanel } from './FeedbackPanel';
import { GridPanel } from './GridPanel';
import { HelpPanel } from './HelpPanel';
import { Icon, type IconName } from './icons';
import { WelcomePanel } from './WelcomePanel';

interface ButtonProps {
  icon: IconName;
  label: string;
  kbd?: string;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  className?: string;
  onClick: () => void;
}

export function ToolButton({
  icon,
  label,
  kbd,
  active,
  disabled,
  badge,
  className,
  onClick,
}: ButtonProps) {
  const Glyph = Icon[icon];
  return (
    <button
      type="button"
      className={`tb-btn ${className ?? ''}`}
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
  return <span className="tb-sep" aria-hidden="true" />;
}

const DRAW_TOOLS: { id: DrawToolId; icon: IconName; label: string; kbd: string }[] = [
  { id: 'pen', icon: 'pen', label: 'Pen', kbd: 'P' },
  { id: 'line', icon: 'line', label: 'Line', kbd: 'L' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', kbd: 'A' },
  { id: 'rect', icon: 'rect', label: 'Rectangle', kbd: 'R' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', kbd: 'O' },
  { id: 'text', icon: 'text', label: 'Text', kbd: 'T' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', kbd: 'E' },
];

const WIDTHS = [2, 3, 5, 8];

function DrawBar({ placement }: { placement: 'up' | 'down' }) {
  const { store, toast } = useEnv();
  const drawTool = useEditor((s) => s.drawTool);
  const style = useEditor((s) => s.style);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const shapeCount = useEditor((s) => s.doc.annotations.filter((a) => a.type === 'shape').length);
  const [popover, setPopover] = useState<'color' | 'stroke' | null>(null);

  const setStyle = (next: typeof style) => {
    store.set({ style: next });
    void saveUiPrefs({ style: next });
  };

  return (
    <MorphTooltipGroup placement={placement} className="subbar" ariaLabel="Drawing tools">
      {DRAW_TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          icon={t.icon}
          label={t.label}
          kbd={t.kbd}
          active={drawTool === t.id}
          onClick={() => {
            store.set({ drawTool: t.id, selectedId: null });
            void saveUiPrefs({ drawTool: t.id });
          }}
        />
      ))}
      <Divider />
      <div className="tb-pop-anchor">
        <button
          type="button"
          className="tb-btn"
          data-tip="Colour"
          aria-label="Stroke colour"
          aria-expanded={popover === 'color'}
          onClick={() => setPopover(popover === 'color' ? null : 'color')}
        >
          <span className="swatch" style={{ background: style.color }} />
        </button>
        {popover === 'color' && (
          <div
            className="mini-pop glass-css"
            data-placement={placement}
            role="dialog"
            aria-label="Stroke colour"
          >
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
                    setStyle({ ...style, color: c });
                    setPopover(null);
                  }}
                />
              ))}
              <label className="swatch-btn custom" aria-label="Custom colour">
                <input
                  type="color"
                  value={style.color.length === 7 ? style.color : '#3b82f6'}
                  onChange={(e) => setStyle({ ...style, color: e.target.value.toUpperCase() })}
                />
              </label>
            </div>
          </div>
        )}
      </div>
      <div className="tb-pop-anchor">
        <button
          type="button"
          className="tb-btn"
          data-tip="Stroke"
          aria-label="Stroke width"
          aria-expanded={popover === 'stroke'}
          onClick={() => setPopover(popover === 'stroke' ? null : 'stroke')}
        >
          <span
            className="stroke-preview"
            data-dashed={style.dashed ? '' : undefined}
            style={{ height: Math.min(7, style.width) }}
          />
        </button>
        {popover === 'stroke' && (
          <div
            className="mini-pop glass-css"
            data-placement={placement}
            role="dialog"
            aria-label="Stroke width"
          >
            <div className="width-row">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="width-btn"
                  aria-label={`${w}px`}
                  data-active={style.width === w ? '' : undefined}
                  onClick={() => setStyle({ ...style, width: w })}
                >
                  <span style={{ height: w }} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="toggle-row"
              aria-pressed={style.dashed}
              onClick={() => setStyle({ ...style, dashed: !style.dashed })}
            >
              <Icon.dash /> Dashed{' '}
              <span className="switch" data-on={style.dashed ? '' : undefined} />
            </button>
          </div>
        )}
      </div>
      <Divider />
      <ToolButton icon="undo" label="Undo" kbd="⌘Z" disabled={!canUndo} onClick={store.undo} />
      <ToolButton icon="redo" label="Redo" kbd="⇧⌘Z" disabled={!canRedo} onClick={store.redo} />
      <ToolButton
        icon="trash"
        label="Clear drawings"
        disabled={shapeCount === 0}
        onClick={() => {
          store.clearShapes();
          toast(`Cleared ${shapeCount} drawing${shapeCount === 1 ? '' : 's'}`, {
            label: 'Undo',
            run: store.undo,
          });
        }}
      />
    </MorphTooltipGroup>
  );
}

const PANELS: Record<Exclude<PanelId, 'none'>, { label: string; render: () => ReactNode }> = {
  grid: { label: 'Layout grid settings', render: () => <GridPanel /> },
  list: { label: 'Feedback', render: () => <FeedbackPanel /> },
  export: { label: 'Export for AI', render: () => <ExportPanel /> },
  help: { label: 'Shortcuts', render: () => <HelpPanel /> },
  welcome: { label: 'Welcome', render: () => <WelcomePanel /> },
};

/** Keeps a closing element mounted until its exit animation reports done. */
function usePresence<T>(value: T | null): {
  shown: T | null;
  phase: SheetPhase;
  onClosed: () => void;
} {
  const [shown, setShown] = useState<T | null>(value);
  const [phase, setPhase] = useState<SheetPhase>('open');
  const [prev, setPrev] = useState<T | null>(value);
  // Derived during render (React's "adjust state on prop change" pattern), no effect needed.
  if (value !== prev) {
    setPrev(value);
    if (value !== null) {
      setShown(value);
      setPhase('open');
    } else if (shown !== null) {
      setPhase('closing');
    }
  }
  const onClosed = useCallback(() => {
    setShown(null);
    setPhase('open');
  }, []);
  return { shown, phase, onClosed };
}

const skipOwnUi = (el: Element) => el.localName === HOST_TAG;

function clampPosition(p: UiPrefs['toolbar'], barWidth: number): UiPrefs['toolbar'] {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const w = barWidth || 420;
  const maxX = Math.max(0, vw / 2 - w / 2 - 8);
  return {
    edge: p.edge,
    x: Math.max(-maxX, Math.min(maxX, p.x)),
    y: Math.max(0, Math.min(vh / 2 - 60, p.y)),
  };
}

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
  const [pos, setPos] = useState<UiPrefs['toolbar']>({ edge: 'bottom', x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{
    px: number;
    py: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const map = useGlassMap(barRef);
  const cspBlocked = useCspGlassFallback();
  const tone = useBackdropTone(barRef, skipOwnUi);
  const [, force] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(() => setBarWidth(bar.offsetWidth));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    void loadUiPrefs().then((p) => {
      setPos(p.toolbar);
      const patch: Partial<EditorState> = {};
      if (p.style) patch.style = p.style;
      if (p.drawTool) patch.drawTool = p.drawTool as DrawToolId;
      if (!p.onboarded && store.getState().panel === 'none') patch.panel = 'welcome';
      store.set(patch);
    });
    const onResize = () => force((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [store]);

  const setTool = (next: ToolId) => {
    const s = store.getState();
    const nextTool = s.tool === next ? (next === 'select' ? 'browse' : 'select') : next;
    store.set({
      tool: nextTool,
      selectedId: null,
      draft: null,
      pickedEl: nextTool === 'select' ? s.pickedEl : null,
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

  // Drag the whole dock by the bar's background (anything that is not a control).
  const onBarPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button, input, label, .mini-pop')) return;
    const dock = dockRef.current;
    const bar = barRef.current;
    if (!dock || !bar) return;
    const r = bar.getBoundingClientRect();
    capturePointer(bar, e.pointerId);
    dragStart.current = {
      px: e.clientX,
      py: e.clientY,
      left: r.left + r.width / 2,
      top: pos.edge === 'bottom' ? r.bottom : r.top,
      moved: false,
    };
  };
  const onBarPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragStart.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setDrag({ x: d.left + dx, y: d.top + dy });
  };
  const onBarPointerUp = () => {
    const d = dragStart.current;
    dragStart.current = null;
    if (!d?.moved || !drag) {
      setDrag(null);
      return;
    }
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const edge: 'top' | 'bottom' = drag.y < vh / 2 ? 'top' : 'bottom';
    const inset = Math.max(16, 0);
    const next = clampPosition(
      { edge, x: drag.x - vw / 2, y: edge === 'bottom' ? vh - drag.y - inset : drag.y - inset },
      barWidth,
    );
    setPos(next);
    setDrag(null);
    void saveUiPrefs({ toolbar: next });
  };
  const resetPosition = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('button')) return;
    const next = { edge: 'bottom' as const, x: 0, y: 0 };
    setPos(next);
    void saveUiPrefs({ toolbar: next });
  };

  const placed = clampPosition(pos, barWidth);
  const edge: 'top' | 'bottom' = drag
    ? drag.y < window.innerHeight / 2
      ? 'top'
      : 'bottom'
    : placed.edge;
  const placement = edge === 'bottom' ? 'up' : 'down';
  const dockStyle = drag
    ? edge === 'bottom'
      ? { left: drag.x, bottom: window.innerHeight - drag.y }
      : { left: drag.x, top: drag.y }
    : placed.edge === 'bottom'
      ? {
          left: `calc(50% + ${placed.x}px)`,
          bottom: `calc(max(16px, env(safe-area-inset-bottom)) + ${placed.y}px)`,
        }
      : {
          left: `calc(50% + ${placed.x}px)`,
          top: `calc(max(16px, env(safe-area-inset-top)) + ${placed.y}px)`,
        };

  const sheet = usePresence<Exclude<PanelId, 'none'>>(panel === 'none' ? null : panel);
  const draw = usePresence<'draw'>(tool === 'draw' ? 'draw' : null);
  const glassMode = cspBlocked || !map ? 'css' : 'svg';

  return (
    <div
      ref={dockRef}
      className="dock ui"
      data-edge={edge}
      data-dragging={drag ? '' : undefined}
      style={dockStyle}
    >
      <GlassFilters map={glassMode === 'svg' ? map : null} />
      {sheet.shown && (
        <MorphSheet
          phase={sheet.phase}
          contentKey={sheet.shown}
          anchor={edge}
          className="panel-shell glass-css"
          label={PANELS[sheet.shown].label}
          onClosed={sheet.onClosed}
        >
          {PANELS[sheet.shown].render()}
        </MorphSheet>
      )}
      {draw.shown && (
        <MorphSheet
          phase={draw.phase}
          contentKey="draw"
          anchor={edge}
          className="subbar-shell glass-css"
          label="Drawing tools"
          onClosed={draw.onClosed}
        >
          <DrawBar placement={placement} />
        </MorphSheet>
      )}
      <div
        ref={barRef}
        className="toolbar"
        data-glass={glassMode}
        data-tone={tone}
        style={
          glassMode === 'svg'
            ? { ['--glass-filter' as string]: `url(#${GLASS_FILTER_ID})` }
            : undefined
        }
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        onPointerCancel={onBarPointerUp}
        onDoubleClick={resetPosition}
      >
        <MorphTooltipGroup
          placement={placement}
          className="toolbar-row"
          ariaLabel="Chrome Design toolbar"
          onPointerDown={onBarPointerDown}
        >
          <ToolButton icon="close" label="Close" kbd="⌥⇧D" className="close" onClick={env.close} />
          <Divider />
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
          <Divider />
          <ToolButton
            icon="rulers"
            label="Rulers & guides"
            kbd="M"
            active={rulers}
            onClick={() => store.set({ rulers: !rulers })}
          />
          <ToolButton
            icon="grid"
            label="Layout grid"
            kbd="G"
            active={gridVisible}
            onClick={onGrid}
          />
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
            icon="help"
            label="Shortcuts"
            kbd="?"
            active={panel === 'help' || panel === 'welcome'}
            onClick={() => togglePanel('help')}
          />
          <ToolButton
            icon="export"
            label="Export for AI"
            kbd="⇧E"
            className="droplet"
            active={panel === 'export'}
            onClick={() => togglePanel('export')}
          />
        </MorphTooltipGroup>
      </div>
    </div>
  );
}
