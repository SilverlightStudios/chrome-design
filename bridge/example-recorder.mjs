#!/usr/bin/env node
// A stand-in voice recorder for the voice link: try the whole loop without your real recorder,
// and a reference for adding the link to it (docs/WALKTHROUGH.md has the full contract).
//
//   node bridge/example-recorder.mjs [--transcript said.srt] [--app "My Recorder"] [--any-app]
//
// Type `r` + Enter to start recording, `r` again to stop. While recording, any other line is
// "something you said" (timed when you press Enter), `c` sends a spoken cue ("here"). Without
// --any-app it only asks Chrome Design to follow along when Chrome is the frontmost app.
//
// When Chrome Design hands back the walkthrough (the bridge saved it to a folder), this merges
// what was said and writes the final summary.md there, Scrawl's format: the same thing your
// recorder would do with its own transcript.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { alignTranscript, buildSummary } from '../src/walkthrough/summary.ts';
import { parseTranscript } from '../src/walkthrough/transcript.ts';

const say = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
const APP = flag('--app') || 'Example recorder';
const TRANSCRIPT = flag('--transcript');
const ANY_APP = args.includes('--any-app');
const SOCKET =
  process.env.CHROME_DESIGN_VOICE_SOCKET || join(homedir(), '.chrome-design', 'voice.sock');

/** The app in front, by bundle id (macOS). */
function frontmostApp() {
  try {
    return execFileSync(
      'osascript',
      [
        '-e',
        'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
      ],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}
const CHROMES = [
  'com.google.Chrome',
  'com.google.Chrome.beta',
  'com.google.Chrome.canary',
  'org.chromium.Chromium',
  'com.brave.Browser',
  'com.microsoft.edgemac',
  'company.thebrowser.Browser',
];

let bridge = null;
const send = (message) => bridge?.write(`${JSON.stringify(message)}\n`);

/** The recording in progress: the session id, when it started, what was "said". */
let recording = null;
/** Finished recordings by session, waiting for their walkthrough. */
const finished = new Map();

function start() {
  const session = randomUUID();
  recording = { session, startedAt: Date.now(), said: [], lastAt: Date.now() };
  const front = frontmostApp();
  const chrome = CHROMES.some((id) => front.startsWith(id));
  say(`● recording (session ${session.slice(0, 8)})`);
  if (ANY_APP || chrome) {
    send({
      type: 'recording.start',
      session,
      startedAt: recording.startedAt,
      app: APP,
      onlyIfChromeInFront: !ANY_APP,
    });
  } else {
    say(`  ${front || 'another app'} is in front: audio only, Chrome Design isn't asked.`);
  }
}

function stop() {
  const r = recording;
  recording = null;
  if (!r) return;
  send({ type: 'recording.stop', session: r.session, stoppedAt: Date.now() });
  finished.set(r.session, r);
  say('■ stopped; waiting for the walkthrough…');
}

/** This recorder's transcript, in Chrome Design's own format (times from the audio's start). */
function transcriptFor(r) {
  if (TRANSCRIPT) return readFileSync(TRANSCRIPT, 'utf8');
  return JSON.stringify({
    kind: 'chrome-design.transcript',
    startedAtMs: r.startedAt,
    segments: r.said,
  });
}

function merge(saved) {
  const r = finished.get(saved.session);
  finished.delete(saved.session);
  const wtPath = join(saved.dir, 'walkthrough.json');
  const wt = JSON.parse(readFileSync(wtPath, 'utf8'));
  const text = r ? transcriptFor(r) : TRANSCRIPT ? readFileSync(TRANSCRIPT, 'utf8') : '';
  const parsed = text ? parseTranscript(text, TRANSCRIPT ?? 'transcript.json') : null;
  if (parsed) {
    // A file with no start time of its own started when this recording did.
    if (parsed.startedAtMs === undefined && r) parsed.startedAtMs = r.startedAt;
    wt.transcript = alignTranscript(wt, parsed, { source: APP });
    writeFileSync(wtPath, `${JSON.stringify(wt, null, 2)}\n`);
    // Let the review panel in Chrome show the words too.
    send({
      type: 'transcript',
      session: saved.session,
      transcript: JSON.parse(transcriptJson(parsed)),
      app: APP,
    });
  }
  const summary = buildSummary(wt);
  writeFileSync(join(saved.dir, 'summary.md'), summary);
  say(`\n✓ ${saved.dir}\n\n${summary}`);
}

function transcriptJson(parsed) {
  return JSON.stringify({
    kind: 'chrome-design.transcript',
    startedAtMs: parsed.startedAtMs,
    segments: parsed.segments,
  });
}

function onMessage(message) {
  switch (message.type) {
    case 'hello':
      say(`Chrome Design ${message.version} connected.`);
      return;
    case 'walkthrough.started':
      if (message.origin === 'extension' && !recording) {
        // Started in Chrome: a real recorder would start recording audio now.
        recording = {
          session: message.session,
          startedAt: Date.now(),
          said: [],
          lastAt: Date.now(),
        };
        say(`● Chrome Design started a walkthrough on ${message.page.url}: recording too`);
      } else say(`  following along on ${message.page.url}`);
      return;
    case 'walkthrough.unavailable':
      say(`  Chrome Design can't follow along: ${message.reason}`);
      return;
    case 'walkthrough.stopped':
      if (message.origin === 'extension' && recording?.session === message.session) stop();
      return;
    case 'walkthrough.saved':
      merge(message);
      return;
    default:
      return;
  }
}

mkdirSync(dirname(SOCKET), { recursive: true });
if (existsSync(SOCKET)) unlinkSync(SOCKET);
const server = createServer((socket) => {
  bridge = socket;
  socket.setEncoding('utf8');
  send({ type: 'hello', app: APP, protocol: 1 });
  let pending = '';
  socket.on('data', (text) => {
    pending += text;
    for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
      const line = pending.slice(0, i).trim();
      pending = pending.slice(i + 1);
      if (line) onMessage(JSON.parse(line));
    }
  });
  socket.on('close', () => {
    if (bridge === socket) bridge = null;
  });
});
server.listen(SOCKET, () => {
  chmodSync(SOCKET, 0o600);
  say(`${APP} listening on ${SOCKET}. r = record/stop, c = cue, q = quit.`);
});

createInterface({ input: process.stdin }).on('line', (line) => {
  const text = line.trim();
  if (text === 'q') process.exit(0);
  if (text === 'r') return recording ? stop() : start();
  if (!recording) return;
  if (text === 'c')
    return send({ type: 'cue', session: recording.session, at: Date.now(), word: 'here' });
  if (text) {
    const now = Date.now();
    recording.said.push({
      t0: recording.lastAt - recording.startedAt,
      t1: now - recording.startedAt,
      text,
    });
    recording.lastAt = now;
  }
});
