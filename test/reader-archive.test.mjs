import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fixture } from "./helpers.mjs";
import { ReaderArchive } from "../src/minesweeper/reader-archive.ts";
import { writeRecovery } from "../src/minesweeper/persistence.ts";
import { resumeServer } from "../src/minesweeper/server.ts";

test("a lost-exercise archive resumes displayed data but cannot reveal, hint, export or call AI", async (t) => {
  const f = fixture(t),
    root = join(f.root, "archive"),
    id = "b".repeat(48);
  const archive = ReaderArchive.restore({
    kind: "reader-archive",
    schemaVersion: 1,
    reader: {
      phase: "submitted",
      title: "Recovered review",
      requirements: "A contract",
      intent: "",
      version: { readerId: "a".repeat(32), baseline: "", headAtPreparation: "", excluded: [] },
      files: [{ path: "allow.ts", candidate: ["displayed code"] }],
      annotations: [],
    },
    chat: [{ role: "assistant", text: "Existing public discussion" }],
    browser: {},
  });
  const { createServer } = await import("node:net");
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  writeRecovery(
    id,
    {
      schemaVersion: 1,
      sessionId: id,
      port,
      session: archive.checkpoint(),
      chat: {
        messages: [{ role: "assistant", text: "Existing public discussion" }],
        committed: [],
      },
    },
    root,
  );
  const server = await resumeServer(id, { storageRoot: root });
  const origin = new URL(server.url).origin;
  const post = (path, body = {}) =>
    fetch(server.url + path, {
      method: "POST",
      headers: {
        Connection: "close",
        Origin: origin,
        "X-Minesweeper-Session": id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const view = await (
    await fetch(server.url + "state", { headers: { Connection: "close" } })
  ).json();
  assert.equal(view.phase, "submitted");
  assert.equal(view.recovery, "reader-only");
  assert.equal(view.initialReference, undefined);
  assert.equal(view.mutationReference, undefined);
  for (const path of ["action/reveal", "action/hint", "export", "chat"])
    assert.equal((await post(path, {})).status, 409);
  await post("archive-browser", {
    readerId: "c".repeat(32),
    comments: {
      notes: [
        {
          id: "n",
          anchor: { kind: "candidate", path: "allow.ts", line: 1 },
          constraint: "An existing question",
          trigger: "Pending",
          uncertainty: "",
        },
      ],
    },
    history: { messages: [{ kind: "hint", body: "Previously released hint" }] },
  });
  await server.close();
  const resumed = await resumeServer(id, { storageRoot: root });
  t.after(() => resumed.close());
  const restored = await (
    await fetch(resumed.url + "state", { headers: { Connection: "close" } })
  ).json();
  assert.equal(restored.annotations[0].constraint, "An existing question");
  assert.equal(restored.version.readerId, "c".repeat(32));
  assert.equal(
    (await (await fetch(resumed.url + "chat", { headers: { Connection: "close" } })).json())
      .messages[0].text,
    "Existing public discussion",
  );
  const discussion = await (await fetch(resumed.url + "discussion")).text();
  assert.doesNotMatch(
    discussion,
    /Previously released hint|archivedChat|initialReference|mutationReference/,
  );
});
