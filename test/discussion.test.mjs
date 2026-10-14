import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { ReviewSession } from "../src/minesweeper/session.ts";
import { startServer } from "../src/minesweeper/server.ts";

for (const injected of [true, false])
  test(`discussion shares the displayed view without private oracles (${injected ? "mutation" : "control"})`, async (t) => {
    const f = fixture(t),
      snapshot = captureSnapshot(f.repo, f.base, ["allow.ts", "helper.ts"]);
    const e = exercise(snapshot, injected);
    e.initial.displayed = "PRIVATE-DISPLAYED-REFERENCE";
    e.initial.clean = "PRIVATE-CLEAN-REFERENCE";
    e.initial.intended = "PRIVATE-INTENDED-REFERENCE";
    e.initial.explanation = "PRIVATE-INITIAL-EXPLANATION";
    e.followup.answer = "PRIVATE-FOLLOWUP-ANSWER";
    if (e.mutation) {
      e.mutation.evidence = "PRIVATE-MUTATION-EVIDENCE";
      e.mutation.category = "PRIVATE-MUTATION-CATEGORY";
      e.mutation.trigger = "PRIVATE-MUTATION-TRIGGER";
      e.clue = "PRIVATE-CLUE";
    }
    const session = new ReviewSession(snapshot, e, f.repo);
    const server = await startServer(session);
    t.after(() => server.close());
    const read = async () => {
      const response = await fetch(server.url + "discussion");
      assert.equal(response.status, 200);
      return response.json();
    };
    const assertBlind = (discussion) => {
      const reader = session.view();
      assert.deepEqual(discussion.files, reader.files);
      assert.equal(discussion.initialPrompt, reader.initialPrompt);
      assert.equal(discussion.requirements, e.requirements);
      const encoded = JSON.stringify(discussion);
      for (const secret of [
        "PRIVATE-",
        snapshot.id,
        snapshot.files[0].candidateHash,
        snapshot.files[0].baselineHash,
        '"mutation"',
        '"hintLevel"',
        '"count"',
        '"category"',
        '"replacement"',
        '"followupReference"',
        '"followupPrompt"',
      ])
        assert.equal(encoded.includes(secret), false, secret);
      if (injected) {
        assert.equal(encoded.includes(e.mutation.clean), false);
        assert.equal(discussion.files[0].candidate[1], e.mutation.replacement);
        assert.equal(
          discussion.files[0].hunks.flat().find((r) => r.newLine === 2).text,
          e.mutation.replacement,
        );
      }
      assert.equal(session.agentView().phase, "reading");
    };
    const first = await read();
    assertBlind(first);
    const { stdout } = await promisify(execFile)(process.execPath, [
      resolve("antislope/scripts/session.mjs"),
      "discuss",
      "--url",
      server.url,
    ]);
    const viaHelper = JSON.parse(stdout);
    assert.deepEqual(viaHelper, first);
    session.transition("submit", {
      prediction: "A hypothesis discussed with AI",
      annotations: [],
      noFindings: "Still uncertain",
    });
    session.transition("hint", {});
    const submitted = await read();
    assert.equal(submitted.phase, "submitted");
    assert.equal(JSON.stringify(submitted).includes('"hint'), false);
    assert.equal(JSON.stringify(submitted).includes("PRIVATE-"), false);
    writeFileSync(join(f.repo, "allow.ts"), "export const changed = true;\n");
    const historical = await read();
    assert.equal(historical.freshness, "historical");
    assert.deepEqual(historical.files, first.files);
    session.transition("reveal", {});
    const revealed = await read();
    assert.equal(revealed.files[0].candidate[1], "  if (count >= limit) return false;");
    assert.equal(revealed.followupPrompt, e.followup.prompt);
    assert.equal(JSON.stringify(revealed).includes("PRIVATE-"), false);
    const denied = await fetch(server.url + "discussion", {
      method: "POST",
      headers: {
        Origin: new URL(server.url).origin,
        "X-Minesweeper-Session": new URL(server.url).pathname.split("/")[1],
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(denied.status, 404);
    assert.equal(session.agentView().phase, "revealed");
  });
