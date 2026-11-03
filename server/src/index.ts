import { adminPasswordMissing } from "./auth.js";

// E2E runs without a model key: STUB_MODELS=1 swaps the AI Gateway for fixed
// fake embeddings. Installed before the app loads, since loading the document
// store may re-embed.
if (process.env.STUB_MODELS === "1") {
  const { installStubModels } = await import("./stub-models.js");
  installStubModels();
}
const { app } = await import("./app.js");

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
  if (adminPasswordMissing()) {
    console.warn(
      "ADMIN_PASSWORD is not set in the root .env: nobody can log in to /admin.",
    );
  }
});
