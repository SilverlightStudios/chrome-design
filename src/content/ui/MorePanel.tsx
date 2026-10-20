import { useState } from 'react';
import { isComment } from '../../shared/model';
import { useEditor, useEnv } from '../context';
import { hasExtensionRuntime } from '../ext';
import { importHandoffFiles, pickHandoffFiles } from '../importHandoff';
import { useCompact } from '../motion/MorphSheet';
import { useRecorder } from '../walkthrough/recorder';
import { Icon, type IconName } from './icons';

/** Touch screens have no keyboard, so no Shortcuts tile. */
const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

interface TileProps {
  icon: IconName;
  label: string;
  on?: boolean;
  badge?: number;
  danger?: boolean;
  onClick: () => void;
  /** Settings for a tile that's switched on: a ⋯ in its corner while it's on. */
  options?: { label: string; open: () => void };
}

function Tile({ icon, label, on, badge, danger, onClick, options }: TileProps) {
  const Glyph = Icon[icon];
  return (
    <div className="tile-wrap">
      <button
        type="button"
        className="tile"
        data-on={on ? '' : undefined}
        data-danger={danger ? '' : undefined}
        aria-pressed={on ?? undefined}
        onClick={onClick}
      >
        <span className="tile-icon">
          <Glyph />
          {badge ? <span className="tb-badge">{badge > 99 ? '99+' : badge}</span> : null}
        </span>
        <span className="tile-label">{label}</span>
      </button>
      {options ? (
        <button
          type="button"
          className="tile-more"
          aria-label={options.label}
          data-shown={on ? '' : undefined}
          inert={!on}
          onClick={options.open}
        >
          <Icon.more />
        </button>
      ) : null}
    </div>
  );
}

/** The ⋯ sheet: everything that isn't a drawing tool, as Remote Desktop-style tiles. */
export function MorePanel() {
  const { store, toast } = useEnv();
  const walkthrough = useRecorder((s) => !!s.result);
  const rulers = useEditor((s) => s.rulers);
  const grid = useEditor((s) => s.grid.visible);
  const tool = useEditor((s) => s.tool);
  const annotations = useEditor((s) => s.doc.annotations);
  const open = annotations.filter((a) => isComment(a) && a.status === 'open').length;
  const [armed, setArmed] = useState(false);
  // Resizing the window needs the extension, and means nothing on a phone.
  const compact = useCompact();
  const canResize = hasExtensionRuntime() && !compact;

  return (
    <div className="panel more-panel">
      <div className="tiles">
        <Tile
          icon="list"
          label="Comments"
          badge={open}
          onClick={() => store.set({ panel: 'list', panelBack: 'more' })}
        />
        {walkthrough ? (
          <Tile
            icon="record"
            label="Walkthrough"
            onClick={() => store.set({ panel: 'walkthrough', panelBack: 'more' })}
          />
        ) : null}
        <Tile
          icon="hand"
          label={tool === 'browse' ? 'Paused' : 'Use the page'}
          on={tool === 'browse'}
          onClick={() =>
            store.set({
              tool: tool === 'browse' ? 'select' : 'browse',
              panel: 'none',
              hoverEl: null,
            })
          }
        />
        {annotations.some((a) => a.type === 'shape') ? (
          <Tile
            icon="layers"
            label="Layers"
            onClick={() => store.set({ panel: 'layers', panelBack: 'more' })}
          />
        ) : null}
        <Tile
          icon="folder"
          label="Open file"
          onClick={() => {
            void pickHandoffFiles().then((files) => importHandoffFiles(store, files, toast));
          }}
        />
        <Tile
          icon="rulers"
          label="Rulers"
          on={rulers}
          onClick={() => store.set({ rulers: !rulers })}
        />
        <Tile
          icon="grid"
          label="Columns"
          on={grid}
          onClick={() => store.set({ grid: { ...store.getState().grid, visible: !grid } })}
          options={{
            label: 'Column settings',
            open: () => store.set({ panel: 'grid', panelBack: 'more' }),
          }}
        />
        {touch() ? null : (
          <Tile
            icon="help"
            label="Shortcuts"
            onClick={() => store.set({ panel: 'help', panelBack: 'more' })}
          />
        )}
        {canResize ? (
          <Tile
            icon="sizes"
            label="Screen size"
            onClick={() => store.set({ panel: 'screen', panelBack: 'more' })}
          />
        ) : null}
        <Tile
          icon="info"
          label="Quick tour"
          onClick={() => store.set({ panel: 'welcome', panelBack: 'more' })}
        />
        <Tile
          icon="gear"
          label="Settings"
          onClick={() => store.set({ panel: 'settings', panelBack: 'more' })}
        />
      </div>
      {annotations.length > 0 && (
        <button
          type="button"
          className="btn ghost danger wide"
          data-armed={armed ? '' : undefined}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              window.setTimeout(() => setArmed(false), 3000);
              return;
            }
            setArmed(false);
            const count = annotations.length;
            store.clearAll();
            store.set({ panel: 'none' });
            toast(`Cleared ${count} item${count === 1 ? '' : 's'}`, {
              label: 'Undo',
              run: store.undo,
            });
          }}
        >
          {armed ? 'Tap again to clear everything' : 'Clear this page'}
        </button>
      )}
    </div>
  );
}
