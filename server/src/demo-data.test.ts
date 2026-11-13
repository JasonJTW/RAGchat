import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DEMO = path.join(import.meta.dirname, "../demo-data");
const read = (file: string) => readFileSync(path.join(DEMO, file), "utf8");

describe("demo seed", () => {
  it("has a wiki md, a meeting transcript and a repo weekly report", () => {
    expect(readdirSync(path.join(DEMO, "seed")).sort()).toEqual([
      "01-wiki-avoided-emissions.md",
      "02-meeting-2026-05-14.txt",
      "03-repo-weekly-2026-05-18.md",
    ]);
  });

  it("ships an upload file that replaces the current formula in the seed", () => {
    const current = "A = W × EF × R × L";
    const seed = ["02-meeting-2026-05-14.txt", "03-repo-weekly-2026-05-18.md"]
      .map((file) => read(`seed/${file}`))
      .join("\n");
    const upload = read("upload/meeting-2026-11-12.txt");

    expect(read("seed/01-wiki-avoided-emissions.md")).toContain(
      "A = W × EF × R\n",
    );
    expect(seed).toContain(current);
    expect(seed).not.toContain(`${current} − T`);
    expect(upload).toContain(`${current} − T`);
  });
});
