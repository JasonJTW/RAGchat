import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installStubModels } from "./src/stub-models.js";

// Every test file gets an empty document store and fake embeddings, so tests
// never touch server/data/ or the AI Gateway.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "kb-server-test-"));
installStubModels();
