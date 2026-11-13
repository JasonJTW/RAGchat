import { inject } from "vitest";
import { installStubModels } from "./src/stub-models.js";

// Every test file gets fake models, so tests never reach the AI Gateway. The database is this run's own
// (vitest.global-setup.ts), shared by every test file: keep tests apart by
// giving each its own workspace, never by emptying tables.
process.env.DATABASE_URL = inject("databaseUrl");
installStubModels();
// Sign-in is faked by a cookie (stub-auth.ts); a real Clerk key would turn
// the stub off, so none is ever set in tests.
process.env.STUB_AUTH = "1";
delete process.env.CLERK_SECRET_KEY;
