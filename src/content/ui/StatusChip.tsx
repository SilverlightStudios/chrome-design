import { useEditor, useEnv } from '../context';
import { useRecording } from './WalkthroughBar';

/**
 * The Remote Desktop viewer's top chip. It only appears when the user needs to act: while the
 * tools are paused, with a Resume button (not while a walkthrough records: the page is in use
 * then on purpose, and the recording bar says so).
 */
export function StatusChip() {
  const { store } = useEnv();
  const recording = useRecording();
  const paused = useEditor((s) => s.tool === 'browse') && !recording;
  return (
    <div
      className="status-chip glass-css ui"
      data-hidden={paused ? undefined : ''}
      data-tool="browse"
      role="status"
      aria-live="polite"
      inert={!paused}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-text">Paused</span>
      <button type="button" className="chip-btn" onClick={() => store.set({ tool: 'select' })}>
        Resume
      </button>
    </div>
  );
}
