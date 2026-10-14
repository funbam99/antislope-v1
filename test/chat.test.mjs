import { writeChatWorker } from "./chat-worker-helper.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { ReviewSession } from "../src/minesweeper/session.ts";
import { ReviewChat } from "../src/minesweeper/chat.ts";
import { startServer } from "../src/minesweeper/server.ts";

function setup(t) {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    e = exercise(snapshot);
  e.initial.clean = "PRIVATE-REFERENCE";
  e.mutation.evidence = "PRIVATE-EVIDENCE";
  e.clue = "PRIVATE-CLUE";
  const session = new ReviewSession(snapshot, e, f.repo);
  const executable = join(f.root, "chat-worker.mjs"),
    input = join(f.root, "input.json");
  writeChatWorker(executable, input, "Public analysis of displayed code.");
  return { ...f, snapshot, session, executable, input };
}
test("opening summary is idempotent and the independent chat receives only displayed code and user context", async (t) => {
  const f = setup(t),
    chat = new ReviewChat(() => f.session.discussionView(), { executable: f.executable });
  const summary = await chat.turn({});
  assert.equal(summary.messages.length, 1);
  assert.deepEqual(await chat.turn({}), summary);
  await chat.turn({
    message: "What happens at equality?",
    annotations: [
      {
        id: "local",
        anchor: { kind: "candidate", path: "allow.ts", line: 2 },
        constraint: "A reader question",
        trigger: "Not yet established.",
        uncertainty: "",
      },
    ],
  });
  const input = readFileSync(f.input, "utf8");
  for (const value of [
    "PRIVATE-",
    f.snapshot.id,
    f.snapshot.files[0].candidateHash,
    f.snapshot.files[0].candidate.split("\n")[1],
    '"mutationReference"',
  ])
    assert.equal(input.includes(value), false, value);
  assert.ok(input.includes("count > limit"));
  assert.ok(input.includes("A reader question"));
  assert.equal(chat.view().messages.length, 3);
  assert.equal(f.session.agentView().phase, "reading");
  assert.equal(chat.view().messages.at(-1).text, "Public analysis of displayed code.");
});
test("chat failure is generic and does not commit a failed user turn", async (t) => {
  const f = setup(t),
    chat = new ReviewChat(() => f.session.discussionView(), { executable: f.executable });
  await chat.turn({});
  await assert.rejects(
    chat.turn({ message: "simulate-failure" }),
    /^Error: AI response unavailable\. Your message was not saved; try again\.$/,
  );
  assert.equal(chat.view().messages.length, 1);
  assert.equal(chat.view().busy, false);
});
test("successful request retries are deduplicated and a reused ID cannot change the message", async (t) => {
  const f = setup(t),
    chat = new ReviewChat(() => f.session.discussionView(), { executable: f.executable });
  await chat.turn({});
  const result = await chat.turn({ message: "Trace this input.", requestId: "retry-1" });
  assert.deepEqual(await chat.turn({ message: "Trace this input.", requestId: "retry-1" }), result);
  assert.equal(chat.view().messages.length, 3);
  await assert.rejects(chat.turn({ message: "Different input.", requestId: "retry-1" }));
});
test("simultaneous opening requests produce one summary and closed chat discards its transcript", async (t) => {
  const f = setup(t),
    chat = new ReviewChat(() => f.session.discussionView(), { executable: f.executable });
  const [first, second] = await Promise.all([chat.turn({}), chat.turn({})]);
  assert.equal(first.messages.length, 1);
  assert.equal(second.busy, true);
  assert.equal(chat.view().messages.length, 1);
  await chat.close();
  assert.equal(chat.view().messages.length, 0);
  assert.equal(chat.view().available, false);
});
test("chat stays free of oracle fields after reveal and validates reader comment scope", async (t) => {
  const f = setup(t),
    chat = new ReviewChat(() => f.session.discussionView(), { executable: f.executable });
  f.session.transition("submit", {
    prediction: "A reader prediction",
    annotations: [],
    noFindings: "No findings yet",
  });
  f.session.transition("reveal", {});
  await chat.turn({ message: "Discuss the clean code." });
  const input = readFileSync(f.input, "utf8");
  assert.equal(input.includes("PRIVATE-"), false);
  assert.equal(input.includes(f.snapshot.id), false);
  assert.equal(input.includes("count >= limit"), true);
  await assert.rejects(
    chat.turn({
      message: "Question",
      annotations: [
        {
          id: "bad",
          anchor: { kind: "file", path: "outside.ts" },
          constraint: "Question",
          trigger: "",
          uncertainty: "",
        },
      ],
    }),
  );
  assert.equal(chat.view().messages.length, 2);
});
test("chat HTTP requires author origin and capability but cannot reveal or mutate the review", async (t) => {
  const f = setup(t),
    server = await startServer(f.session, { executable: f.executable });
  t.after(() => server.close());
  const url = new URL(server.url),
    headers = {
      Origin: url.origin,
      "Content-Type": "application/json",
      "X-Minesweeper-Session": url.pathname.split("/")[1],
    };
  assert.equal(
    (
      await fetch(server.url + "chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  const summary = await fetch(server.url + "chat", { method: "POST", headers, body: "{}" });
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).messages.length, 1);
  assert.equal((await (await fetch(server.url + "chat")).json()).messages.length, 1);
  assert.equal(f.session.agentView().phase, "reading");
  const invalid = await fetch(server.url + "chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "question", mutation: { line: 2 } }),
  });
  assert.equal(invalid.status, 409);
});

test("automatic review evidence quotes author sources without passing references to AI", async (t) => {
  const f = setup(t),
    chat = new ReviewChat(() => f.session.discussionView(), { executable: f.executable });
  assert.deepEqual(await chat.reviewEvidence({ annotations: [] }), { entries: [] });
  f.session.transition("submit", { prediction: "Unclear", annotations: [], noFindings: "Unclear" });
  f.session.transition("reveal", {});
  const report =
    "For count=3, limit=3, tracing the clean >= branch returns false. Requirement: equality must be rejected.";
  chat.restore({
    messages: [
      { role: "user", text: report },
      { role: "assistant", text: "I ran tests and verified everything." },
    ],
    committed: [],
  });
  const entry = {
    path: "allow.ts",
    first: 2,
    last: 2,
    kind: "trace",
    sources: [{ id: "user:0", quote: report }],
    input: "count=3, limit=3",
    observed: "returns false",
    expected: "equality must be rejected",
    basis: "tracing the clean >= branch",
  };
  writeChatWorker(f.executable, f.input, JSON.stringify({ entries: [entry] }), {
    replyFormatSensitive: true,
  });
  const result = await chat.reviewEvidence({ annotations: [] });
  assert.deepEqual(result.entries, [entry]);
  const prompt = readFileSync(f.input, "utf8");
  assert.doesNotMatch(
    prompt,
    /PRIVATE-|mutationReference|initialReference|I ran tests and verified everything/,
  );
  writeChatWorker(
    f.executable,
    f.input,
    JSON.stringify({
      entries: [{ ...entry, sources: [{ id: "user:0", quote: "Imaginary test passed" }] }],
    }),
  );
  await assert.rejects(chat.reviewEvidence({ annotations: [] }));
  assert.equal(chat.view().busy, false);
  assert.equal(chat.view().messages.length, 2);
});

test("review evidence HTTP requires author origin and capability without revealing a reading session", async (t) => {
  const f = setup(t),
    server = await startServer(f.session, { executable: f.executable });
  t.after(() => server.close());
  const url = new URL(server.url),
    headers = {
      Origin: url.origin,
      "Content-Type": "application/json",
      "X-Minesweeper-Session": url.pathname.split("/")[1],
    };
  for (const invalidHeaders of [
    { "Content-Type": "application/json" },
    { ...headers, Origin: "https://outside.example.invalid" },
    { ...headers, "X-Minesweeper-Session": "wrong-capability" },
  ])
    assert.equal(
      (
        await fetch(server.url + "review-evidence", {
          method: "POST",
          headers: invalidHeaders,
          body: "{}",
        })
      ).status,
      403,
    );
  const before = f.session.view(),
    reading = await fetch(server.url + "review-evidence", {
      method: "POST",
      headers,
      body: "{}",
    });
  assert.equal(reading.status, 200);
  assert.deepEqual(await reading.json(), { entries: [] });
  assert.deepEqual(f.session.view(), before);
  assert.equal(f.session.view().phase, "reading");
  f.session.transition("submit", { prediction: "Unclear", annotations: [], noFindings: "Unclear" });
  f.session.transition("reveal", {});
  const result = await fetch(server.url + "review-evidence", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { entries: [] });
  assert.equal(f.session.view().phase, "revealed");
});

test("prereveal counterexamples use the real displayed projection without changing comments, chat or review progress", async (t) => {
  const f = setup(t),
    chat = new ReviewChat(
      () => f.session.discussionView(),
      { executable: f.executable },
      true,
      () => f.session.reviewDiscussionView(),
    ),
    annotation = {
      id: "equality",
      anchor: { kind: "candidate", path: "allow.ts", line: 2 },
      constraint: "Should reject equality",
      trigger: "Not yet established.",
      uncertainty: "",
    },
    entry = {
      path: "allow.ts",
      first: 2,
      last: 2,
      kind: "ai-counterexample",
      sources: [{ id: "comment:equality", quote: "Should reject equality" }],
      input: "count=3, limit=3",
      observed: "The function returns true.",
      expected: "The request must be rejected when the count reaches the limit.",
      basis: "The public requirement rejects requests at the limit.",
      version: "review",
      steps: [
        "For equal count and limit, count > limit is false, so the guard does not return false.",
        "The following return true accepts a request whose count has reached the limit.",
      ],
      code: [
        { line: 2, text: "  if (count > limit) return false;" },
        { line: 3, text: "  return true;" },
      ],
    };
  t.after(() => chat.close());
  chat.restore({
    messages: [{ role: "assistant", text: "PRIVATE-ASSISTANT-CLAIM: tests passed." }],
    committed: [],
  });
  writeChatWorker(f.executable, f.input, JSON.stringify({ entries: [entry] }), {
    replyFormatSensitive: true,
  });
  for (const phase of ["reading", "submitted"]) {
    if (phase === "submitted")
      f.session.transition("submit", {
        prediction: "Check the equality guard.",
        annotations: [annotation],
        noFindings: "",
      });
    const before = f.session.view(),
      messages = chat.checkpoint(),
      result = await chat.reviewEvidence({ annotations: [annotation] });
    assert.deepEqual(result.entries, [entry]);
    assert.deepEqual(f.session.view(), before);
    assert.deepEqual(chat.checkpoint(), messages);
    assert.equal(f.session.view().phase, phase);
    assert.equal(f.session.view().hintLevel, 0);
    assert.equal(chat.view().busy, false);
    const prompt = readFileSync(f.input, "utf8");
    assert.match(prompt, /Should reject equality/);
    assert.match(prompt, /count > limit/);
    for (const hidden of [
      "PRIVATE-",
      f.snapshot.id,
      f.snapshot.files[0].baselineHash,
      f.snapshot.files[0].candidateHash,
      "count >= limit",
      "return count < limit",
      '"baseline"',
      '"mutationReference"',
      '"initialReference"',
      '"seed"',
      '"hintLevel"',
    ])
      assert.equal(prompt.includes(hidden), false, hidden);
  }
});

test("prereveal evidence organization remains unavailable in a curator preview", async (t) => {
  const f = setup(t),
    preview = new ReviewSession(f.snapshot, exercise(f.snapshot), f.repo, true),
    server = await startServer(preview, { executable: f.executable });
  t.after(() => server.close());
  const url = new URL(server.url),
    before = preview.view(),
    result = await fetch(server.url + "review-evidence", {
      method: "POST",
      headers: {
        Origin: url.origin,
        "Content-Type": "application/json",
        "X-Minesweeper-Session": url.pathname.split("/")[1],
      },
      body: JSON.stringify({ annotations: [] }),
    });
  assert.equal(result.status, 409);
  assert.deepEqual(preview.view(), before);
});

function counterexampleFixture(t) {
  const f = fixture(t),
    executable = join(f.root, "counterexample-worker.mjs"),
    input = join(f.root, "counterexample-prompt.json"),
    displayed = [
      "export function canFulfill(available: boolean[]): boolean {",
      "  return available.some(Boolean);",
      "}",
    ],
    clean = [
      "export function canFulfill(available: boolean[]): boolean {",
      "  return available.every(Boolean);",
      "}",
    ],
    context = {
      phase: "revealed",
      freshness: "current",
      title: "Order eligibility",
      requirements: "An order is eligible only when every item is available.",
      intent: "Check whether the order can be fulfilled.",
      initialPrompt: "Explain how eligibility is determined.",
      annotations: [],
      files: [{ path: "orders.ts", baseline: [], candidate: clean, hunks: [] }],
    },
    historical = {
      ...context,
      phase: "reading",
      files: [{ path: "orders.ts", baseline: [], candidate: displayed, hunks: [] }],
      mutationReference: { expected: "PRIVATE-MUTATION-ANSWER" },
      initialReference: "PRIVATE-INITIAL-ANSWER",
      seed: "PRIVATE-SEED",
    },
    chat = new ReviewChat(
      () => context,
      { executable },
      true,
      () => historical,
    ),
    annotation = {
      id: "all-items",
      anchor: { kind: "candidate", path: "orders.ts", line: 2 },
      constraint: "Should be all",
      trigger: "",
      uncertainty: "",
    },
    entry = {
      path: "orders.ts",
      first: 2,
      last: 2,
      kind: "ai-counterexample",
      sources: [{ id: "comment:all-items", quote: "Should be all" }],
      input: "available = [true, false]",
      observed: "some(Boolean) returns true because its first item is true.",
      expected: "Eligibility is false because the second item is unavailable.",
      basis: "The public requirement requires every item to be available.",
      version: "review",
      steps: [
        "The first item satisfies Boolean, so some stops and returns true.",
        "The second item is false, so the order fails the all-items requirement.",
      ],
      code: [{ line: 2, text: "  return available.some(Boolean);" }],
    };
  chat.restore({
    messages: [{ role: "assistant", text: "PRIVATE-ASSISTANT-ASSERTION: all tests passed." }],
    committed: [],
  });
  t.after(() => chat.close());
  return { chat, executable, input, annotation, entry };
}

test("AI can derive a counterexample from a short comment and historical displayed code without a clean counterpart", async (t) => {
  const f = counterexampleFixture(t);
  writeChatWorker(f.executable, f.input, JSON.stringify({ entries: [f.entry] }), {
    replyFormatSensitive: true,
  });
  const result = await f.chat.reviewEvidence({ annotations: [f.annotation] });
  assert.deepEqual(result.entries, [f.entry]);
  const prompt = readFileSync(f.input, "utf8");
  assert.match(prompt, /Should be all/);
  assert.match(prompt, /available\.some\(Boolean\)/);
  assert.match(prompt, /every item is available/);
  assert.doesNotMatch(
    prompt,
    /available\.every\(Boolean\)|PRIVATE-|mutationReference|initialReference/,
  );
  assert.equal(f.chat.view().messages.length, 1);
  assert.equal(f.chat.view().busy, false);
});

test("AI counterexamples reject forged code, incomplete traces, wrong versions and assistant sources", async (t) => {
  const f = counterexampleFixture(t);
  for (const entry of [
    { ...f.entry, code: [{ line: 2, text: "  return available.every(Boolean);" }] },
    { ...f.entry, code: [{ line: 4, text: "  return available.some(Boolean);" }] },
    { ...f.entry, code: [] },
    { ...f.entry, steps: [] },
    { ...f.entry, version: "clean" },
    {
      ...f.entry,
      sources: [{ id: "assistant:0", quote: "PRIVATE-ASSISTANT-ASSERTION: all tests passed." }],
    },
  ]) {
    writeChatWorker(f.executable, f.input, JSON.stringify({ entries: [entry] }));
    await assert.rejects(
      f.chat.reviewEvidence({ annotations: [f.annotation] }),
      /Evidence could not be organized/,
    );
    assert.equal(f.chat.view().busy, false);
  }
  assert.equal(f.chat.view().messages.length, 1);
});

test("the runtime historical projection preserves displayed lines after reveal without clean counterpart or oracle fields", (t) => {
  const f = setup(t),
    before = f.session.discussionView();
  f.session.transition("submit", { prediction: "Unclear", annotations: [], noFindings: "Unclear" });
  f.session.transition("reveal", {});
  const historical = f.session.reviewDiscussionView();
  assert.deepEqual(historical.files[0].candidate, before.files[0].candidate);
  assert.notDeepEqual(historical.files[0].candidate, f.session.discussionView().files[0].candidate);
  assert.deepEqual(Object.keys(historical).sort(), ["files", "requirements"]);
  assert.deepEqual(Object.keys(historical.files[0]).sort(), ["candidate", "path"]);
  assert.doesNotMatch(
    JSON.stringify(historical),
    /PRIVATE-|baselineHash|candidateHash|mutationReference|initialReference|seed/,
  );
});
