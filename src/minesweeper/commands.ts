import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  captureBoundSnapshot,
  captureSnapshot,
  repositoryRoot,
  validateSnapshot,
} from "./snapshot.js";
import { parseExercise, validateExercise } from "./exercise.js";
import { ReviewSession } from "./session.js";
import { startServer, resumeServer } from "./server.js";

const AUTHOR_ERROR =
  "The exercise could not be validated against the current code. Please contact the curator.";
function readJson(path: string): unknown {
  const full = realpathSync(resolve(path));
  const info = statSync(full);
  if (!info.isFile() || info.size > 12 * 1024 * 1024)
    throw new Error("Invalid or oversized JSON file");
  const bytes = readFileSync(full);
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Oversized JSON file");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
function parseArgs(args: string[]): {
  command: string;
  options: Map<string, string[]>;
  preview: boolean;
} {
  const command = args[0] ?? "";
  const allowed: Record<string, string[]> = {
    snapshot: ["repo", "base", "file"],
    validate: ["snapshot", "exercise"],
    review: ["repo", "exercise"],
    resume: ["session"],
  };
  if (!allowed[command]) throw new Error("Invalid command");
  const options = new Map<string, string[]>();
  let preview = false;
  for (let i = 1; i < args.length; i++) {
    if (command === "validate" && args[i] === "--preview" && !preview) {
      preview = true;
      continue;
    }
    const flag = args[i];
    if (
      !flag?.startsWith("--") ||
      !allowed[command]!.includes(flag.slice(2)) ||
      !args[i + 1] ||
      args[i + 1]!.startsWith("--")
    )
      throw new Error("Invalid arguments");
    const key = flag.slice(2),
      value = args[++i]!;
    if (options.has(key) && key !== "file") throw new Error("Duplicate flag");
    options.set(key, [...(options.get(key) ?? []), value]);
  }
  if (allowed[command]!.some((key) => !options.has(key))) throw new Error("Missing flag");
  return { command, options, preview };
}
async function serve(session: ReviewSession): Promise<void> {
  const server = await startServer(session, { persistent: !session.preview });
  console.log(`${session.preview ? "Curator preview" : "Author review"}: ${server.url}`);
  console.log(
    session.preview
      ? "Ctrl-C closes this temporary preview."
      : `Session saved locally. Resume with: npm start -- minesweeper resume --session ${server.sessionId}`,
  );
  if (!session.preview)
    console.log(
      "AI discussion sends displayed code and chat messages through the installed Codex CLI default provider.",
    );
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void server.close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
export async function runMinesweeper(args: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(args);
  } catch {
    console.error("Invalid Minesweeper command or arguments. Run with --help for usage.");
    return 2;
  }
  const { command, options, preview } = parsed;
  const get = (key: string): string => options.get(key)![0]!;
  if (command === "resume") {
    try {
      const server = await resumeServer(get("session"));
      console.log(`Saved session: ${server.url}`);
      console.log(
        `Session saved locally. Resume with: npm start -- minesweeper resume --session ${server.sessionId}`,
      );
      await new Promise<void>((resolve) => {
        const stop = (): void => {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
          void server.close().finally(resolve);
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      return 0;
    } catch {
      console.error(
        "The saved session could not be resumed. Check its ID and ensure its original local port is free.",
      );
      return 1;
    }
  }
  if (command === "review") {
    let session: ReviewSession;
    try {
      const root = repositoryRoot(get("repo"));
      const exercisePath = realpathSync(resolve(get("exercise")));
      const rel = relative(root, exercisePath);
      if (!rel || (!rel.startsWith("../") && !isAbsolute(rel)))
        throw new Error("Exercise must be outside the target repository");
      const e = parseExercise(readJson(exercisePath));
      const snapshot = captureBoundSnapshot(root, e);
      session = new ReviewSession(snapshot, validateExercise(e, snapshot), root);
    } catch {
      console.error(AUTHOR_ERROR);
      return 1;
    }
    try {
      await serve(session);
      return 0;
    } catch {
      console.error("The local review server could not start.");
      return 1;
    }
  }
  try {
    if (command === "snapshot")
      console.log(
        JSON.stringify(captureSnapshot(get("repo"), get("base"), options.get("file")!), null, 2),
      );
    else {
      const snapshot = validateSnapshot(readJson(get("snapshot")));
      const exercise = validateExercise(readJson(get("exercise")), snapshot);
      console.log(
        "Exercise is structurally valid against the supplied snapshot. Semantic correctness remains the curator's responsibility.",
      );
      if (preview) await serve(new ReviewSession(snapshot, exercise, undefined, true));
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Preparation failed");
    return 1;
  }
}
