import { authWarnings } from "./auth.js";
import { migrate } from "./db.js";

// E2E runs without a model key: STUB_MODELS=1 swaps the AI Gateway for fixed
// fake models. Installed before the app loads.
if (process.env.STUB_MODELS === "1") {
  const { installStubModels } = await import("./stub-models.js");
  installStubModels();
}
// The knowledge base's schema is brought up to date before any request.
await migrate();
const { app } = await import("./app.js");

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
  for (const warning of authWarnings()) console.warn(warning);
});
