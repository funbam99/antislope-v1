import { writeChatWorker } from "./chat-worker-helper.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { ReviewSession } from "../src/minesweeper/session.ts";
import { startServer, resumeServer } from "../src/minesweeper/server.ts";

test("a persisted server resumes the same URL, comments, hints and reveal guards", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const root = join(f.root, "private-sessions");
  const first = await startServer(new ReviewSession(snapshot, exercise(snapshot), f.repo), {
    persistent: true,
    storageRoot: root,
  });
  const get = (path) => fetch(path, { headers: { Connection: "close" } });
  const url = first.url,
    token = new URL(url).pathname.split("/")[1],
    origin = new URL(url).origin;
  const post = (path, body) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        Connection: "close",
        Origin: origin,
        "Content-Type": "application/json",
        "X-Minesweeper-Session": token,
      },
      body: JSON.stringify(body),
    });
  const before = await (await get(url + "state")).json();
  await post("action/submit", {
    prediction: "Boundary hypothesis",
    annotations: [
      {
        id: "note",
        anchor: { kind: "change" },
        constraint: "Check equality",
        trigger: "Pending",
        uncertainty: "",
      },
    ],
    noFindings: "",
  });
  await post("action/hint", {});
  await first.close();
  const second = await resumeServer(first.sessionId, { storageRoot: root });
  t.after(() => second.close());
  assert.equal(second.url, url);
  const restored = await (await get(url + "state")).json();
  assert.equal(restored.version.readerId, before.version.readerId);
  assert.equal(restored.phase, "submitted");
  assert.equal(restored.hintLevel, 1);
  assert.equal(restored.annotations[0].constraint, "Check equality");
  assert.equal(restored.initialReference, undefined);
  assert.equal(restored.mutationReference, undefined);
  const discussion = await (await get(url + "discussion")).text();
  assert.doesNotMatch(discussion, /Independent truth table|count >= limit|hintLevel/);
  assert.equal((await get(url + "checkpoint.json")).status, 404);
  assert.equal((await get(url + "../" + first.sessionId + "/checkpoint.json")).status, 404);
  const info = statSync(join(root, first.sessionId, "checkpoint.json"));
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal(statSync(join(root, first.sessionId)).mode & 0o777, 0o700);
  assert.match(
    readFileSync(join(root, first.sessionId, "checkpoint.json"), "utf8"),
    /Independent truth table/,
  );
  await post("action/reveal", {});
  assert.equal((await (await get(url + "state")).json()).phase, "revealed");
  assert.equal((await (await get(url + "state")).json()).followupReference, undefined);
});

test("chat and request deduplication survive recovery without sending references to AI", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    root = join(f.root, "saved");
  const { writeFileSync } = await import("node:fs");
  const worker = join(f.root, "worker.mjs"),
    input = join(f.root, "prompt.txt");
  writeChatWorker(worker, input, "Public reasoning", { append: true });
  const options = { persistent: true, storageRoot: root, executable: worker };
  const first = await startServer(new ReviewSession(snapshot, exercise(snapshot), f.repo), options);
  const url = first.url,
    origin = new URL(url).origin,
    token = first.sessionId;
  const post = (path, body) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        Connection: "close",
        Origin: origin,
        "Content-Type": "application/json",
        "X-Minesweeper-Session": token,
      },
      body: JSON.stringify(body),
    });
  await post("chat", {});
  await post("chat", { message: "Trace equality", requestId: "turn-one" });
  await first.close();
  const second = await resumeServer(token, options);
  t.after(() => second.close());
  const chat = await (await fetch(url + "chat", { headers: { Connection: "close" } })).json();
  assert.equal(chat.messages.length, 3);
  assert.equal(chat.busy, false);
  const promptBefore = readFileSync(input, "utf8");
  await post("chat", { message: "Trace equality", requestId: "turn-one" });
  assert.equal(readFileSync(input, "utf8"), promptBefore);
  await post("chat", { message: "What else should I check?", requestId: "turn-two" });
  const prompt = readFileSync(input, "utf8");
  assert.match(prompt, /Trace equality/);
  assert.doesNotMatch(
    prompt,
    /Independent truth table|Equality must be rejected|count >= limit|snapshotId|mutationReference/,
  );
  await assert.rejects(resumeServer(token, options));
});

test("completed cards remain immutable after recovery and damaged checkpoints fail closed", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const { writeRecovery, readRecovery } = await import("../src/minesweeper/persistence.ts");
  const session = new ReviewSession(snapshot, exercise(snapshot), f.repo);
  session.transition("submit", {
    prediction: "Prediction",
    annotations: [],
    noFindings: "No findings",
  });
  session.transition("reveal", {});
  session.transition("assess", {
    assessments: [],
    region: { kind: "handoff", note: "Verify on clean code" },
    referenceDispute: "",
  });
  session.transition("followup", { prediction: "Context", dispute: "" });
  const card = session.export(),
    restored = ReviewSession.restore(session.checkpoint());
  assert.equal(restored.view().phase, "completed");
  assert.equal(restored.export(), card);
  const root = join(f.root, "saved"),
    id = "a".repeat(48);
  writeRecovery(
    id,
    {
      schemaVersion: 1,
      sessionId: id,
      port: 12345,
      session: session.checkpoint(),
      chat: { messages: [], committed: [] },
    },
    root,
  );
  const saved = readRecovery(id, root);
  saved.session.journal = [{ action: "reveal", input: {} }];
  writeRecovery(id, saved, root);
  await assert.rejects(resumeServer(id, { storageRoot: root }));
  await assert.rejects(resumeServer("../escape", { storageRoot: root }));
});

test("recovery storage cannot write inside the target repository", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const { existsSync } = await import("node:fs");
  const root = join(f.repo, "saved-session");
  await assert.rejects(
    startServer(new ReviewSession(snapshot, exercise(snapshot), f.repo), {
      persistent: true,
      storageRoot: root,
    }),
  );
  assert.equal(existsSync(root), false);
});

test("a fresh CLI process resumes the stopped service at its original URL", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const { writeFileSync, rmSync } = await import("node:fs");
  const { spawn } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const { defaultStorageRoot } = await import("../src/minesweeper/persistence.ts");
  const exercisePath = join(f.root, "exercise.json");
  writeFileSync(exercisePath, JSON.stringify(exercise(snapshot)));
  const start = async (args) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("src/cli.ts"),
        "minesweeper",
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "",
      errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    const url = await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(
          /(?:Author review|Saved session): (http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\/)/,
        );
        if (match) resolve(match[1]);
      });
      child.once("exit", (code) =>
        reject(new Error("CLI stopped before ready: " + code + " " + errors)),
      );
    });
    const stop = () =>
      new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
      });
    return { child, url, stop };
  };
  const first = await start(["review", "--repo", f.repo, "--exercise", exercisePath]);
  const id = new URL(first.url).pathname.split("/")[1];
  t.after(() => rmSync(join(defaultStorageRoot, id), { recursive: true, force: true }));
  const state = await (
    await fetch(first.url + "state", { headers: { Connection: "close" } })
  ).json();
  await first.stop();
  const second = await start(["resume", "--session", id]);
  t.after(() => second.child.kill("SIGTERM"));
  assert.equal(second.url, first.url);
  const restored = await (
    await fetch(second.url + "state", { headers: { Connection: "close" } })
  ).json();
  assert.equal(restored.version.readerId, state.version.readerId);
  assert.equal(restored.phase, "reading");
  assert.equal(restored.initialReference, undefined);
  await second.stop();
});
