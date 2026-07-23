# log — append-only operations ledger

One line = one operation. Format (greppable):
`- [YYYY-MM-DD] type | pages | one-liner` — types: `ingest` (new source/fact),
`synthesis` (new wiki page), `update` (fact propagation across pages),
`lint` (run + findings count), `decision` (human ruling). Append at the END,
never edit backwards. Narrative of the day → events/; this is the ledger.

- [YYYY-MM-DD] ingest | INDEX, log | vault scaffolded with llm-wiki-ops
