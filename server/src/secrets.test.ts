import { describe, expect, it } from "vitest";
import { containsSecret } from "./secrets.js";

// Fake secrets, assembled so this file holds none in one piece.
const fake = (...parts: string[]) => parts.join("");

describe("containsSecret", () => {
  it.each([
    ["a password told in Chinese", "測試站的密碼是 hunter2!"],
    ["a password after a colon", "帳號 admin，密碼：Abc12345"],
    ["a password in English", "password = s3cr3t-Pass"],
    [
      "an OpenAI key",
      fake("用這把 key：sk-proj-", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"),
    ],
    ["an Anthropic key", fake("sk-ant-api03-", "x".repeat(40))],
    ["an AWS access key", fake("AKIA", "IOSFODNN7EXAMPLE")],
    ["a GitHub token", fake("ghp_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8")],
    ["a private key", fake("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIEow\n")],
    [
      "an API key assignment",
      fake("API_KEY=", "f3a9c1d2e4b5a6978877665544332211"),
    ],
    [
      "a URL with a password",
      fake("https://admin:", "hunter22@db.example.com"),
    ],
  ])("finds %s", async (_name, text) => {
    expect(await containsSecret(text)).toBe(true);
  });

  it.each([
    "密碼重設流程改成寄信驗證。",
    "密碼：請洽管理員。",
    "API key 要放在 .env，不要寫進程式碼。",
    "避免排放 = 基線排放 - 專案排放",
    "會議在 2026-05-14 舉行。",
  ])("finds none in %s", async (text) => {
    expect(await containsSecret(text)).toBe(false);
  });
});
