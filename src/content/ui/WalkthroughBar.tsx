import { useEffect, useState } from 'react';
import { formatClock } from '../../walkthrough/model';
import { recorder, useRecorder } from '../walkthrough/recorder';
import { ToolButton } from './controls';

/** True while a walkthrough is recording (or being put together). */
export function useRecording(): boolean {
  return useRecorder((s) => s.phase === 'recording' || s.phase === 'finishing');
}

/** Elapsed time, ticking while it records. */
function Elapsed() {
  const s = useRecorder((state) => state);
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
  const drawing = useRecorder((s) => s.drawing);
  const finishing = useRecorder((s) => s.phase === 'finishing');
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
