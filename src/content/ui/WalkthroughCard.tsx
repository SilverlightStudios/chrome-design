import { type DragEvent, useEffect, useState } from 'react';
import { formatClock } from '../../walkthrough/model';
import { type ParsedTranscript, parseTranscript } from '../../walkthrough/transcript';
import { useEnv } from '../context';
import { downloadBlob } from '../exporter';
import { TooltipGroup } from '../motion/Tooltip';
import { type Sheet, sheetOf, withTranscript } from '../walkthrough/output';
import { recorder, useRecorder, type WalkthroughResult } from '../walkthrough/recorder';
import { Dial } from './Dial';
import { plural } from './format';
import { Icon } from './icons';

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
 * The walkthrough in Send to AI: its contact sheet, what it holds, what was said (a transcript
 * from any voice tool, or the one the voice recorder sent), Save image and Remove. A shared
 * file's walkthrough (`sent`) shows its contact sheet only.
 */
export function WalkthroughCard() {
  const env = useEnv();
  const result = useRecorder((s) => s.result);
  const pictures = useRecorder((s) => s.pictures);
  const [made, setMade] = useState<{ of: WalkthroughResult; sheet: Sheet | null } | null>(null);
  const sheet = made && made.of === result ? made.sheet : null;
  const [dropping, setDropping] = useState(false);
  const sent = env.sentWalkthrough;

  useEffect(() => {
    if (!result) return;
    let live = true;
    void sheetOf(result).then((s) => live && setMade({ of: result, sheet: s }));
    return () => {
      live = false;
    };
  }, [result]);

  if (!result) {
    if (!sent) return null;
    return (
      <div className="wt-card">
        <img
          className="wt-preview"
          src={sent.sheet.dataUrl}
          width={sent.sheet.width}
          height={sent.sheet.height}
          alt="The walkthrough: every picture, numbered"
        />
      </div>
    );
  }

  const wt = result.walkthrough;
  const transcript = wt.transcript;
  const marks = wt.marks.filter((m) => m.shape !== 'laser').length;
  const pointed = wt.marks.length - marks;
  const clicks = wt.events.filter((e) => e.kind === 'click').length;
  const facts = [
    `Walkthrough ${formatClock(wt.durationMs)}`,
    wt.frames.length ? plural(wt.frames.length, 'picture') : '',
    marks ? plural(marks, 'mark') : '',
    pointed ? `pointed ${pointed}×` : '',
    clicks ? plural(clicks, 'click') : '',
  ].filter(Boolean);
  const nudgeable = transcript && !transcript.untimed && transcript.alignment === 'assumed';
  const heard = result.heard;

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

  const remove = () => {
    const removed = recorder.discard();
    if (removed)
      env.toast('Walkthrough removed', { label: 'Undo', run: () => recorder.restore(removed) });
  };

  return (
    <div
      className="wt-card"
      data-testid="cd-wt-card"
      data-dropping={dropping ? '' : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      {sheet ? (
        <img
          className="wt-preview"
          src={sheet.url}
          width={sheet.width}
          height={sheet.height}
          alt="The walkthrough: every picture, numbered"
        />
      ) : wt.frames.length ? (
        <div
          className="wt-preview placeholder"
          style={{ aspectRatio: `${wt.viewport.width} / ${wt.viewport.height}` }}
        />
      ) : null}
      <TooltipGroup placement="up" className="summary-row" ariaLabel="Walkthrough">
        <Icon.record />
        <span className="grow">{facts.join(' · ')}</span>
        <button
          type="button"
          className="icon-btn"
          data-testid="cd-wt-image"
          data-tip="Save image"
          aria-label="Save image"
          disabled={!sheet}
          onClick={() => sheet && downloadBlob(`${result.folder}.jpg`, sheet.jpeg)}
        >
          <Icon.image />
        </button>
        <button
          type="button"
          className="icon-btn"
          data-testid="cd-wt-remove"
          data-tip="Remove the walkthrough"
          aria-label="Remove the walkthrough"
          onClick={remove}
        >
          <Icon.close />
        </button>
      </TooltipGroup>
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
              value={(transcript.offsetMs ?? 0) / 1000}
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
    </div>
  );
}
