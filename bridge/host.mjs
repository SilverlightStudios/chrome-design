#!/usr/bin/env node
// Chrome Design voice bridge: the native messaging host Chrome starts for the voice link.
//
//   Chrome Design (service worker)  ⇄  this process (stdin/stdout, Chrome's framing)
//   this process                    ⇄  your voice recorder (Unix socket, one JSON per line)
//
// It relays messages both ways and saves finished walkthroughs to disk, so the recorder only
// ever reads a folder: walkthrough.bundle / .file / .done from Chrome become files under
// ~/.chrome-design/walkthroughs/<folder>/ and one `walkthrough.saved` message to the recorder.
// It keeps running while Chrome holds the port and reconnects to the recorder whenever it's up.
//
// Env: CHROME_DESIGN_VOICE_SOCKET (default ~/.chrome-design/voice.sock)
//      CHROME_DESIGN_WALKTHROUGHS (default ~/.chrome-design/walkthroughs)
// Install: bridge/install.sh <extension id>. Protocol: docs/WALKTHROUGH.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, normalize, sep } from 'node:path';

const home = join(homedir(), '.chrome-design');
const SOCKET = process.env.CHROME_DESIGN_VOICE_SOCKET || join(home, 'voice.sock');
const OUT = process.env.CHROME_DESIGN_WALKTHROUGHS || join(home, 'walkthroughs');
/** Chrome refuses single messages over 1 MB from a host. */
const MAX_TO_CHROME = 1024 * 1024;

const log = (...args) => process.stderr.write(`[chrome-design-bridge] ${args.join(' ')}\n`);

// ---- Chrome side: 32-bit length (native byte order) + UTF-8 JSON ----------------------------

let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (input.length < 4 + length) break;
    const body = input.subarray(4, 4 + length).toString('utf8');
    input = input.subarray(4 + length);
    try {
      fromChrome(JSON.parse(body));
    } catch (error) {
      log('bad message from Chrome:', String(error));
    }
  }
});
// Chrome closed the port (the extension was turned off, or Chrome quit).
process.stdin.on('end', () => process.exit(0));

function toChrome(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_TO_CHROME) {
    log(`dropped a ${message.type} message to Chrome (${body.length} bytes; the limit is 1 MB)`);
    return;
  }
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

// ---- recorder side: newline-delimited JSON over a Unix socket -------------------------------

let socket = null;
let pending = '';
let extensionHello = null;
/** Messages for the recorder while it isn't connected (saved walkthroughs, mostly). */
const backlog = [];

function toRecorder(message) {
  if (socket) {
    socket.write(`${JSON.stringify(message)}\n`);
    return;
  }
  if (message.type === 'walkthrough.saved' || message.type === 'walkthrough.started') {
    backlog.push(message);
    if (backlog.length > 50) backlog.shift();
  }
}

function connect() {
  const s = createConnection(SOCKET);
  s.setEncoding('utf8');
  s.on('connect', () => {
    socket = s;
    if (extensionHello) s.write(`${JSON.stringify(extensionHello)}\n`);
    for (const m of backlog.splice(0)) s.write(`${JSON.stringify(m)}\n`);
  });
  s.on('data', (text) => {
    pending += text;
    for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
      const line = pending.slice(0, i).trim();
      pending = pending.slice(i + 1);
      if (!line) continue;
      try {
        toChrome(JSON.parse(line));
      } catch {
        log('bad line from the recorder');
      }
    }
  });
  s.on('error', () => undefined);
  s.on('close', () => {
    if (socket === s) {
      socket = null;
      pending = '';
      toChrome({ type: 'bridge', recorder: false });
    }
    setTimeout(connect, 2000);
  });
}

// ---- walkthroughs to disk -------------------------------------------------------------------

const bundles = new Map();

const safeFolder = (name) =>
  String(name || 'walkthrough')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'walkthrough';

/** A file name inside the bundle (`frames/frame-01.jpg`), never outside it. */
function inside(dir, name) {
  const rel = normalize(String(name)).replace(/^([/\\])+/, '');
  if (!rel || rel.startsWith('..') || rel.includes(`${sep}..${sep}`)) return null;
  return join(dir, rel);
}

function fromChrome(message) {
  switch (message?.type) {
    case 'hello':
      extensionHello = message;
      toRecorder(message);
      return;
    case 'walkthrough.bundle': {
      const dir = join(OUT, safeFolder(message.folder));
      mkdirSync(join(dir, 'frames'), { recursive: true });
      writeFileSync(
        join(dir, 'walkthrough.json'),
        `${JSON.stringify(message.walkthrough, null, 2)}\n`,
      );
      writeFileSync(join(dir, 'summary.md'), String(message.summary ?? ''));
      bundles.set(message.session, {
        dir,
        files: ['summary.md', 'walkthrough.json'],
        update: message.update === true,
      });
      toRecorder({
        type: 'walkthrough.bundle',
        session: message.session,
        folder: message.folder,
        dir,
        files: message.files,
      });
      return;
    }
    case 'walkthrough.file': {
      const bundle = bundles.get(message.session);
      const path = bundle && inside(bundle.dir, message.name);
      if (!path) return;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(String(message.base64 ?? ''), 'base64'));
      bundle.files.push(message.name);
      return;
    }
    case 'walkthrough.done': {
      const bundle = bundles.get(message.session);
      if (!bundle) return;
      bundles.delete(message.session);
      toRecorder({
        type: 'walkthrough.saved',
        session: message.session,
        dir: bundle.dir,
        files: bundle.files,
        ...(bundle.update ? { update: true } : {}),
      });
      return;
    }
    default:
      toRecorder(message);
  }
}

mkdirSync(home, { recursive: true });
connect();
