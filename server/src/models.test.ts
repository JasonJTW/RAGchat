import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatModel, embeddings } from "./models.js";

// The real models, not the stubs every other test uses. Building one makes no
// network call.
describe("models", () => {
  let stubs: typeof globalThis.MODEL_STUBS;
  beforeEach(() => {
    stubs = globalThis.MODEL_STUBS;
    globalThis.MODEL_STUBS = undefined;
  });
  afterEach(() => {
    globalThis.MODEL_STUBS = stubs;
    vi.unstubAllEnvs();
  });

  it("answers with CHAT_MODEL", () => {
    vi.stubEnv("CHAT_MODEL", "anthropic/claude-sonnet-5-5");
    const model = chatModel("answer");
    expect(model).toBeInstanceOf(ChatOpenAI);
    expect((model as ChatOpenAI).model).toBe("anthropic/claude-sonnet-5-5");
  });

  it("extracts with EXTRACT_MODEL and serves guests with GUEST_MODEL", () => {
    vi.stubEnv("CHAT_MODEL", "openai/gpt-5-mini");
    vi.stubEnv("EXTRACT_MODEL", "deepseek/deepseek-v3.2");
    vi.stubEnv("GUEST_MODEL", "openai/gpt-5-nano");
    expect((chatModel("extract") as ChatOpenAI).model).toBe(
      "deepseek/deepseek-v3.2",
    );
    expect((chatModel("guest") as ChatOpenAI).model).toBe("openai/gpt-5-nano");
  });

  it("falls back to CHAT_MODEL when a purpose has no model of its own", () => {
    vi.stubEnv("CHAT_MODEL", "openai/gpt-5-mini");
    vi.stubEnv("EXTRACT_MODEL", "");
    vi.stubEnv("GUEST_MODEL", undefined);
    expect((chatModel("extract") as ChatOpenAI).model).toBe(
      "openai/gpt-5-mini",
    );
    expect((chatModel("guest") as ChatOpenAI).model).toBe("openai/gpt-5-mini");
  });

  it("embeds with EMBEDDING_MODEL", () => {
    vi.stubEnv("EMBEDDING_MODEL", "openai/text-embedding-3-large");
    const model = embeddings();
    expect(model).toBeInstanceOf(OpenAIEmbeddings);
    expect(model.model).toBe("openai/text-embedding-3-large");
  });
});
