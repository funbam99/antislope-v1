import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, copyFile, chmod, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { assertNoKnownManagedConfig } from "./generator-host.js";
import type { PrivateCodexOptions } from "./private-codex.js";

// Chat has only the displayed reader context. Generator output never uses this transport.
export async function runPrivateChat(
  prompt: string,
  options: PrivateCodexOptions,
  onText: (text: string) => void,
  replyFormat: "markdown" | "json" = "markdown",
): Promise<string> {
  let directory: string | undefined;
  try {
    await assertNoKnownManagedConfig();
    directory = await mkdtemp(join(tmpdir(), "antislope-chat-"));
    const authHome = join(directory, "auth-home");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(authHome, { mode: 0o700 });
    try {
      await copyFile(
        join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json"),
        join(authHome, "auth.json"),
      );
      await chmod(join(authHome, "auth.json"), 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const args = [
      "--no-daemon",
      "app-server",
      "--stdio",
      "--config",
      "mcp_servers={}",
      "--config",
      'web_search="disabled"',
      "--config",
      'cli_auth_credentials_store="file"',
    ];
    for (const feature of [
      "shell_tool",
      "unified_exec",
      "apps",
      "plugins",
      "hooks",
      "multi_agent",
      "browser_use",
      "computer_use",
      "in_app_browser",
      "in_app_chat",
      "image_generation",
      "code_mode_host",
      "memories",
      "skill_search",
      "workspace_dependencies",
      "view_image",
      "goals",
      "sleep_tool",
      "daemon_auto_start",
    ])
      args.push("--disable", feature);
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: authHome };
    delete env.CODEX_THREAD_ID;
    delete env.CODEX_SESSION_ID;
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(options.executable ?? "codex", args, {
        cwd: directory,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const requests = new Map<number, { resolve: (value: any) => void; reject: () => void }>();
      const items = new Map<string, string>();
      let seq = 0,
        size = 0,
        thread = "",
        settled = false;
      const combined = () => [...items.values()].join("\n\n");
      const finish = (value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        for (const request of requests.values()) request.reject();
        requests.clear();
        child.stdin.end();
        child.kill("SIGTERM");
        const kill = setTimeout(() => child.kill("SIGKILL"), 1000);
        kill.unref();
        child.once("close", () =>
          value ? resolve(value) : reject(new Error("AI chat unavailable.")),
        );
      };
      const abort = () => finish();
      const timer = setTimeout(abort, options.timeoutMs ?? 180000);
      const rpc = (method: string, params: unknown) =>
        new Promise<any>((resolve, reject) => {
          if (settled) {
            reject(new Error("Closed"));
            return;
          }
          const id = ++seq;
          requests.set(id, { resolve, reject: () => reject(new Error("Unavailable")) });
          child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
        });
      const notify = (method: string, params: unknown) =>
        child.stdin.write(JSON.stringify({ method, params }) + "\n");
      const bounded = (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) abort();
      };
      child.stdout.on("data", bounded);
      child.stderr.on("data", bounded);
      child.stdin.on("error", abort);
      child.on("error", abort);
      child.on("exit", () => {
        if (!settled) abort();
      });
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (settled) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.id !== undefined) {
          if (event.method) {
            abort();
            return;
          }
          const request = requests.get(event.id);
          if (request) {
            requests.delete(event.id);
            event.error ? request.reject() : request.resolve(event.result);
          }
          return;
        }
        const p = event.params;
        if (!p || p.threadId !== thread) return;
        if (
          event.method === "item/started" &&
          p.item?.type === "agentMessage" &&
          p.item.phase !== "commentary"
        )
          items.set(p.item.id, "");
        if (
          event.method === "item/agentMessage/delta" &&
          items.has(p.itemId) &&
          typeof p.delta === "string"
        ) {
          items.set(p.itemId, items.get(p.itemId)! + p.delta);
          const text = combined();
          if (text.length > 16000) {
            abort();
            return;
          }
          onText(text);
        }
        if (
          event.method === "item/completed" &&
          p.item?.type === "agentMessage" &&
          items.has(p.item.id) &&
          typeof p.item.text === "string"
        ) {
          items.set(p.item.id, p.item.text);
          const text = combined();
          if (text.length > 16000) {
            abort();
            return;
          }
          onText(text);
        }
        if (event.method === "turn/completed")
          finish(p.turn?.status === "completed" && combined().trim() ? combined() : undefined);
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) {
        abort();
        return;
      }
      void (async () => {
        try {
          await rpc("initialize", {
            clientInfo: { name: "antislope_chat", version: "0.1.0" },
            capabilities: { experimentalApi: false },
          });
          notify("initialized", {});
          const result = await rpc("thread/start", {
            cwd: directory,
            approvalPolicy: "never",
            sandbox: "read-only",
            ephemeral: true,
            config: { mcp_servers: {}, web_search: "disabled" },
            baseInstructions:
              replyFormat === "json"
                ? "Use no tools or files. Reply only with the requested JSON object, without Markdown fences or additional text."
                : "Use no tools or files. Reply only in Markdown, without a JSON envelope.",
          });
          thread = result.thread.id;
          await rpc("turn/start", {
            threadId: thread,
            input: [{ type: "text", text: prompt, text_elements: [] }],
          });
        } catch {
          abort();
        }
      })();
    });
  } catch {
    throw new Error("AI chat unavailable.");
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
