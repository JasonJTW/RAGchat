import { closeDb } from "./db.js";
import { embeddings } from "./models.js";
import { reembed } from "./reembed.js";

// `npm run reembed -w server`: embeds again, with EMBEDDING_MODEL, every row
// of DATABASE_URL stored by another embedding model (see reembed.ts).
const counts = await reembed();
await closeDb();
console.log(`re-embedded with ${embeddings().model}:`, counts);
