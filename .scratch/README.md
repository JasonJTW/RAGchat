# .scratch

Local issue tracker: specs and tickets live here as markdown. See `docs/agents/issue-tracker.md` for the full rules.

```
.scratch/
└── <feature-slug>/
    ├── spec.md              ← what to build and why (written by /to-spec)
    ├── map.md               ← open questions for a larger effort (/wayfinder)
    └── issues/
        ├── 01-<slug>.md     ← one ticket per file (written by /to-tickets)
        └── 02-<slug>.md
```

- Each ticket has a `Status:` line near the top using the labels in `docs/agents/triage-labels.md`.
- Conversation history goes at the bottom of the file under `## Comments`.
- Delete or archive a feature folder once it ships; the code and ADRs are the lasting record.
