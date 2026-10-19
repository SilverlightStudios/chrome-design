import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatClock } from '../../walkthrough/model';
import { recorder } from '../walkthrough/recorder';
import { ToolButton } from './Toolbar';

/** True while a walkthrough is recording (or being put together). */
export function useRecording(): boolean {
  const phase = useSyncExternalStore(recorder.subscribe, () => recorder.getState().phase);
  return phase === 'recording' || phase === 'finishing';
}

/** Elapsed time, ticking while it records. */
function Elapsed() {
  const s = useSyncExternalStore(recorder.subscribe, recorder.getState);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (s.phase !== 'recording') return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [s.phase]);
  const app = s.session?.origin === 'recorder' ? s.session.app : undefined;
  return (
    <span
      className="rec-time"
      data-finishing={s.phase === 'finishing' ? '' : undefined}
      data-tip={app ? `Recording with ${app}` : 'Recording'}
      role="timer"
      aria-label={`Recording, ${formatClock(now - s.startedAtMs)}`}
    >
      <span className="rec-dot" aria-hidden="true" />
      {formatClock(Math.max(0, now - s.startedAtMs))}
    </span>
  );
}

/** The toolbar while recording: the time, Draw (what ⇧ does, for touch), Stop. */
export function RecordingButtons() {
  const drawing = useSyncExternalStore(recorder.subscribe, () => recorder.getState().drawing);
  const finishing = useSyncExternalStore(
    recorder.subscribe,
    () => recorder.getState().phase === 'finishing',
  );
  return (
    <>
      <Elapsed />
      <ToolButton
        icon="draw"
        label="Draw"
        kbd="⇧"
        active={drawing}
        disabled={finishing}
        onClick={() => recorder.setDrawing(!drawing)}
      />
      <ToolButton
        icon="flag"
        label="Flag this moment"
        kbd="⌥⇧F"
        disabled={finishing}
        onClick={() => recorder.flag()}
      />
      <ToolButton
        icon="stop"
        label="Stop"
        kbd="⌥⇧W"
        className="rec-stop"
        disabled={finishing}
        onClick={() => void recorder.stop()}
      />
    </>
  );
}
