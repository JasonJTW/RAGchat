import { app } from "./app.js";
import { adminPasswordMissing } from "./auth.js";

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
  if (adminPasswordMissing()) {
    console.warn(
      "ADMIN_PASSWORD is not set in the root .env: nobody can log in to /admin.",
    );
  }
});
