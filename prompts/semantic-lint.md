# Operation: SEMANTIC LINT

> Fill every `{PLACEHOLDER}` ({VAULT_PATH}, {HOT_FILE}, {DATE}, {ISO_WEEK}...) with your real values before running - these are templates for your agent, not literal commands.

Run this prompt with your coding agent (Claude Code, Codex, ...) pointed at
the vault, ideally right before the weekly digest. The refresh script catches
dead links; this catches the lies. Battle-tested: the first production run of
this prompt found 12 real defects, including a finance canon page asserting a
contract end-date that had been superseded four days earlier.

---

You are running a SEMANTIC LINT of an Obsidian knowledge vault at {VAULT_PATH}
- the Karpathy LLM-wiki "lint" operation: find contradictions, stale claims,
and drift between pages. READ-ONLY: do not edit any file during the hunt.

Scope (agent-written meta layer ONLY - do not lint junctioned source content):
- {HOT_FILE} (the "read-first" current-context page)
- projects/*.md (per-project entry nodes)
- wiki/*.md (syntheses; skip wiki/digests/ except the newest one)
- events/*.md (append-only daily journal = the freshest source of truth;
  newer events win over older wiki/project claims)
- INDEX.md, Home.md (structural claims only)

Today is {DATE}.

Hunt for:
1. CONTRADICTIONS: two pages asserting incompatible facts (dates, statuses,
   versions, states). Cite both files with the exact quoted lines.
2. STALE CLAIMS: a page stating something a NEWER events/ entry or newer page
   supersedes (old dates, "in progress" things already done, old version
   numbers, outdated plans).
3. BROKEN PROMISES: "TODO / open / fill in later" markers older than a few
   days that reference things now known.
4. ORPHANS: wiki/ or projects/ pages with no inbound wikilink from
   HOT/Home/wiki/projects (generated hubs do not count).
5. MISSING CROSS-REFS: a page discussing a topic that has a dedicated page
   but does not link it.

Method: read {HOT_FILE}, INDEX.md, all projects/*.md, all top-level wiki/*.md,
the newest 5 events files, the newest digest. Then grep for date strings,
version strings, and status words you saw along the way.

Be adversarial with yourself: before reporting a finding, verify the "newer
truth" actually exists in a file you read (quote it). No speculative findings.

Return a numbered list, most severe first. For each: [type] file - quoted
stale/contradicting line - quoted evidence line from the newer source (file).
Max 15 findings. If clean, say what you checked and that it is clean.

---

After the hunt: fix confirmed findings following the supersedes discipline
(update in place, never a -v2 file), then append one line to log.md:
`- [DATE] lint | N findings | one-line summary of the worst ones`
