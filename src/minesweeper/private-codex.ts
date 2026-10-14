import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNoKnownManagedConfig } from "./generator-host.js";

export type PrivateCodexOptions = { executable?: string; timeoutMs?: number; signal?: AbortSignal };
const failure = "Private AI request unavailable.";
export async function runPrivateCodex(
  prompt: string,
  schema: unknown,
  options: PrivateCodexOptions = {},
): Promise<unknown> {
  let directory: string | undefined;
  try {
    await assertNoKnownManagedConfig();
    directory = await mkdtemp(join(tmpdir(), "antislope-generator-"));
    const schemaFile = join(directory, "schema.json"),
      output = join(directory, "result.json");
    await writeFile(schemaFile, JSON.stringify(schema), { mode: 0o600 });
    await writeFile(output, "", { mode: 0o600 });
    const args = [
      "--no-daemon",
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--cd",
      directory,
      "--output-schema",
      schemaFile,
      "--output-last-message",
      output,
      "--config",
      "mcp_servers={}",
      "--config",
      'web_search="disabled"',
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
    args.push("-");
    const env = { ...process.env };
    delete env.CODEX_THREAD_ID;
    delete env.CODEX_SESSION_ID;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.executable ?? "codex", args, {
        cwd: directory!,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let size = 0,
        rejected = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = (): void => {
        rejected = true;
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000);
      };
      const timer = setTimeout(stop, options.timeoutMs ?? 180000);
      const discard = (chunk: Buffer): void => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) stop();
      };
      child.stdout.on("data", discard);
      child.stderr.on("data", discard);
      child.stdin.on("error", () => {
        rejected = true;
      });
      child.once("error", () => {
        rejected = true;
      });
      options.signal?.addEventListener("abort", stop, { once: true });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", stop);
        if (rejected || code !== 0) reject(new Error(failure));
        else resolve();
      });
      if (options.signal?.aborted) stop();
      child.stdin.end(prompt);
    });
    if ((await stat(output)).size > 1024 * 1024) throw new Error(failure);
    return JSON.parse(await readFile(output, "utf8")) as unknown;
  } catch {
    throw new Error(failure);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
