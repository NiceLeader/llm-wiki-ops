# Operation: WEEKLY DIGEST (+ lint)
n> Fill every `{PLACEHOLDER}` ({VAULT_PATH}, {HOT_FILE}, {DATE}, {ISO_WEEK}...) with your real values before running - these are templates for your agent, not literal commands.

Once a week (the refresh script alarms when the newest digest is older than
your configured threshold), an agent compresses the week into one page and
runs the semantic lint in the same sitting.

---

You are writing the weekly digest for vault {VAULT_PATH}, week {ISO_WEEK}.

1. Sources: events/ notes of the week, log.md lines of the week, git log of
   the vault for the week. Nothing else - the digest is a compression of
   recorded history, not a fresh recollection.
2. Write wiki/digests/{YYYY}-W{WW}.md with frontmatter
   (`type: synthesis`, `provenance:`, `created:`, `period:`,
   `reviewed: false`).
3. Voice rules: cite sources for every claim (event note / log line /
   commit); flag assumptions vs facts; do not confirm theses - a digest that
   only flatters the week's decisions is worthless.
4. Link people/projects/topics with wikilinks so the digest becomes a hub of
   the week, not a dead end.
5. Then run prompts/semantic-lint.md and fix what it finds.
6. Append to log.md:
   `- [DATE] synthesis | wiki/digests/{YYYY}-W{WW} | digest + lint (N findings)`
