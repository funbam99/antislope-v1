import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const usage =
  "Usage: node session.mjs run --repo <path> --base <ref> --file <path> [--file <path> ...] --requirements-file <path> [--codex <executable>]\n       node session.mjs status --url <reader-url>\n       node session.mjs discuss --url <reader-url>";
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let server;
const controller = new AbortController();
const stop = async () => {
  controller.abort();
  if (server) await server.close();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "-h") {
    process.stdout.write(usage + "\n");
  } else {
    const fields = new Map(),
      files = [];
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i],
        value = args[i + 1];
      const allowed =
        command === "run"
          ? ["--repo", "--base", "--file", "--requirements-file", "--codex"]
          : ["--url"];
      if (
        !allowed.includes(key) ||
        !value ||
        value.startsWith("--") ||
        (fields.has(key) && key !== "--file")
      )
        throw new Error("usage");
      if (key === "--file") files.push(value);
      else fields.set(key, value);
    }
    if (command === "status" || command === "discuss") {
      const address = fields.get("--url");
      if (!address || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[a-f0-9]{48}\/$/u.test(address))
        throw new Error("usage");
      const response = await fetch(address + (command === "discuss" ? "discussion" : "agent"), {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("status");
      const value = await response.json();
      if (!["reading", "submitted", "revealed", "completed"].includes(value.phase))
        throw new Error("status");
      emit(
        command === "status" && (value.phase === "reading" || value.phase === "submitted")
          ? { phase: value.phase, freshness: value.freshness, readerId: value.readerId }
          : value,
      );
    } else if (command === "run") {
      if (
        !fields.has("--repo") ||
        !fields.has("--base") ||
        !fields.has("--requirements-file") ||
        !files.length
      )
        throw new Error("usage");
      const runtime = process.env.ANTISLOPE_RUNTIME_ROOT
        ? resolve(process.env.ANTISLOPE_RUNTIME_ROOT)
        : fileURLToPath(new URL("../../", import.meta.url));
      let bridge;
      try {
        const manifest = JSON.parse(await readFile(resolve(runtime, "package.json"), "utf8"));
        if (manifest.name !== "anti-slope") throw new Error("runtime");
        bridge = await import(
          pathToFileURL(resolve(runtime, "dist/minesweeper/skill-session.js")).href
        );
      } catch {
        throw new Error("runtime");
      }
      const requirements = await readFile(resolve(fields.get("--requirements-file")), "utf8");
      emit({ status: "preparing" });
      server = await bridge.startSkillSession({
        repo: resolve(fields.get("--repo")),
        base: fields.get("--base"),
        files,
        requirements,
        ...(fields.has("--codex") ? { executable: fields.get("--codex") } : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) await server.close();
      else emit({ status: "ready", url: server.url });
    } else throw new Error("usage");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  emit({
    status: controller.signal.aborted ? "cancelled" : "unavailable",
    message:
      message === "usage"
        ? usage
        : message === "runtime"
          ? "Trusted Anti-Slope runtime unavailable. Build it in its own checkout or set ANTISLOPE_RUNTIME_ROOT to that checkout."
          : "Session unavailable. No private generator output was released. Check prerequisites and inputs; do not prepare exercises or load private references in the main conversation.",
  });
  process.exitCode = controller.signal.aborted ? 130 : 1;
}
