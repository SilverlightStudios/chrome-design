import type { ReactNode } from 'react';
import { gridColumns } from '../../shared/measure';
import type { GridSettings, GridSpacing } from '../../shared/model';
import { useEditor, useEnv } from '../context';
import { Dial } from './Dial';
import { PanelHead } from './PanelHead';

type Layout = 'stretch' | GridSpacing;

const LAYOUTS: { id: Layout; label: string; name: string }[] = [
  { id: 'stretch', label: 'Stretch', name: 'Stretch' },
  { id: 'start', label: 'Left', name: 'Left' },
  { id: 'center', label: 'Center', name: 'Center' },
  { id: 'end', label: 'Right', name: 'Right' },
  { id: 'between', label: 'Between', name: 'Space between' },
  { id: 'around', label: 'Around', name: 'Space around' },
  { id: 'evenly', label: 'Evenly', name: 'Space evenly' },
];

const GRID_COLORS = ['#008BFF', '#EF4444', '#22C55E', '#A855F7', '#F59E0B', '#111827'];

function LayoutPreview({ layout }: { layout: Layout }) {
  const cols =
    layout === 'stretch'
      ? gridColumns(44, { mode: 'stretch', count: 3, columnWidth: 0, margin: 3, gutter: 2.5 })
      : gridColumns(44, {
          mode: 'fixed',
          count: 3,
          columnWidth: 5,
          spacing: layout,
          margin: 3,
          gutter: 1.5,
        });
  return (
    <svg viewBox="0 0 44 24" width="44" height="24" aria-hidden="true">
      <rect x="0.5" y="0.5" width="43" height="23" rx="4.5" className="lp-frame" />
      {cols.map((c) => (
        <rect key={c.x} x={c.x} y="4" width={c.width} height="16" rx="1.2" className="lp-col" />
      ))}
    </svg>
  );
}

/**
 * Switch layout. Fixed-width columns that wouldn't fit the window (the 72px default is far
 * too wide for twelve columns on a phone) are narrowed so the switch still shows every
 * column; spread layouts get a little extra room so their gaps are visible.
 */
export function chooseLayout(grid: GridSettings, layout: Layout, viewportWidth: number) {
  if (layout === 'stretch') return { mode: 'stretch' as const };
  const spread = layout === 'between' || layout === 'around' || layout === 'evenly';
  const room = viewportWidth - grid.margin * 2;
  const gaps = spread ? 0 : (grid.count - 1) * grid.gutter;
  const patch: Partial<GridSettings> = { mode: 'fixed', spacing: layout };
  if (grid.count * grid.columnWidth + gaps > room) {
    const fit = (room - (grid.count - 1) * grid.gutter) / grid.count;
    patch.columnWidth = Math.max(8, Math.floor(spread ? fit * 0.75 : fit));
  }
  return patch;
}

/** A row that folds away (height and opacity) when it doesn't apply to the current layout. */
function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className="reveal" data-hidden={show ? undefined : ''} inert={!show}>
      <div>{children}</div>
    </div>
  );
}

export function GridPanel() {
  const { store } = useEnv();
  const grid = useEditor((s) => s.grid);
  // Adjusting anything shows the columns, so a change is never invisible.
  const update = (patch: Partial<GridSettings>) =>
    store.set({ grid: { ...store.getState().grid, visible: true, ...patch } });
  const layout: Layout = grid.mode === 'stretch' ? 'stretch' : grid.spacing;
  const spread = layout === 'between' || layout === 'around' || layout === 'evenly';

  return (
    <div className="panel grid-panel">
      <PanelHead title="Columns">
        <button
          type="button"
          className="switch-btn"
          role="switch"
          aria-checked={grid.visible}
          aria-label="Show columns"
          onClick={() => update({ visible: !grid.visible })}
        >
          <span className="switch" data-on={grid.visible ? '' : undefined} />
        </button>
      </PanelHead>

      <div className="layout-tiles" role="radiogroup" aria-label="Column layout">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            className="layout-tile"
            aria-checked={layout === l.id}
            aria-label={l.name}
            data-active={layout === l.id ? '' : undefined}
            onClick={() => update(chooseLayout(store.getState().grid, l.id, window.innerWidth))}
          >
            <LayoutPreview layout={l.id} />
            <span>{l.label}</span>
          </button>
        ))}
      </div>

      <div className="dials">
        <Dial
          label="Columns"
          value={grid.count}
          min={1}
          max={24}
          onChange={(count) => update({ count })}
        />
        <Reveal show={layout !== 'stretch'}>
          <Dial
            label="Width"
            value={grid.columnWidth}
            min={8}
            max={480}
            unit="px"
            onChange={(columnWidth) => update({ columnWidth })}
          />
        </Reveal>
        <Reveal show={!spread}>
          <Dial
            label="Gutter"
            value={grid.gutter}
            min={0}
            max={120}
            unit="px"
            onChange={(gutter) => update({ gutter })}
          />
        </Reveal>
        <Reveal show={layout !== 'center'}>
          <Dial
            label="Margin"
            value={grid.margin}
            min={0}
            max={240}
            unit="px"
            onChange={(margin) => update({ margin })}
          />
        </Reveal>
        <div className="dial-row colour-row">
          <span className="dial-label">Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Column colour">
            {GRID_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                className="swatch"
                aria-checked={grid.color === c}
                aria-label={c}
                data-active={grid.color === c ? '' : undefined}
                style={{ ['--c' as string]: c }}
                onClick={() => update({ color: c })}
              />
            ))}
            <label
              className="swatch custom"
              data-active={GRID_COLORS.includes(grid.color) ? undefined : ''}
              style={{ ['--c' as string]: grid.color }}
            >
              <input
                type="color"
                value={grid.color}
                onChange={(e) => update({ color: e.target.value.toUpperCase() })}
                aria-label="Custom colour"
              />
            </label>
          </div>
        </div>
        <Dial
          label="Opacity"
          value={grid.opacity}
          min={0}
          max={100}
          unit="%"
          onChange={(opacity) => update({ opacity })}
        />
      </div>
    </div>
  );
}
