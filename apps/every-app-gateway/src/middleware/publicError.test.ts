import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { GatewayError, PublicError } from "@/server/errors";

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({
    server: (handler: unknown) => ({ serverHandler: handler }),
  }),
}));

import { publicErrorMiddleware } from "./publicError";

type Handler = (input: { next: () => Promise<unknown> }) => Promise<unknown>;
const handler = (publicErrorMiddleware as unknown as { serverHandler: Handler })
  .serverHandler;

// seroval is TanStack's dependency, not the gateway's: resolved the way
// @tanstack/start-server-core resolves it, so the wire shape below is made
// by the build the server-function handler uses.
const seroval = createRequire(
  createRequire(
    createRequire(import.meta.url).resolve(
      "@tanstack/react-start/package.json",
    ),
  ).resolve("@tanstack/start-server-core/package.json"),
)("seroval") as {
  toCrossJSONAsync(
    value: unknown,
    options: { refs: Map<unknown, number>; plugins: unknown[] },
  ): Promise<unknown>;
};

/** The error as TanStack's handler puts it in the response body. */
async function wire(error: unknown): Promise<string> {
  return JSON.stringify(
    await seroval.toCrossJSONAsync(error, { refs: new Map(), plugins: [] }),
  );
}

async function thrownBy(next: () => Promise<unknown>): Promise<Error> {
  try {
    await handler({ next });
  } catch (error) {
    return error as Error;
  }
  throw new Error("the middleware let the error through");
}

describe("publicErrorMiddleware", () => {
  it("does not log or send a private URL in an unexpected exception", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const privateUrl =
      "https://private.example.test/path?account=synthetic-private-query";
    const thrown = Object.assign(new Error(`fetch failed: ${privateUrl}`), {
      stack: `Error: fetch failed: ${privateUrl}\n at ${privateUrl}`,
      headers: { "set-cookie": "session=secret-session-token" },
      body: { token: "reset-token-123" },
    });

    try {
      const sent = await thrownBy(() => Promise.reject(thrown));
      expect(sent).toMatchObject({ code: "INTERNAL_ERROR" });
      const output = consoleError.mock.calls.flat().map(String).join("\n");
      const responseBody = await wire(sent);
      expect(output).toContain("server_fn.unhandled_error");
      expect(output).toMatch(/requestId|correlationId/);
      for (const unsafe of [
        privateUrl,
        "synthetic-private-query",
        "secret-session-token",
        "reset-token-123",
      ]) {
        expect(output).not.toContain(unsafe);
        expect(responseBody).not.toContain(unsafe);
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it("puts only the code, message and name of every error it lets out on the wire", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const carrying = Object.assign(
      new PublicError("APP_NOT_FOUND", "No such app"),
      {
        cause: new Error("SELECT failed"),
        headers: { "set-cookie": "session=secret" },
      },
    );
    const cases: [string, unknown, string][] = [
      [
        "a PublicError",
        new PublicError("USER_NOT_FOUND", "No such user"),
        "USER_NOT_FOUND",
      ],
      [
        "a GatewayError",
        new GatewayError("ACCESS_DENIED", "Not for you"),
        "ACCESS_DENIED",
      ],
      ["a PublicError carrying more than its code", carrying, "APP_NOT_FOUND"],
      [
        "a known code thrown as a plain object",
        { code: "RATE_LIMITED", message: "Slow down", retryAfter: 30 },
        "RATE_LIMITED",
      ],
      ["a zod failure", new ZodError([]), "INVALID_INPUT"],
      ["anything else", new TypeError("fetch failed"), "INTERNAL_ERROR"],
    ];
    for (const [label, error, code] of cases) {
      const thrown = await thrownBy(() => Promise.reject(error));
      expect(thrown, label).toBeInstanceOf(Error);
      expect(thrown, label).not.toBe(error);
      expect(thrown, label).toMatchObject({ code });
      expect(Object.getOwnPropertyNames(thrown).sort(), label).toEqual([
        "code",
        "message",
        "name",
      ]);
      expect(thrown.stack, label).toBeUndefined();

      // The body TanStack sends: the message, then the own properties as
      // seroval copies them (`p.k` are their names): the name first, the
      // literal the class sets, so the browser rebuilds `error.name` from
      // it and not from the bundle's class name.
      const body = await wire(thrown);
      expect(body, label).not.toContain('"stack"');
      expect(body, label).not.toContain("secret");
      expect(body, label).not.toContain("SELECT");
      expect(body, label).not.toContain("retryAfter");
      expect(JSON.parse(body), label).toMatchObject({
        m: thrown.message,
        p: {
          k: ["name", "code"],
          v: [{ s: thrown.name }, { s: code }],
        },
      });
    }

    // The error the handler threw is left as it was: stack, cause and all.
    expect(carrying.stack).toBeDefined();
    expect(carrying.cause.message).toBe("SELECT failed");
    expect(carrying.headers["set-cookie"]).toBe("session=secret");
  });

  it("would have put the stack on the wire otherwise", async () => {
    // What this test guards: an error as thrown, serialized the same way.
    const body = await wire(new PublicError("USER_NOT_FOUND", "No such user"));
    expect(body).toContain('"stack"');
    expect(body).toContain("publicError.test.ts");
  });
});
