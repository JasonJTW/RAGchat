# Security review

Trace each finding from untrusted input to its impact and cite `file:line`. Report only confirmed exploitable issues; every one is **blocking** and fails the PR check. Zero findings is a valid result.

## Checklist

Check every item against the changed lines:

1. **Input**: request bodies, params, and LLM tool arguments are parsed with Zod before use.
2. **Authorization**: every changed route verifies the caller may access the resource.
3. **Secrets**: API keys (Anthropic, OpenAI, …) stay server-side in env; secrets never use a `NEXT_PUBLIC_` prefix or reach the client bundle.
4. **LLM**: user and third-party text stays data, never system instructions or tool permissions; model output is untrusted (no eval, no raw HTML, no unvalidated redirects or queries).
5. **Errors and CORS**: 5xx responses carry no internals; CORS origins stay explicit.
6. **Workflows**: secrets and PR-controlled text stay out of shells and `run:` steps.
