# Architecture Decision Records

One file per decision that was hard to reverse, surprising without context, or a real trade-off. Format and rules come from `/domain-modeling`.

- Name files `NNNN-slug.md`, numbered sequentially from `0001` (find the highest number and add one).
- Keep each ADR short:

  ```md
  # {Short title of the decision}

  {1-3 sentences: what's the context, what did we decide, and why.}
  ```

- Never rewrite an accepted ADR to change the decision; add a new one that supersedes it.
- Agents read the ADRs that touch the area they work in and flag any conflict instead of silently overriding it (see `docs/agents/domain.md`).
