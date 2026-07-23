'use strict';
// llm-wiki-ops test suite. Run: node test/test.js
// Builds a real fixture vault in tmp, runs the real CLI against it, asserts
// on the files it produces.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'llm-wiki-ops.js');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, msg) {
  if (cond) pass++;
  else { fail++; failures.push(name + (msg ? ' - ' + msg : '')); }
}

function run(args, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd, timeout: 60000 });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lwo-test-'));
const vault = path.join(root, 'vault');
const sourceDir = path.join(root, 'source-notes');
fs.mkdirSync(sourceDir, { recursive: true });
fs.writeFileSync(path.join(sourceDir, 'alpha.md'), '# Alpha note\n\ncontent');
fs.writeFileSync(path.join(sourceDir, 'beta.md'), 'no heading, first line becomes title');

// --- init -------------------------------------------------------------------
{
  const out = run(['init', vault], root);
  ok('init scaffolds config + law + ledger',
    ['vault.config.json', 'INDEX.md', 'log.md', 'HOT.md', '.gitignore']
      .every((f) => fs.existsSync(path.join(vault, f))));
  ok('init creates write zones',
    ['wiki', 'wiki/digests', 'events', 'projects'].every((d) => fs.statSync(path.join(vault, d)).isDirectory()));
  const again = run(['init', vault], root);
  ok('init is idempotent (keeps existing files)', again.includes('(kept)'));
}

// --- configure the fixture --------------------------------------------------
{
  const cfg = JSON.parse(fs.readFileSync(path.join(vault, 'vault.config.json'), 'utf8'));
  cfg.junctions = { 'research/notes': sourceDir.replace(/\\/g, '/') };
  cfg.forbiddenTracked = ['private/'];
  cfg.git = { snapshot: false };
  fs.writeFileSync(path.join(vault, 'vault.config.json'), JSON.stringify(cfg, null, 2));
  // wiki page with: one good link, one dead link, a dead link inside a code
  // fence (must NOT count), and an escaped-pipe table alias (must resolve).
  fs.writeFileSync(path.join(vault, 'wiki', 'synthesis.md'), [
    '---', 'type: synthesis', 'reviewed: false', '---', '',
    '# Synthesis', '',
    'Good link: [[research/notes/alpha|Alpha]].',
    'Dead link: [[does-not-exist-anywhere]].',
    '```',
    'fenced example: [[also-missing-but-in-code]]',
    '```',
    '| col |', '|---|', '| [[research/notes/beta\\|Beta]] |', '',
  ].join('\n'));
  fs.writeFileSync(path.join(vault, 'wiki', 'reviewed-note.md'),
    '---\ntype: fact\nreviewed: true\n---\n\n# Done note\n');
}

// --- refresh: junctions + hubs ---------------------------------------------
{
  const out = run(['refresh', vault], root);
  const linked = fs.existsSync(path.join(vault, 'research', 'notes', 'alpha.md'));
  ok('junction/symlink created and readable through the vault', linked);
  ok('hubs regenerated', fs.readdirSync(path.join(vault, 'hubs')).length >= 2);
  ok('Home.md generated with area counts', /\(\d+\)/.test(fs.readFileSync(path.join(vault, 'Home.md'), 'utf8')));
  const hubDir = path.join(vault, 'hubs');
  const researchHub = fs.readdirSync(hubDir).find((f) => /research/i.test(f));
  ok('area hub links files by heading title',
    researchHub && fs.readFileSync(path.join(hubDir, researchHub), 'utf8').includes('Alpha note'));
}

// --- refresh: lint + stamp --------------------------------------------------
{
  const stamp = JSON.parse(fs.readFileSync(path.join(vault, '.last-refresh.json'), 'utf8'));
  ok('lint counts exactly the one dead link (code fence excluded, escaped pipe resolved)',
    stamp.deadLinks === 1, 'got ' + stamp.deadLinks);
  ok('attention budget counts unreviewed wiki notes',
    stamp.unreviewed === 1, 'got ' + stamp.unreviewed);
  ok('stamp records timestamps and freshness fields',
    !!stamp.ts && 'hotAgeDays' in stamp && 'digestAgeDays' in stamp);
}

// --- tripwire ---------------------------------------------------------------
{
  execFileSync('git', ['init', '-q'], { cwd: vault });
  fs.mkdirSync(path.join(vault, 'private'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'private', 'client-secret.md'), 'must never be tracked');
  execFileSync('git', ['add', '-A'], { cwd: vault });
  const out = run(['refresh', vault], root);
  ok('tripwire fires on forbidden tracked path', out.includes('TRIPWIRE'));
  const stamp = JSON.parse(fs.readFileSync(path.join(vault, '.last-refresh.json'), 'utf8'));
  ok('stamp records the tripwire hit', stamp.forbiddenTracked >= 1);
}

// --- self-heal: dangling junction ------------------------------------------
{
  fs.rmSync(sourceDir, { recursive: true, force: true });
  const out = run(['refresh', vault], root);
  ok('dangling junction is removed (self-heal)', out.includes('dangling'));
  ok('vault path no longer holds the dead link entry',
    !fs.existsSync(path.join(vault, 'research', 'notes')));
}

// --- verdict ----------------------------------------------------------------
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); for (const f of failures) console.log('  ✗ ' + f); }
process.exit(fail ? 1 : 0);
