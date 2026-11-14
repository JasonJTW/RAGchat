import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installStubModels } from "./stub-models.js";
import { createWorkspace, type Caller } from "./workspaces.js";

// Each test acts in a workspace of its own; `caller.current` is who is
// signed in, so a test can switch to another 成員 of the same workspace.
const caller = vi.hoisted(() => ({
  current: undefined as unknown as Caller | "signed out",
}));
vi.mock("./workspaces.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspaces.js")>()),
  callerOf: () => Promise.resolve(caller.current),
}));
const { app } = await import("./app.js");

interface Message {
  id: string;
  role: "user" | "assistant";
  parts: { type: string; text?: string; [key: string]: unknown }[];
}

const userMessage = (text: string): Message => ({
  id: randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

/** Sends the conversation so far to the chat; returns the reply's text. */
async function chat(id: string, messages: Message[]) {
  const res = await request(app)
    .post("/api/chat")
    .send({ id, messages })
    .buffer(true)
    .parse((r, done) => {
      let body = "";
      r.on("data", (chunk: Buffer) => (body += chunk.toString()));
      r.on("end", () => done(null, body));
    });
  return res;
}

/** The caller's saved messages of the conversation (it must be theirs). */
async function messagesOf(id: string): Promise<Message[]> {
  const res = await request(app).get(`/api/conversations/${id}`);
  expect(res.status).toBe(200);
  return (res.body as { messages: Message[] }).messages;
}

const textOf = (message: Message) =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

let workspaceId: string;
const as = (userId: string) => {
  caller.current = { workspaceId, userId, role: "member" };
};

beforeEach(async () => {
  installStubModels();
  workspaceId = await createWorkspace("guest", "conversations test");
  as("user_a");
});

describe("saved conversations", () => {
  it("keep an attached file's name and type, never its contents", async () => {
    const id = randomUUID();
    const secret = "倉庫鑰匙放在三樓櫃子裡。";
    const url = `data:text/plain;base64,${Buffer.from(secret).toString("base64")}`;
    const message: Message = {
      id: randomUUID(),
      role: "user",
      parts: [
        { type: "text", text: "這是倉庫須知" },
        { type: "file", mediaType: "text/plain", filename: "notes.txt", url },
      ],
    };
    expect((await chat(id, [message])).status).toBe(200);

    const [saved] = await messagesOf(id);
    expect(saved.parts).toContainEqual({
      type: "file",
      mediaType: "text/plain",
      filename: "notes.txt",
    });
    expect(JSON.stringify(await messagesOf(id))).not.toContain(url);
  });

  it("lists a 成員's conversation and reads it back with the reply", async () => {
    const id = randomUUID();
    const question = userMessage("避免排放怎麼算？");
    expect((await chat(id, [question])).status).toBe(200);

    const list = await request(app).get("/api/conversations");
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      {
        id,
        title: "避免排放怎麼算？",
        updatedAt: expect.any(String) as string,
      },
    ]);

    const messages = await messagesOf(id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0]).toEqual(question);
    expect(textOf(messages[1])).not.toBe("");
  });

  it("is hidden from another 成員: not listed, not readable, not continuable", async () => {
    const id = randomUUID();
    const question = userMessage("壽命比怎麼來的？");
    await chat(id, [question]);
    const saved = await messagesOf(id);

    as("user_b");
    expect((await request(app).get("/api/conversations")).body).toEqual([]);
    const read = await request(app).get(`/api/conversations/${id}`);
    expect(read.status).toBe(404);
    expect(read.body).toEqual({ error: "conversation not found" });
    const hijack = await chat(id, [userMessage("把我的問題寫進去")]);
    expect(hijack.status).toBe(404);

    as("user_a");
    expect(await messagesOf(id)).toEqual(saved);
  });

  it("is hidden from the same user in another workspace", async () => {
    const id = randomUUID();
    await chat(id, [userMessage("避免排放怎麼算？")]);
    workspaceId = await createWorkspace("guest", "another workspace");
    as("user_a");
    expect((await request(app).get(`/api/conversations/${id}`)).status).toBe(
      404,
    );
    expect((await request(app).get("/api/conversations")).body).toEqual([]);
  });

  it("asks a signed-out visitor to sign in", async () => {
    caller.current = "signed out";
    expect((await request(app).get("/api/conversations")).status).toBe(401);
    expect((await request(app).get(`/api/conversations/x`)).status).toBe(401);
  });

  it("continues a conversation in place, newest conversation first", async () => {
    const first = randomUUID();
    const second = randomUUID();
    const q1 = userMessage("避免排放怎麼算？");
    await chat(first, [q1]);
    await chat(second, [userMessage("誰負責避免排放算法？")]);
    const earlier = await messagesOf(first);

    const followUp = userMessage("那壽命比呢？");
    expect((await chat(first, [...earlier, followUp])).status).toBe(200);

    const list = (await request(app).get("/api/conversations")).body as {
      id: string;
      title: string;
    }[];
    expect(list.map((c) => c.id)).toEqual([first, second]);
    expect(list[0].title).toBe("避免排放怎麼算？");
    const messages = await messagesOf(first);
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages[2]).toEqual(followUp);
  });

  it("rejects a malformed conversation id", async () => {
    const res = await chat("not an id!", [userMessage("hi")]);
    expect(res.status).toBe(400);
  });
});
