import { authWarnings } from "./auth.js";
import { migrate } from "./db.js";
import { turnstileWarnings } from "./turnstile.js";

// E2E runs without a model key: STUB_MODELS=1 swaps the AI Gateway for fixed
// fake models. Installed before the app loads.
if (process.env.STUB_MODELS === "1") {
  const { installStubModels } = await import("./stub-models.js");
  installStubModels();
}
// The knowledge base's schema is brought up to date before any request.
await migrate();
const { app } = await import("./app.js");
const { deleteIdleTrials } = await import("./trial.js");

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
  for (const warning of [...authWarnings(), ...turnstileWarnings()])
    console.warn(warning);
});

// Trials idle for 7 days are deleted: at startup, then every hour.
const IDLE_SWEEP_MS = 60 * 60 * 1000;
const sweep = () =>
  deleteIdleTrials().then(
    (n) => n && console.log(`deleted ${n} idle trial workspace(s)`),
    (error: unknown) => console.error("deleting idle trials failed:", error),
  );
void sweep();
setInterval(() => void sweep(), IDLE_SWEEP_MS).unref();
