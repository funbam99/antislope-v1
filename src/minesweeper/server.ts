import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ReaderArchive, archiveClient } from "./reader-archive.js";
import { ReviewSession } from "./session.js";
import { readRecovery, writeRecovery } from "./persistence.js";
import { page } from "./page.js";
import { client } from "./client.js";
import { style } from "./style.js";
import { ReviewChat } from "./chat.js";
import type { PrivateCodexOptions } from "./private-codex.js";

class HttpError extends Error {
  constructor(readonly status: number) {
    super("Request rejected");
  }
}
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += bytes.length;
    if (size <= 1024 * 1024) buffers.push(bytes);
    else buffers.length = 0;
  }
  if (size > 1024 * 1024) throw new HttpError(413);
  try {
    return JSON.parse(Buffer.concat(buffers).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400);
  }
}
export interface ServerOptions extends PrivateCodexOptions {
  persistent?: boolean;
  storageRoot?: string;
}
type SavedServer = {
  schemaVersion: 1;
  sessionId: string;
  port: number;
  session: unknown;
  chat: unknown;
};
export async function resumeServer(
  id: string,
  options: ServerOptions = {},
): Promise<{ url: string; sessionId: string; close(): Promise<void> }> {
  const saved = readRecovery(id, options.storageRoot) as SavedServer;
  const session =
    (saved.session as { kind?: string })?.kind === "reader-archive"
      ? ReaderArchive.restore(saved.session)
      : ReviewSession.restore(saved.session);
  return serve(session, { ...options, persistent: true }, saved);
}
export async function startServer(
  session: ReviewSession,
  options: ServerOptions = {},
): Promise<{ url: string; sessionId: string; close(): Promise<void> }> {
  return serve(session, options);
}
async function serve(
  session: ReviewSession | ReaderArchive,
  options: ServerOptions,
  saved?: SavedServer,
): Promise<{ url: string; sessionId: string; close(): Promise<void> }> {
  const chat = new ReviewChat(
    () => session.discussionView(),
    options,
    !session.preview,
    session instanceof ReviewSession ? () => session.reviewDiscussionView() : undefined,
  );
  if (saved) chat.restore(saved.chat);
  const capability = saved?.sessionId ?? randomBytes(24).toString("hex");
  let port = saved?.port ?? 0;
  const persist = (): void => {
    if (options.persistent && (!session.preview || session instanceof ReaderArchive))
      writeRecovery(
        capability,
        {
          schemaVersion: 1,
          sessionId: capability,
          port,
          session: session.checkpoint(),
          chat: chat.checkpoint(),
        },
        options.storageRoot,
      );
  };
  const prefix = `/${capability}/`;
  let origin = "";
  const send = (response: ServerResponse, status: number, type: string, body: string): void => {
    response.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(body);
  };
  const server = createServer(async (request, response) => {
    try {
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin)
      )
        throw new HttpError(403);
      const path = request.url ?? "";
      if (!path.startsWith(prefix)) throw new HttpError(404);
      const route = path.slice(prefix.length);
      if (request.method === "GET" && route === "chat")
        return send(response, 200, "application/json; charset=utf-8", JSON.stringify(chat.view()));
      if (request.method === "GET" && route === "discussion")
        return send(
          response,
          200,
          "application/json; charset=utf-8",
          JSON.stringify(session.discussionView()),
        );
      if (request.method === "GET" && route === "agent")
        return send(
          response,
          200,
          "application/json; charset=utf-8",
          JSON.stringify(session.agentView()),
        );
      if (request.method === "GET" && route === "state")
        return send(
          response,
          200,
          "application/json; charset=utf-8",
          JSON.stringify(session.view()),
        );
      if (request.method === "GET" && route === "")
        return send(
          response,
          200,
          "text/html; charset=utf-8",
          session instanceof ReaderArchive
            ? page.replace(
                "<body>",
                '<body><p style="padding:12px;margin:0;color:#b45309">Recovered reader archive: the original exercise was lost during migration. Comments and discussion are preserved; review actions are paused. No answers were reconstructed or revealed.</p>',
              )
            : page,
        );
      if (request.method === "GET" && route === "app.js")
        return send(
          response,
          200,
          "text/javascript; charset=utf-8",
          session instanceof ReaderArchive ? archiveClient(client) : client,
        );
      if (request.method === "GET" && route === "app.css")
        return send(response, 200, "text/css; charset=utf-8", style);
      if (request.method !== "POST") throw new HttpError(request.method === "GET" ? 404 : 405);
      if (
        request.headers.origin !== origin ||
        request.headers["x-minesweeper-session"] !== capability
      )
        throw new HttpError(403);
      if (request.headers["content-type"] !== "application/json") throw new HttpError(415);
      const body = await jsonBody(request);
      if (route === "archive-browser" && session instanceof ReaderArchive) {
        session.updateBrowser(body);
        persist();
        return send(
          response,
          200,
          "application/json; charset=utf-8",
          JSON.stringify({ saved: true }),
        );
      }
      if (route === "review-evidence") {
        try {
          const result = await chat.reviewEvidence(body);
          return send(response, 200, "application/json; charset=utf-8", JSON.stringify(result));
        } catch {
          throw new HttpError(409);
        }
      }
      if (route === "chat") {
        try {
          const result = await chat.turn(body);
          persist();
          return send(response, 200, "application/json; charset=utf-8", JSON.stringify(result));
        } catch {
          throw new HttpError(409);
        }
      }
      if (route === "export") {
        try {
          const card = session.export();
          persist();
          response.setHeader(
            "Content-Disposition",
            'attachment; filename="minesweeper-handoff.md"',
          );
          return send(response, 200, "text/markdown; charset=utf-8", card);
        } catch {
          throw new HttpError(409);
        }
      }
      if (!/^action\/[a-z-]+$/u.test(route)) throw new HttpError(404);
      try {
        const result = session.transition(route.slice(7), body);
        persist();
        return send(response, 200, "application/json; charset=utf-8", JSON.stringify(result));
      } catch {
        throw new HttpError(409);
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed)
        send(
          response,
          error instanceof HttpError ? error.status : 500,
          "application/json; charset=utf-8",
          JSON.stringify({ error: "The request is unavailable or its fields are incomplete." }),
        );
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  try {
    persist();
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await chat.close();
    throw error;
  }
  return {
    url: origin + prefix,
    sessionId: capability,
    close: async () => {
      const closing = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      await chat.close();
      await closing;
    },
  };
}
