# Vault law

An aggregator of personal knowledge: sources stay where they live (directory
junctions - editing here edits the original). Opened in Obsidian as a vault;
for agents it is plain markdown + wikilinks.

## Rules

1. **Write zones.** Junctioned dirs are the RAW layer - read through the
   vault, edit in the source. `wiki/` is the agent zone (syntheses, dossiers,
   cross-links - write freely). `events/YYYY-MM-DD.md` is an append-only
   daily journal (never edit backwards). `hubs/` + `Home.md` are GENERATED -
   never by hand.
2. **Frontmatter is mandatory in new agent notes:** `type:`
   (fact|synthesis|event) · `provenance:` (which agent, or human) ·
   `created:` · `source:` (URL/path when there is one) · **`reviewed: false`**
   (the human flips it to true after reading - the attention budget: refresh
   counts unreviewed notes and alerts when the pile grows). Facts atomically -
   one fact = one file; syntheses densely linked.
3. **No -v2 files (supersedes discipline):** a correction UPDATES or replaces
   the old note (frontmatter `supersedes:` + the old one gets
   `superseded_by:`), NEVER "new-version.md" next to the old - retrieval does
   not know chronology and will cite both.
4. **Digests and syntheses cite sources** - a claim without a source does not
   enter; a digest flags assumptions vs facts, it does not confirm theses.
5. **Agent entry path:** read `Home` → area hub → specific pages. Do not grep
   the whole vault.
6. **LLM-wiki operations:**
   - **INGEST with propagation:** a new fact touches ALL pages that cite it -
     not just the one at hand. Propagation checklist: [[HOT]] (if hot) →
     projects/ node → wiki/ topic pages → a line in [[log]].
   - **QUERY-compounding:** a good answer worked out in a session (analysis,
     comparison, decision research) becomes a wiki/ page with frontmatter -
     knowledge should compound, not evaporate with the context window.
   - **SEMANTIC LINT:** periodically (with the weekly digest) an agent hunts
     contradictions between pages, stale claims (newer events/ wins), orphans
     and missing cross-links (prompt: `prompts/semantic-lint.md`). Result → a
     `lint` line in [[log]]; fixes follow the supersedes discipline. The
     refresh script only catches dead links - this is the semantic layer no
     script sees.
   - `log.md` = append-only operations ledger (greppable, one line per
     operation); events/ stays the narrative journal of the day.
7. **Sync and backup:** never Obsidian Sync/iCloud/Dropbox on a junctioned
   vault (sync tools + junctions = corruption risk). Backup = git to a
   PRIVATE remote, with hard exceptions in .gitignore for anything that must
   never leave the machine - and a tripwire (`forbiddenTracked` in config)
   that alarms if a forbidden path ever becomes tracked. Every indexing
   plugin's cache goes into .gitignore BEFORE its first snapshot (caches copy
   content past path-based exclusions).
