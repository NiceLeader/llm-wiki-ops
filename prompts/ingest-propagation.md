# Operation: INGEST with propagation

The single most common failure of an agent-maintained vault: a new fact lands
on ONE page while every other page that cites it keeps asserting the old
state. (Production example that motivated this operation: a contract
extension was recorded in the pipeline page, while the read-first HOT page
and the project node kept the old end-date for three days.)

Rule: **a new fact touches ALL pages that cite it - not just the one at
hand.**

---

You are ingesting a new fact/source into the vault at {VAULT_PATH}.

1. Record the fact where it primarily belongs (events/ note of the day for
   narrative; the topical wiki/ page for the durable claim).
2. PROPAGATION CHECKLIST - grep the meta layer (HOT, projects/, wiki/) for
   every page that references the entity or the superseded state, and update
   each one:
   - {HOT_FILE} - if the fact changes current context
   - projects/<entity>.md - the entry node
   - wiki/ topic pages - every synthesis citing the old state
3. Mark superseded claims per the supersedes discipline; never leave a page
   asserting the old state without a pointer to the new one.
4. Append one line to log.md:
   `- [DATE] ingest | pages,touched,here | one-liner of the fact`

A single source might touch 10-15 pages. That is not overhead - that is the
entire point of maintaining a wiki instead of a chat log.
