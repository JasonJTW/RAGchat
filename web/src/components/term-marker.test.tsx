import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TermMarker } from "./term-marker";
import { RoleContext } from "./workspace-gate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(status = 204, body: unknown = undefined) {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    () =>
      Promise.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it.each([
  ["設為敏感", true, "已設為敏感：之後的輸入會以代稱取代「阿德」"],
  ["設為不敏感", false, "已設為不敏感：之後的輸入不會取代「阿德」"],
] as const)("marks a term with %s", async (button, sensitive, done) => {
  const fetch = stubFetch();
  render(<TermMarker />);

  fireEvent.change(screen.getByRole("textbox", { name: "用詞" }), {
    target: { value: " 阿德 " },
  });
  fireEvent.click(screen.getByRole("button", { name: button }));

  expect(await screen.findByRole("status")).toHaveTextContent(done);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("/api/terms");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body as string)).toEqual({ term: "阿德", sensitive });
  expect(screen.getByRole("textbox", { name: "用詞" })).toHaveValue("");
});

it("can't mark a blank term", () => {
  render(<TermMarker />);
  expect(screen.getByRole("button", { name: "設為敏感" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "設為不敏感" })).toBeDisabled();
});

it("says why a term was refused", async () => {
  stubFetch(422, { error: "這則內容含有密碼或 API key" });
  render(<TermMarker />);

  fireEvent.change(screen.getByRole("textbox", { name: "用詞" }), {
    target: { value: "密碼是 x" },
  });
  fireEvent.click(screen.getByRole("button", { name: "設為敏感" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "沒有成功：這則內容含有密碼或 API key",
  );
});

it("is not shown to a 訪客, whose trial is not de-identified", () => {
  render(
    <RoleContext.Provider value="guest">
      <TermMarker />
    </RoleContext.Provider>,
  );

  expect(screen.queryByText("標記敏感詞")).toBeNull();
});
