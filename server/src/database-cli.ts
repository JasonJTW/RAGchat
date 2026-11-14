import { createDatabase, dropDatabase } from "./databases.js";
import { DEFAULT_DATABASE_URL } from "./db.js";

// `npm run db:create -w server` / `npm run db:drop -w server`: creates or
// drops the database DATABASE_URL names (the E2E run uses its own).
const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
if (process.argv[2] === "drop") await dropDatabase(url);
else await createDatabase(url);
