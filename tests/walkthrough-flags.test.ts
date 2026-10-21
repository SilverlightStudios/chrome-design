// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createInitialState, EditorStore, emptyDoc } from '../src/content/store';
import { withTranscript } from '../src/content/walkthrough/output';
import { WalkthroughRecorder, type WalkthroughResult } from '../src/content/walkthrough/recorder';
import { type CommentThread, isComment } from '../src/shared/model';
import { WALKTHROUGH_KIND } from '../src/walkthrough/model';
import { parseTranscript } from '../src/walkthrough/transcript';

const AT = '2026-10-20T00:00:00.000Z';

/** The editor as a new opening of the toolbar has it: the flag comment, saved with the page. */
function editor(): EditorStore {
  const flag: CommentThread = {
    id: 'c1',
    type: 'comment',
    number: 1,
    intent: 'note',
    status: 'open',
    target: { type: 'point', point: { x: 10, y: 10 } },
    messages: [{ id: 'm1', body: '⚑ Walkthrough 0:01', createdAt: AT }],
    createdAt: AT,
    updatedAt: AT,
  };
  const doc = emptyDoc('https://acme.test/', 'Acme');
  return new EditorStore(createInitialState({ ...doc, annotations: [flag] }));
}

const firstMessage = (store: EditorStore) =>
  store.getState().doc.annotations.find(isComment)?.messages[0]?.body;

function finished(): WalkthroughResult {
  return {
    walkthrough: {
      kind: WALKTHROUGH_KIND,
      version: 1,
      generator: { name: 'Chrome Design', version: '0.1.0' },
      startedAt: AT,
      startedAtMs: Date.parse(AT),
      durationMs: 3000,
      page: { url: 'https://acme.test/', title: 'Acme' },
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
      frames: [],
      marks: [],
      events: [{ kind: 'flag', t: 1000, point: { x: 10, y: 10 }, comment: 1 }],
      strokes: [],
      cursor: [],
    },
    shots: {},
    summary: '',
    folder: 'walkthrough-acme',
  };
}

const said = parseTranscript(
  '1\n00:00:00,500 --> 00:00:01,500\nThis heading is wrong.\n',
  'a.srt',
)!;

describe('flag comments after the toolbar closes and opens again', () => {
  it('get what was said in the editor that is open now', () => {
    const recorder = new WalkthroughRecorder();
    const result = finished();
    recorder.restore(result);
    const first = editor();
    const host = document.createElement('div');
    recorder.attach({ host, store: first });
    recorder.detach(first);
    const reopened = editor();
    recorder.attach({ host, store: reopened });
    recorder.update(withTranscript(result, said));
    expect(firstMessage(reopened)).toBe('“This heading is wrong.”\n\n⚑ Walkthrough 0:01');
    expect(firstMessage(first)).toBe('⚑ Walkthrough 0:01');
  });

  it('get a transcript that came while the toolbar was closed', () => {
    const recorder = new WalkthroughRecorder();
    const result = finished();
    recorder.restore(result);
    recorder.update(withTranscript(result, said));
    const reopened = editor();
    recorder.attach({ host: document.createElement('div'), store: reopened });
    expect(firstMessage(reopened)).toBe('“This heading is wrong.”\n\n⚑ Walkthrough 0:01');
  });
});
