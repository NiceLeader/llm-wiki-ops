#!/usr/bin/env node
'use strict';
// llm-wiki-ops: operations engine for an agent-maintained Obsidian vault
// (Karpathy's "LLM wiki" pattern, hardened by daily production use).
//
//   llm-wiki-ops init [dir]    scaffold a vault: config, INDEX law, log, dirs
//   llm-wiki-ops refresh       junctions -> hubs -> snapshot -> lint -> tripwire -> stamp -> alert
//
// Everything is driven by vault.config.json in the vault root. No hardcoded
// paths, no telemetry, no network calls except the optional ntfy alert you
// configure yourself.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

const cmd = process.argv[2];
const argDir = process.argv[3];

function die(msg) { console.error('llm-wiki-ops: ' + msg); process.exit(1); }

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

// Run a git command, never throw; optionally capture stdout.
function execSyncSafe(cmd, cwd, capture) {
  try {
    return execSync(cmd, {
      cwd, encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'ignore'] : 'ignore',
    }) || '';
  } catch { return ''; }
}

function loadConfig(vault) {
  const p = path.join(vault, 'vault.config.json');
  if (!fs.existsSync(p)) die('no vault.config.json in ' + vault + ' (run: llm-wiki-ops init)');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    junctions: c.junctions || {},
    areaTitles: c.areaTitles || {},
    writeZones: c.writeZones || ['wiki', 'events', 'projects'],
    hotFile: c.hotFile || 'HOT.md',
    digestDir: c.digestDir || 'wiki/digests',
    reviewFlagZones: c.reviewFlagZones || ['wiki'],
    forbiddenTracked: c.forbiddenTracked || [],
    git: Object.assign({ snapshot: false }, c.git),
    alerts: Object.assign({ ntfyTopic: null, hotStaleDays: 7, digestStaleDays: 8 }, c.alerts),
    skipDirs: ['.obsidian', '.git', '.tools', 'node_modules', 'hubs'].concat(c.skipDirs || []),
  };
}

// ---------------------------------------------------------------- junctions
// Directory junctions on Windows (no elevation needed), symlinks elsewhere.
// Self-healing: a link whose target vanished is removed (dangling junctions
// break git status walks and Obsidian indexing) and re-created when the
// target returns.
function ensureJunctions(vault, cfg) {
  for (const [name, rawTarget] of Object.entries(cfg.junctions)) {
    const target = expandHome(rawTarget);
    const dst = path.join(vault, name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    let exists = false, dangling = false;
    try {
      fs.lstatSync(dst); exists = true;
      try { fs.statSync(dst); } catch { dangling = true; }
    } catch {}
    if (exists && dangling) {
      fs.rmSync(dst, { recursive: false, force: true });
      console.log('  ! ' + name + ' (dangling - removed; relinks when target returns)');
      exists = false;
    }
    if (!fs.existsSync(target)) { if (!exists) console.log('  skip (target missing): ' + name); continue; }
    if (exists) { console.log('  = ' + name); continue; }
    fs.symlinkSync(target, dst, process.platform === 'win32' ? 'junction' : 'dir');
    console.log('  + ' + name + ' -> ' + target);
  }
}

// --------------------------------------------------------------------- walk
// Vault-structure dirs ('hubs', '.tools') are only special at the vault
// ROOT - a junctioned source legitimately containing a dir named "hubs"
// must not have that subtree silently dropped from catalogs and lint.
// Truly-noise dirs (VCS, package caches) are skipped at every depth.
const SKIP_ANYWHERE = new Set(['.obsidian', '.git', 'node_modules']);
function* walk(vault, cfg, dir, rel) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const atRoot = rel === '';
    const skipHere = SKIP_ANYWHERE.has(e.name) || (atRoot && cfg.skipDirs.includes(e.name));
    if (skipHere || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    let isDir = e.isDirectory();
    // Junctions report as symlinks; stat through them (skip when dangling).
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch { continue; } }
    if (isDir) yield* walk(vault, cfg, full, r);
    else if (e.name.endsWith('.md')) yield { full, rel: r };
  }
}

// --------------------------------------------------------------------- hubs
// Regenerate hubs/ (MOC per area) + Home.md from scratch each run, so the
// catalog can never rot. Links use vault-relative paths ([[dir/file|Title]])
// so duplicate basenames (README.md x N) never collide.
function titleOf(file, fallback) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch { return fallback; }
  if (txt.startsWith('---')) {
    const end = txt.indexOf('\n---', 3);
    if (end > 0) txt = txt.slice(end + 4);
  }
  const h = txt.match(/^#{1,2}\s+(.+)$/m);
  if (h) return h[1].trim().slice(0, 80);
  const line = txt.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('<'));
  return (line || fallback).slice(0, 80);
}

function autoTitle(key) {
  const [head, ...rest] = key.split('/');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return rest.length ? cap(head) + ' - ' + rest.join('/') : cap(head);
}

function buildHubs(vault, cfg) {
  const HUBS = path.join(vault, 'hubs');
  // area keys = every junction + every write zone
  const areaKeys = [...Object.keys(cfg.junctions), ...cfg.writeZones]
    .filter((v, i, a) => a.indexOf(v) === i);
  const areaFiles = {};
  for (const k of areaKeys) areaFiles[k] = [];
  const loose = [];
  // Root meta files are already linked from the law line - listing them
  // under "Loose files" made every clean vault report loose files forever.
  const META = new Set(['INDEX.md', 'Home.md', 'log.md', cfg.hotFile, 'vault.config.json']);
  for (const f of walk(vault, cfg, vault, '')) {
    if (META.has(f.rel)) continue;
    const area = areaKeys
      .filter((k) => f.rel.startsWith(k + '/'))
      .sort((a, b) => b.length - a.length)[0];
    if (area) areaFiles[area].push(f); else loose.push(f);
  }

  fs.rmSync(HUBS, { recursive: true, force: true });
  fs.mkdirSync(HUBS, { recursive: true });

  const link = (f, title) => '[[' + f.rel.replace(/\.md$/, '') + '|' + title.replace(/[|[\]]/g, ' ') + ']]';
  let hubCount = 0, linkCount = 0;
  const homeAreas = [];
  for (const area of areaKeys) {
    const files = areaFiles[area];
    if (!files.length) continue;
    const title = cfg.areaTitles[area] || autoTitle(area);
    const tag = area.split('/')[0];
    const lines = ['---', 'tags: [hub, ' + tag + ']', '---', '', '# ' + title, ''];
    const bySub = {};
    for (const f of files) {
      const sub = path.dirname(f.rel.slice(area.length + 1));
      (bySub[sub === '.' ? '' : sub] = bySub[sub === '.' ? '' : sub] || []).push(f);
    }
    for (const sub of Object.keys(bySub).sort()) {
      if (sub) lines.push('## ' + sub, '');
      for (const f of bySub[sub].sort((a, b) => a.rel.localeCompare(b.rel))) {
        lines.push('- ' + link(f, titleOf(f.full, path.basename(f.rel, '.md'))));
        linkCount++;
      }
      lines.push('');
    }
    lines.push('', '-> [[Home]]');
    // Sanitized titles can collide (identical areaTitles, or symbols-only
    // titles reducing to the same string) - a collision would silently
    // overwrite the earlier hub while Home still lists both. Dedupe with a
    // numeric suffix; an empty result falls back to the area key.
    let hubName = title.replace(/[^\p{L}\p{N} -]/gu, '').trim()
      || area.replace(/[^\p{L}\p{N} -]/gu, ' ').trim() || 'area';
    const taken = new Set(homeAreas.map((a) => a.hubName));
    for (let n = 2; taken.has(hubName); n++) hubName = hubName.replace(/ \(\d+\)$/, '') + ' (' + n + ')';
    fs.writeFileSync(path.join(HUBS, hubName + '.md'), lines.join('\n'));
    homeAreas.push({ area, title, hubName, count: files.length });
    hubCount++;
  }

  const home = ['---', 'tags: [hub, home]', '---', '', '# Vault - Home', '',
    'Graph center of mass. Areas:', ''];
  for (const a of homeAreas) home.push('- [[hubs/' + a.hubName + '|' + a.title + ']] (' + a.count + ')');
  home.push('', 'Vault law: [[INDEX]] | operations ledger: [[log]]', '');
  if (loose.length) {
    home.push('## Loose files', '');
    for (const f of loose) home.push('- ' + link(f, titleOf(f.full, f.rel)));
  }
  fs.writeFileSync(path.join(vault, 'Home.md'), home.join('\n'));
  console.log(hubCount + ' hubs, ' + linkCount + ' links, ' + loose.length + ' loose files');
}

// --------------------------------------------------------------------- lint
// Deterministic, zero-token lint: dead wikilinks + freshness + attention
// budget. (The SEMANTIC lint - contradictions, stale claims - is an agent
// operation: see prompts/semantic-lint.md.)
function lint(vault, cfg) {
  const files = new Map();
  for (const f of walk(vault, cfg, vault, '')) files.set(f.rel.replace(/\.md$/, ''), f.full);
  // hubs are skipped by walk (regenerated); add them for link resolution + linting
  const hubsDir = path.join(vault, 'hubs');
  try {
    for (const f of fs.readdirSync(hubsDir)) {
      if (f.endsWith('.md')) files.set('hubs/' + f.replace(/\.md$/, ''), path.join(hubsDir, f));
    }
  } catch {}
  // Resolve like Obsidian: exact vault-relative path, or unique basename.
  const byBase = new Map();
  for (const p of files.keys()) {
    const b = p.split('/').pop();
    byBase.set(b, byBase.has(b) ? null : p); // null = ambiguous
  }
  let dead = 0;
  const deadSamples = [];
  // Only OUR layers can rot by our hand; junctioned content is source-owned.
  const layers = [...cfg.writeZones, 'hubs', 'Home.md', cfg.hotFile, 'INDEX.md', 'log.md'];
  for (const layer of layers) {
    const roots = [];
    const lp = path.join(vault, layer);
    try {
      if (fs.statSync(lp).isDirectory()) {
        for (const f of walk(vault, { ...cfg, skipDirs: cfg.skipDirs.filter((d) => d !== 'hubs') }, lp, layer)) roots.push(f.full);
      } else roots.push(lp);
    } catch { continue; }
    for (const f of roots) {
      // Obsidian does not resolve wikilinks inside code - strip fenced blocks
      // and inline code first, or examples in prose false-positive.
      const txt = fs.readFileSync(f, 'utf8')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '');
      for (const m of txt.matchAll(/\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\\?\|[^\]]*)?\]\]/g)) {
        // Obsidian does NOT render wikilinks containing a line break.
        if (m[0].includes('\n')) {
          dead++;
          if (deadSamples.length < 5) deadSamples.push(path.basename(f) + ' -> multiline wikilink');
          continue;
        }
        // In markdown tables the alias pipe is escaped (\|) - strip the
        // trailing backslash the capture picks up in that case.
        const t = m[1].trim().replace(/\\$/, '');
        // Links/embeds to non-markdown attachments ([[photo.png]], [[report.pdf]])
        // are resolved by Obsidian against ALL files; our map only holds .md,
        // so skip them instead of reporting permanent false-positive dead links.
        if (/\.[a-z0-9]{2,5}$/i.test(t) && !/\.md$/i.test(t)) continue;
        if (!files.has(t) && !byBase.get(t)) {
          dead++;
          if (deadSamples.length < 5) deadSamples.push(path.basename(f) + ' -> [[' + t + ']]');
        }
      }
    }
  }
  let hotAgeDays = null;
  try { hotAgeDays = Math.round((Date.now() - fs.statSync(path.join(vault, cfg.hotFile)).mtimeMs) / 86400000); } catch {}
  let digestAgeDays = null;
  try {
    const dd = path.join(vault, cfg.digestDir);
    const entries = fs.readdirSync(dd);
    // Empty digest dir must still age (else "never wrote the first digest"
    // can never alarm): fall back to the directory's own mtime.
    const newest = entries.length
      ? Math.max(...entries.map((f) => fs.statSync(path.join(dd, f)).mtimeMs))
      : fs.statSync(dd).mtimeMs;
    if (Number.isFinite(newest)) digestAgeDays = Math.round((Date.now() - newest) / 86400000);
  } catch {}
  // Attention budget: agent notes waiting for human review. The documented
  // failure mode of agent-written vaults is output accumulating faster than
  // it gets read - count it, surface it.
  let unreviewed = 0;
  for (const [rel, full] of files) {
    if (!cfg.reviewFlagZones.some((z) => rel.startsWith(z + '/'))) continue;
    try {
      if (/^reviewed:\s*false/m.test(fs.readFileSync(full, 'utf8').slice(0, 400))) unreviewed++;
    } catch {}
  }
  return { deadLinks: dead, deadSamples, hotAgeDays, digestAgeDays, unreviewed };
}

// ----------------------------------------------------------------- tripwire
// No tracked path may ever match a forbidden pattern (client material,
// indexer caches that copy content past your .gitignore). Path-level = cheap
// and false-positive-free; a hit is always a real breach of the vault law.
function tripwire(vault, cfg) {
  if (!cfg.forbiddenTracked.length) return [];
  try {
    // -z: NUL-separated, unquoted - default core.quotePath mangles non-ASCII
    // paths ("private/\305\274.md") and the prefix match silently misses them.
    const tracked = execSync('git ls-files -z', { cwd: vault, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0');
    return tracked.filter((f) => cfg.forbiddenTracked.some((p) => f.startsWith(p)));
  } catch { return []; }
}

// ------------------------------------------------------------------ refresh
function refresh(vault) {
  const cfg = loadConfig(vault);
  ensureJunctions(vault, cfg);
  buildHubs(vault, cfg);

  // On Windows, git does NOT see directory junctions as symlinks - `git add -A`
  // traverses them and stages every file inside the junction TARGETS (agent
  // memories, private docs...). On Linux the same config stages only a link
  // stub. Unless the user explicitly opts in to backing up junction content
  // (git.includeJunctions: true), keep mounts out of the snapshot via a
  // managed .gitignore block - same behavior on every platform, no surprises.
  if (cfg.git.snapshot && cfg.git.includeJunctions !== true) {
    const gi = path.join(vault, '.gitignore');
    const BEGIN = '# BEGIN llm-wiki-ops junction mounts (managed - do not edit)';
    const END = '# END llm-wiki-ops junction mounts';
    const block = [BEGIN, ...Object.keys(cfg.junctions).map((m) => '/' + m + '/'), END].join('\n');
    let txt = '';
    try { txt = fs.readFileSync(gi, 'utf8'); } catch {}
    const re = new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END);
    const next = re.test(txt) ? txt.replace(re, block) : (txt.trimEnd() + '\n\n' + block + '\n');
    if (next !== txt) fs.writeFileSync(gi, next);
  }

  // TRIPWIRE FIRST - before anything is committed or pushed. A guard that
  // screams AFTER the push has already exfiltrated the forbidden file is a
  // press release, not a guard (review finding; the incident this was born
  // from went exactly that way).
  execSyncSafe('git add -A', vault);
  const forbiddenHits = tripwire(vault, cfg);
  if (forbiddenHits.length) {
    console.log('TRIPWIRE: ' + forbiddenHits.length + ' FORBIDDEN tracked path(s)! e.g. ' + forbiddenHits[0]);
    execSyncSafe('git reset -q', vault); // unstage everything - nothing leaves
  }

  let pushOk = null;
  if (cfg.git.snapshot && !forbiddenHits.length) {
    pushOk = false;
    const hasRemote = execSyncSafe('git remote', vault, true).trim().length > 0;
    try {
      try { execSync('git diff --cached --quiet', { cwd: vault, stdio: 'ignore' }); }
      catch {
        execSync('git commit -q -m "vault snapshot: ' + new Date().toISOString().slice(0, 16) + '"',
          { cwd: vault, stdio: 'ignore' });
      }
      if (!hasRemote) {
        pushOk = null; // committed locally; nothing to push to - not a failure
        console.log('backup: committed locally (no git remote configured - add one for offsite backup).');
      } else {
        execSync('git push -q', { cwd: vault, stdio: 'ignore' });
        pushOk = true;
        console.log('backup: snapshot pushed.');
      }
    } catch { console.log('backup: push FAILED (offline? no upstream? run `git push -u` once) - stamp records it.'); }
  } else if (cfg.git.snapshot && forbiddenHits.length) {
    console.log('backup: SKIPPED - tripwire hit, nothing was committed or pushed.');
  }

  const lintRes = lint(vault, cfg);
  if (lintRes.deadLinks) console.log('lint: ' + lintRes.deadLinks + ' dead wikilink(s): ' + lintRes.deadSamples.join('; '));
  if (lintRes.hotAgeDays > cfg.alerts.hotStaleDays) console.log('lint: ' + cfg.hotFile + ' not touched for ' + lintRes.hotAgeDays + ' days.');

  // Execution stamp: external health checks verify freshness against this
  // (the "is it ACTUALLY updating" question). Local-only; gitignore it.
  let unpushed = null;
  try {
    unpushed = Number(execSync('git rev-list --count @{upstream}..HEAD',
      { cwd: vault, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) || 0;
  } catch {}
  fs.writeFileSync(path.join(vault, '.last-refresh.json'), JSON.stringify({
    ts: new Date().toISOString(), pushOk, unpushed,
    deadLinks: lintRes.deadLinks, hotAgeDays: lintRes.hotAgeDays,
    digestAgeDays: lintRes.digestAgeDays, unreviewed: lintRes.unreviewed,
    forbiddenTracked: forbiddenHits.length,
  }, null, 2));

  // Autonomy loop closure: a RED sensor must reach a human without anyone
  // polling. Optional, off unless you set alerts.ntfyTopic. Fail-soft.
  if (cfg.alerts.ntfyTopic) {
    try {
      const alarms = [];
      if (pushOk === false) alarms.push('backup push FAILED');
      if (lintRes.deadLinks) alarms.push(lintRes.deadLinks + ' dead links');
      if (lintRes.hotAgeDays > cfg.alerts.hotStaleDays) alarms.push('HOT stale ' + lintRes.hotAgeDays + 'd');
      if (lintRes.digestAgeDays > cfg.alerts.digestStaleDays) alarms.push('digest stale ' + lintRes.digestAgeDays + 'd');
      if (forbiddenHits.length) alarms.push('TRIPWIRE: ' + forbiddenHits.length + ' forbidden tracked paths - PURGE NOW');
      if (alarms.length) {
        execFileSync('curl', ['-s', '-m', '10', '-d', 'vault ALARM: ' + alarms.join(', '),
          'https://ntfy.sh/' + cfg.alerts.ntfyTopic], { stdio: 'ignore' });
        console.log('ntfy: alarm sent (' + alarms.join(', ') + ')');
      }
    } catch { /* offline - the stamp still records the state */ }
  }
  console.log('\nvault refreshed - reload the graph view in Obsidian.');
}

// --------------------------------------------------------------------- init
function init(dir) {
  const vault = path.resolve(dir || '.');
  fs.mkdirSync(vault, { recursive: true });
  const here = path.join(__dirname, '..');
  const copies = [
    ['templates/vault.config.example.json', 'vault.config.json'],
    ['templates/INDEX.md', 'INDEX.md'],
    ['templates/log.md', 'log.md'],
    ['templates/HOT.md', 'HOT.md'],
  ];
  for (const [src, dst] of copies) {
    const to = path.join(vault, dst);
    if (fs.existsSync(to)) { console.log('  = ' + dst + ' (kept)'); continue; }
    fs.copyFileSync(path.join(here, src), to);
    console.log('  + ' + dst);
  }
  for (const d of ['wiki', 'wiki/digests', 'events', 'projects']) {
    fs.mkdirSync(path.join(vault, d), { recursive: true });
  }
  const gi = path.join(vault, '.gitignore');
  if (!fs.existsSync(gi)) {
    fs.writeFileSync(gi, '.obsidian/\n.last-refresh.json\n# every indexing plugin cache goes here BEFORE its first snapshot:\n.smart-env/\n');
    console.log('  + .gitignore');
  }
  console.log('\nvault scaffolded at ' + vault + '\nnext: edit vault.config.json, then run: llm-wiki-ops refresh');
}

// --------------------------------------------------------------------- main
if (cmd === 'init') init(argDir);
else if (cmd === 'refresh') refresh(path.resolve(argDir || '.'));
else {
  console.log('usage: llm-wiki-ops init [dir] | llm-wiki-ops refresh [dir]');
  process.exit(cmd ? 1 : 0);
}
