// Usage: node --experimental-strip-types tools/import-notes.ts <notes.txt> [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseNotes } from '../src/notesImport.ts';

const [, , inPath, outPath] = process.argv;
if (!inPath) {
  console.error('usage: import-notes <notes.txt> [out.json]');
  process.exit(1);
}
const text = readFileSync(inPath, 'utf8');
const res = parseNotes(text, { today: new Date() });
// Optional per-line exercise-name overrides: overrides.json = { "772": "Bench" }
try {
  const ov = JSON.parse(readFileSync(new URL('./overrides.json', import.meta.url), 'utf8')) as Record<string, string>;
  const lines = text.split(/\r?\n/);
  for (const [ln, name] of Object.entries(ov)) {
    const raw = lines[+ln - 1];
    for (const w of res.workouts) for (const e of w.entries) if (e.name === 'Unknown' && w.raw?.includes(raw)) e.name = name;
  }
} catch {}
const nSets = res.workouts.reduce((n, w) => n + w.entries.reduce((m, e) => m + e.sets.length, 0), 0);
console.log(`${res.workouts.length} workouts, ${nSets} sets, ${res.warnings.length} warnings`);
console.log(`date range: ${res.workouts[res.workouts.length - 1]?.date} .. ${res.workouts[0]?.date}`);
for (const w of res.warnings) console.log(`  L${w.line}: ${w.message}  |  ${w.text}`);
if (outPath) {
  writeFileSync(outPath, JSON.stringify({ version: 1, workouts: res.workouts }, null, 1));
  console.log(`wrote ${outPath}`);
}
