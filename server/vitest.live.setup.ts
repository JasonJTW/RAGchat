import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { inject } from "vitest";

// Live tests call the real models, so unlike vitest.setup.ts no stub is
// installed: the model settings come from the shell, else the root .env.
// Everything else is as in the unit tests: this run's own database and
// pseudonym key, stub sign-in and human check. De-identification uses the
// Presidio sidecar (`npm run presidio:up`) unless PII_ANALYZER=local.
const MODEL_ENV = [
  "AI_GATEWAY_API_KEY",
  "JEV_API_KEY",
  "CHAT_MODEL",
  "EXTRACT_MODEL",
  "GUEST_MODEL",
  "EMBEDDING_MODEL",
  "PII_ANALYZER",
  "PRESIDIO_URL",
];
const root = rootEnv();
for (const name of MODEL_ENV)
  if (!(name in process.env) && root[name]) process.env[name] = root[name];

process.env.DATABASE_URL = inject("databaseUrl");
process.env.STUB_AUTH = "1";
delete process.env.CLERK_SECRET_KEY;
process.env.STUB_TURNSTILE = "1";
process.env.PSEUDONYM_ENCRYPTION_KEY = inject("pseudonymKey");

function rootEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
  } catch {
    return {};
  }
}
