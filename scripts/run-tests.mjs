#!/usr/bin/env node
// Round 60a Phase 1 — one-command test runner.
//
// Dependency-free. Discovers test files automatically by filename
// convention; a new test file is picked up with no runner edits.
//
// Discovery:
//   offline:   scripts/*.test.mjs  minus scripts/*-browser.test.mjs
//              plus scripts/*.test.py when Python is available
//              (reported `skipped — no python3` otherwise)
//   browser:   scripts/*-browser.test.mjs (Chromium needed; skipped
//              with reason when it is missing or no display is set up)
//   live:      scripts/demo-live-smoke.mjs — read-only hosted smoke.
//              Needs the demo property id to run against the live demo;
//              skipped with reason when env is incomplete.
//
// Modes (first CLI arg; defaults to `all`):
//   test        offline only
//   browser     browser only
//   live        live only
//   all         offline + browser (NOT live — live is explicit)
//
// A test that needs a secret or network it does not have must exit
// with code 77 (traditional "skip") and print `SKIP <reason>` on its
// first line of stderr. The runner treats that as a counted skip, not
// a pass. Any other non-zero exit is a failure.
//
// Output: one summary line per file (pass / fail / skip + reason) and
// totals at the end. Non-zero exit on any failure.

import { readdirSync, existsSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const scriptsDir = resolve(repoRoot, 'scripts');

const MODE = process.argv[2] || 'all';
const VALID_MODES = new Set(['test', 'browser', 'live', 'all']);
if (!VALID_MODES.has(MODE)) {
  console.error(`Unknown mode "${MODE}". Use one of: ${[...VALID_MODES].join(', ')}.`);
  process.exit(2);
}

const PER_FILE_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 300000); // 5 min

function listTests() {
  const entries = readdirSync(scriptsDir);
  const offline = [];
  const browser = [];
  const python = [];
  for (const name of entries) {
    const full = resolve(scriptsDir, name);
    if (!statSync(full).isFile()) continue;
    if (name.endsWith('-browser.test.mjs')) { browser.push(full); continue; }
    if (name.endsWith('.test.mjs')) { offline.push(full); continue; }
    if (name.endsWith('.test.py')) { python.push(full); continue; }
  }
  offline.sort(); browser.sort(); python.sort();
  // Live suite is an explicit allowlist, not a glob, because the
  // producing files are plain .mjs scripts (not .test.mjs) that
  // intentionally talk to a hosted environment.
  const live = [resolve(scriptsDir, 'demo-live-smoke.mjs')].filter(existsSync);
  return { offline, browser, python, live };
}

function hasPython() {
  const probe = spawnSync('python3', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

function haveChromium() {
  const explicit = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (explicit && existsSync(explicit)) return true;
  // Default path baked into the remote-runtime image.
  if (existsSync('/opt/pw-browsers/chromium')) return true;
  // Playwright-managed Chromium (local devs or CI after `playwright
  // install chromium`). Ask the Playwright API for its own path; if the
  // call succeeds and the binary exists, we're good.
  try {
    const probe = spawnSync(process.execPath, ['-e',
      "const p=require('playwright');const fs=require('fs');const e=p.chromium.executablePath();process.stdout.write(fs.existsSync(e)?e:'')"
    ], { encoding: 'utf8', timeout: 10000 });
    if (probe.status === 0 && probe.stdout.trim()) return true;
  } catch { /* ignore */ }
  return false;
}

function liveSmokePreflight() {
  // The smoke needs an explicit origin + a disposable property id.
  // Without them the runner reports a skip, not a pass, so CI never
  // silently claims the live gate ran.
  const origin = process.env.DEMO_SMOKE_ORIGIN;
  const propertyId = process.env.DEMO_SMOKE_PROPERTY_ID;
  if (!origin) return { ok: false, reason: 'DEMO_SMOKE_ORIGIN not set' };
  if (!propertyId) return { ok: false, reason: 'DEMO_SMOKE_PROPERTY_ID not set' };
  return { ok: true, origin, propertyId };
}

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function runOne({ cmd, args, label, env = process.env, timeoutMs = PER_FILE_TIMEOUT_MS }) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      // Exit code 77 is "skipped" (POSIX convention); first line of
      // stderr gives the reason.
      let outcome = 'pass';
      let reason = '';
      if (timedOut) { outcome = 'fail'; reason = `timeout after ${fmtDuration(timeoutMs)}`; }
      else if (code === 77) {
        outcome = 'skip';
        const firstLine = stderr.split('\n').find(l => l.trim());
        reason = firstLine ? firstLine.replace(/^SKIP\s*/i, '').trim() : 'skipped';
      } else if (code !== 0) {
        outcome = 'fail';
        reason = signal ? `killed by ${signal}` : `exit ${code}`;
      }
      resolveRun({ label, outcome, reason, durationMs, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolveRun({
        label,
        outcome: 'fail',
        reason: `spawn error: ${err.message}`,
        durationMs: Date.now() - started,
        stdout: '',
        stderr: String(err),
      });
    });
  });
}

async function runGroup(name, items, builder) {
  if (!items.length) return [];
  console.log(`\n── ${name} (${items.length}) ──`);
  const results = [];
  for (const item of items) {
    const spec = builder(item);
    if (!spec) continue;
    if (spec.skip) {
      console.log(`SKIP  ${spec.label} — ${spec.skip}`);
      results.push({ label: spec.label, outcome: 'skip', reason: spec.skip, durationMs: 0, stdout: '', stderr: '' });
      continue;
    }
    const r = await runOne(spec);
    const tag = r.outcome === 'pass' ? 'PASS'
      : r.outcome === 'skip' ? 'SKIP'
      : 'FAIL';
    const suffix = r.outcome === 'pass' ? ` (${fmtDuration(r.durationMs)})`
      : r.outcome === 'skip' ? ` — ${r.reason}`
      : ` — ${r.reason} (${fmtDuration(r.durationMs)})`;
    console.log(`${tag}  ${r.label}${suffix}`);
    if (r.outcome === 'fail') {
      // Surface last 30 lines of each stream to make CI logs readable
      // without replaying the whole run.
      const tail = (text, n = 30) => text.split('\n').slice(-n).join('\n').trimEnd();
      if (r.stdout.trim()) console.log(`      ─ stdout tail ─\n${tail(r.stdout).replace(/^/gm, '      ')}`);
      if (r.stderr.trim()) console.log(`      ─ stderr tail ─\n${tail(r.stderr).replace(/^/gm, '      ')}`);
    }
    results.push(r);
  }
  return results;
}

async function main() {
  const { offline, browser, python, live } = listTests();
  const pythonAvailable = hasPython();
  const chromiumAvailable = haveChromium();
  const livePre = liveSmokePreflight();

  const run = { test: false, browser: false, live: false };
  if (MODE === 'test') run.test = true;
  else if (MODE === 'browser') run.browser = true;
  else if (MODE === 'live') run.live = true;
  else { run.test = true; run.browser = true; } // all

  const allResults = [];

  if (run.test) {
    const r1 = await runGroup('offline (node)', offline, (file) => ({
      label: relative(repoRoot, file),
      cmd: process.execPath,
      args: [file],
    }));
    allResults.push(...r1);
    const r2 = await runGroup('offline (python)', python, (file) => ({
      label: relative(repoRoot, file),
      skip: pythonAvailable ? null : 'no python3 available on this runner',
      cmd: 'python3',
      args: ['-I', file],
    }));
    allResults.push(...r2);
  }

  if (run.browser) {
    // Resolve the executable path only when the hard-coded local-image
    // path actually exists; otherwise leave CHROMIUM_EXECUTABLE_PATH
    // unset so Playwright falls back to its own-managed browser (what
    // CI uses after `npx playwright install chromium`).
    const browserEnv = { ...process.env };
    if (!process.env.CHROMIUM_EXECUTABLE_PATH && existsSync('/opt/pw-browsers/chromium')) {
      browserEnv.CHROMIUM_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
    }
    const r3 = await runGroup('browser (chromium)', browser, (file) => ({
      label: relative(repoRoot, file),
      skip: chromiumAvailable ? null : 'no Chromium executable found (set CHROMIUM_EXECUTABLE_PATH)',
      cmd: process.execPath,
      args: [file],
      env: browserEnv,
    }));
    allResults.push(...r3);
  }

  if (run.live) {
    const r4 = await runGroup('live (hosted smoke)', live, (file) => ({
      label: relative(repoRoot, file),
      skip: livePre.ok ? null : livePre.reason,
      cmd: process.execPath,
      args: [file, livePre.origin || ''],
      env: { ...process.env },
    }));
    allResults.push(...r4);
  }

  const pass = allResults.filter(r => r.outcome === 'pass').length;
  const fail = allResults.filter(r => r.outcome === 'fail').length;
  const skip = allResults.filter(r => r.outcome === 'skip').length;

  console.log('\n── Totals ──');
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}   (mode: ${MODE})`);
  if (skip > 0) {
    console.log('Skipped files:');
    for (const r of allResults.filter(r => r.outcome === 'skip')) {
      console.log(`  - ${r.label} — ${r.reason}`);
    }
  }
  if (fail > 0) {
    console.log('Failed files:');
    for (const r of allResults.filter(r => r.outcome === 'fail')) {
      console.log(`  - ${r.label} — ${r.reason}`);
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('runner crashed:', err);
  process.exit(2);
});
