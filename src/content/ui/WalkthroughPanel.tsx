import { type DragEvent, useEffect, useState } from 'react';
import { formatClock } from '../../walkthrough/model';
import { type ParsedTranscript, parseTranscript } from '../../walkthrough/transcript';
import { useEnv } from '../context';
import { downloadBlob } from '../exporter';
import {
  copyWalkthrough,
  type Sheet,
  sheetOf,
  walkthroughZip,
  withTranscript,
} from '../walkthrough/output';
import { recorder, useRecorder } from '../walkthrough/recorder';
import { startWalkthrough } from '../walkthrough/voice';
import { Dial } from './Dial';
import { plural } from './format';
import { Icon } from './icons';
import { PanelHead } from './PanelHead';

const TRANSCRIPT_TYPES = '.srt,.vtt,.json,.txt,text/plain,application/json';

function pickTranscript(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = TRANSCRIPT_TYPES;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** Line a transcript up (or take it away, with null): `at` = seconds the voice is moved by. */
function attach(parsed: ParsedTranscript | null, name: string, at = 0): void {
  const current = recorder.getState().result;
  if (!current) return;
  recorder.update(withTranscript(current, parsed, { offsetMs: at * 1000, source: name }));
}

/**
 * After a walkthrough: the contact sheet, what it holds, what was said (a transcript from any
 * voice tool, or the one the voice recorder sent), and Download / Copy for AI.
 */
export function WalkthroughPanel() {
  const env = useEnv();
  const result = useRecorder((s) => s.result);
  const pictures = useRecorder((s) => s.pictures);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    if (!result) return;
    let live = true;
    void sheetOf(result).then((s) => live && setSheet(s));
    return () => {
      live = false;
    };
  }, [result]);

  if (!result) {
    return (
      <div className="panel walkthrough-panel">
        <PanelHead title="Walkthrough" />
        <button
          type="button"
          className="morph-pill"
          data-phase="idle"
          onClick={() => startWalkthrough({ host: env.host, store: env.store })}
        >
          <span className="layer idle">
            <Icon.record /> Record
          </span>
        </button>
      </div>
    );
  }

  const wt = result.walkthrough;
  const transcript = wt.transcript;
  const marks = wt.marks.filter((m) => m.shape !== 'laser').length;
  const pointed = wt.marks.length - marks;
  const clicks = wt.events.filter((e) => e.kind === 'click').length;
  const facts = [
    formatClock(wt.durationMs),
    wt.frames.length ? plural(wt.frames.length, 'picture') : '',
    marks ? plural(marks, 'mark') : '',
    pointed ? `pointed ${pointed}×` : '',
    clicks ? plural(clicks, 'click') : '',
  ].filter(Boolean);
  const nudgeable = transcript && !transcript.untimed && transcript.alignment === 'assumed';

  const heard = result.heard;
  const offset = (transcript?.offsetMs ?? 0) / 1000;

  const load = async (file: File | null) => {
    if (!file) return;
    const parsed = parseTranscript(await file.text(), file.name);
    if (!parsed) {
      env.toast('That file has no words in it');
      return;
    }
    attach(parsed, file.name, 0);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    void load(e.dataTransfer.files[0] ?? null);
  };

  return (
    <div
      className="panel walkthrough-panel"
      data-dropping={dropping ? '' : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <PanelHead title="Walkthrough" />
      {sheet ? (
        <img
          className="wt-preview"
          src={sheet.url}
          width={sheet.width}
          height={sheet.height}
          alt="Every picture, numbered"
        />
      ) : wt.frames.length ? (
        <div
          className="wt-preview placeholder"
          style={{ aspectRatio: `${wt.viewport.width} / ${wt.viewport.height}` }}
        />
      ) : null}
      <div className="summary-row">
        <Icon.record />
        <span>{facts.join(' · ')}</span>
      </div>
      {wt.frames.length === 0 && !pictures ? (
        <p className="muted small">Pictures need the Chrome extension.</p>
      ) : null}

      {result.delivered ? (
        <div className="summary-row wt-sent" role="status">
          <Icon.check />
          <span>Sent to {result.delivered.app ?? 'your voice recorder'}</span>
        </div>
      ) : null}

      {transcript ? (
        <div className="wt-voice">
          <div className="summary-row">
            <Icon.voice />
            <span className="grow">
              {transcript.source} ·{' '}
              {transcript.untimed ? 'no times' : plural(transcript.segments.length, 'line')}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove what was said"
              onClick={() => attach(null, '')}
            >
              <Icon.close />
            </button>
          </div>
          {nudgeable && heard ? (
            <Dial
              label="Voice starts"
              value={offset}
              min={-30}
              max={30}
              limit={600}
              step={0.5}
              unit="s"
              onChange={(v) => attach(heard.parsed, heard.name, v)}
            />
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="ghost-action"
          data-testid="cd-wt-transcript"
          onClick={() => void pickTranscript().then(load)}
        >
          <Icon.voice /> Add what you said
        </button>
      )}

      <button
        type="button"
        className="morph-pill"
        data-phase={phase}
        data-testid="cd-wt-download"
        disabled={phase === 'working'}
        onClick={() => {
          setPhase('working');
          void walkthroughZip(result)
            .then((zip) => {
              downloadBlob(`${result.folder}.zip`, zip);
              setPhase('done');
              window.setTimeout(() => setPhase('idle'), 2200);
            })
            .catch(() => {
              setPhase('error');
              window.setTimeout(() => setPhase('idle'), 2600);
            });
        }}
      >
        <span className="layer idle">
          <Icon.export /> Download .zip
        </span>
        <span className="layer working">
          <span className="label-text">Putting it together…</span>
        </span>
        <span className="layer done">
          <Icon.check />
          <span className="label-text">Saved to Downloads</span>
        </span>
        <span className="layer error">Couldn’t save — try again</span>
      </button>
      <div className="ghost-row">
        <button
          type="button"
          className="ghost-action"
          data-testid="cd-wt-copy"
          data-done={copied ? '' : undefined}
          onClick={() => {
            void copyWalkthrough(result).then((ok) => {
              if (!ok) {
                env.toast('Couldn’t copy');
                return;
              }
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? <Icon.check /> : <Icon.copy />} Copy for AI
        </button>
        <button
          type="button"
          className="ghost-action"
          data-testid="cd-wt-image"
          data-done={saved ? '' : undefined}
          disabled={!sheet}
          onClick={() => {
            if (!sheet) return;
            downloadBlob(`${result.folder}.jpg`, sheet.jpeg);
            setSaved(true);
            window.setTimeout(() => setSaved(false), 1600);
          }}
        >
          {saved ? <Icon.check /> : <Icon.image />} Save image
        </button>
      </div>
    </div>
  );
}
