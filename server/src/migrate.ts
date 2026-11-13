import { closeDb, migrate } from "./db.js";

// `npm run db:migrate -w server`: applies pending migrations to DATABASE_URL.
await migrate();
await closeDb();
console.log("migrations applied");
