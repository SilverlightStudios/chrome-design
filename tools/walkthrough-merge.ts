#!/usr/bin/env node
/**
 * Merge a transcript into a walkthrough and write its summary.md (what happened and what was
 * said, picture by picture). For voice tools that would rather call a command than build the
 * text themselves.
 *
 *   node tools/walkthrough-merge.ts <walkthrough folder | .zip> <transcript> [options]
 *
 *   --audio-started-at <ISO | epoch ms>   when the audio began (lines it up exactly)
 *   --offset <seconds>                    or: move the voice by this much (audio assumed to
 *                                         start with the walkthrough)
 *   --source <name>                       what to call the transcript ("Parakeet", …)
 *   --out <file>                          where to write the summary (default: the folder's
 *                                         summary.md, or stdout for a .zip)
 *   --json                                also write walkthrough.json with the transcript in it
 *
 * Transcripts: .srt, .vtt, JSON (chrome-design.transcript, Whisper, NeMo/Parakeet, segment
 * lists) or plain text. A JSON transcript with `startedAtMs` needs no --audio-started-at.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Walkthrough } from '../src/walkthrough/model.ts';
import { alignTranscript, buildSummary } from '../src/walkthrough/summary.ts';
import { parseTranscript } from '../src/walkthrough/transcript.ts';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** walkthrough.json from a stored zip (as Chrome Design writes them). */
function fromZip(bytes: Buffer): Walkthrough | null {
  let at = 0;
  while (at + 30 <= bytes.length && bytes.readUInt32LE(at) === 0x04034b50) {
    const size = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const extraLength = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extraLength;
    if (name.endsWith('walkthrough.json'))
      return JSON.parse(bytes.subarray(start, start + size).toString('utf8')) as Walkthrough;
    at = start + size;
  }
  return null;
}

const argv = process.argv.slice(2);
const positional: string[] = [];
const options: Record<string, string | true> = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === '--json') options.json = true;
  else if (a.startsWith('--')) options[a.slice(2)] = argv[++i] ?? '';
  else positional.push(a);
}
const [target, transcriptPath] = positional;
if (!target || !transcriptPath)
  fail(
    'usage: node tools/walkthrough-merge.ts <walkthrough folder | .zip> <transcript> [--audio-started-at …] [--offset s] [--source name] [--out file] [--json]',
  );

const isDir = existsSync(target) && statSync(target).isDirectory();
const wt: Walkthrough | null = isDir
  ? (JSON.parse(readFileSync(join(target, 'walkthrough.json'), 'utf8')) as Walkthrough)
  : fromZip(readFileSync(target));
if (!wt) fail(`No walkthrough.json in ${target}`);

const parsed = parseTranscript(readFileSync(transcriptPath, 'utf8'), transcriptPath);
if (!parsed) fail(`No words in ${transcriptPath}`);

const startedAt = options['audio-started-at'];
if (typeof startedAt === 'string') {
  const ms = /^\d+$/.test(startedAt) ? Number(startedAt) : Date.parse(startedAt);
  if (Number.isNaN(ms)) fail(`Can't read --audio-started-at ${startedAt}`);
  parsed.startedAtMs = ms;
}
const offset = typeof options.offset === 'string' ? Number(options.offset) * 1000 : 0;
wt.transcript = alignTranscript(wt, parsed, {
  offsetMs: offset,
  source: typeof options.source === 'string' ? options.source : basename(transcriptPath),
});
const summary = buildSummary(wt);

const out =
  typeof options.out === 'string' ? options.out : isDir ? join(target, 'summary.md') : null;
if (out) {
  writeFileSync(out, summary);
  process.stderr.write(`Wrote ${out}\n`);
} else process.stdout.write(summary);
if (options.json && isDir)
  writeFileSync(join(target, 'walkthrough.json'), `${JSON.stringify(wt, null, 2)}\n`);
