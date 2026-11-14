import { execFileSync } from "node:child_process";
import path from "node:path";

// Drops the E2E server's database (see playwright.config.ts).
export default function globalTeardown() {
  execFileSync("npm", ["run", "db:drop", "-w", "server"], {
    cwd: path.join(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
    stdio: "inherit",
  });
}
