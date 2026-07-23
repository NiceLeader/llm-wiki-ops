# llm-wiki-ops

[![test](https://github.com/NiceLeader/llm-wiki-ops/actions/workflows/test.yml/badge.svg)](https://github.com/NiceLeader/llm-wiki-ops/actions/workflows/test.yml)

**The operations engine for an agent-maintained Obsidian vault - Karpathy's [LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), hardened by daily production use.**

Karpathy's idea: keep a personal wiki of markdown files that an LLM maintains
for you - raw sources, an agent-owned wiki layer, an index, a log, and three
operations (ingest, query, lint). The gist gives you the idea. This repo gives
you the machinery that keeps such a vault healthy once you actually live in
it: the parts I only discovered I needed after my agents and I had written a
few hundred pages.

## What the pattern looks like after contact with reality

- **Raw layer as live junctions, not copies.** Your agent memories, project
  docs, and research dirs stay where they live; the vault mounts them via
  directory junctions (Windows, no elevation) or symlinks (everywhere else).
  No copy drift, self-healing when a target vanishes.
- **Generated MOC hubs.** `hubs/` + `Home.md` are rebuilt from scratch on
  every refresh - the catalog cannot rot, duplicate basenames (`README.md`
  x N) cannot collide, and Obsidian's graph gets a connected center instead
  of confetti.
- **Deterministic lint, zero tokens.** Dead-wikilink detection that resolves
  links the way Obsidian actually does (unique-basename matching, code fences
  stripped, escaped table pipes, multiline links flagged as defects) plus
  freshness sensors: how old is your read-first HOT page, how old is the
  newest weekly digest.
- **Attention budget.** Agent notes carry `reviewed: false` frontmatter; the
  refresh counts how many await human eyes. The documented failure mode of
  agent-written vaults is output accumulating faster than it gets read -
  measure it, alarm on it.
- **Secrecy tripwire.** Declare forbidden path prefixes (client material,
  indexer plugin caches); if any tracked file ever matches, the refresh
  screams. Born from a real incident: an indexing plugin's cache copied
  content past path-based .gitignore rules and pushed it before anyone
  noticed. Path-level checks are cheap and false-positive-free.
- **Operations as agent prompts.** The `prompts/` directory ships the three
  recurring operations as ready-to-run prompts for your coding agent:
  - [`semantic-lint.md`](prompts/semantic-lint.md) - hunt contradictions and
    stale claims between pages (first production run: 12 real defects,
    including a "canonical" finance page asserting a superseded contract
    date)
  - [`ingest-propagation.md`](prompts/ingest-propagation.md) - a new fact
    touches ALL pages that cite it, not just the one at hand
  - [`weekly-digest.md`](prompts/weekly-digest.md) - compress the week from
    recorded history, then lint
- **Append-only ops ledger.** `log.md`: one greppable line per operation,
  exactly as the gist prescribes - with typed entries.

## Quickstart

```bash
git clone https://github.com/NiceLeader/llm-wiki-ops
node llm-wiki-ops/bin/llm-wiki-ops.js init my-vault
cd my-vault
# edit vault.config.json: point junctions at your real note/memory/docs dirs
node ../llm-wiki-ops/bin/llm-wiki-ops.js refresh
```

(Not on npm yet - clone is the install. When it lands on npm, `npx llm-wiki-ops` will work as-is.)

Open the folder as an Obsidian vault. Re-run `refresh` after adding sources -
or schedule it daily; the execution stamp (`.last-refresh.json`) lets any
health check verify it is actually running.

## Config

```json
{
  "junctions": { "memory/my-project": "~/.claude/projects/MY-PROJECT/memory" },
  "writeZones": ["wiki", "events", "projects"],
  "hotFile": "HOT.md",
  "digestDir": "wiki/digests",
  "forbiddenTracked": [".smart-env/", "private/"],
  "git": { "snapshot": true },
  "alerts": { "ntfyTopic": "your-private-topic", "hotStaleDays": 7, "digestStaleDays": 8 }
}
```

`git.snapshot: true` commits and pushes the vault to whatever private remote
you configured - that is your backup. `alerts.ntfyTopic` (optional) pushes an
[ntfy](https://ntfy.sh) notification when a sensor goes red (push failed,
dead links, stale HOT/digest, tripwire hit) - a red sensor must reach a human
without anyone polling.

## The vault law

`init` scaffolds an [`INDEX.md`](templates/INDEX.md) - the schema file you
and your agents co-evolve. It encodes the rules that survived contact with
production: write zones, mandatory frontmatter with `reviewed: false`, the
no-v2-files supersedes discipline, cite-your-sources for digests, and the
three operations. Edit it; it is yours.

## What this is not

- Not a sync tool (never point Obsidian Sync/iCloud/Dropbox at a junctioned
  vault - corruption risk is real and documented).
- Not a RAG stack. The pattern's whole bet is that plain markdown + a
  long-context agent beats retrieval infrastructure for a personal corpus.
- Not tied to one agent. Anything that can read files and follow a prompt can
  run the operations; the deterministic engine is plain Node, zero deps.

## License

Apache-2.0 © Maciej Lewandowski - see [LICENSE](LICENSE) and [NOTICE](NOTICE).
The project name and the canonical repo stay with the author; everything else
is yours to use, fork, and ship.
