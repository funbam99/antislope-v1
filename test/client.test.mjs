import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { ReviewSession } from "../src/minesweeper/session.ts";
import { client } from "../src/minesweeper/client.ts";
import { page as pageMarkup } from "../src/minesweeper/page.ts";

// These minimal DOM adapters dispatch the actual client's event handlers;
// network responses come from the real session model, not canned state.
class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.handlers = {};
    this.value = "";
    this.textContent = "";
    this.classList = { toggle() {} };
    this.dataset = {};
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.open = false;
  }
  append(...values) {
    for (const value of values) if (value instanceof Element) value.parentElement = this;
    this.children.push(...values);
  }
  prepend(...values) {
    for (const value of values) if (value instanceof Element) value.parentElement = this;
    this.children.unshift(...values);
  }
  replaceChildren(...values) {
    this.children = values;
  }
  addEventListener(event, handler) {
    this.handlers[event] = handler;
  }
  setAttribute() {}
  getBoundingClientRect() {
    return { left: 0, width: 1200 };
  }
  setPointerCapture() {}
  focus() {}
  show() {
    this.open = true;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  contains(target) {
    return walk(this).includes(target);
  }
  closest(selector) {
    if (selector === ".code-row" && this.className?.split(" ").includes("code-row")) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const textOf = (e) => (typeof e === "string" ? e : e.textContent + e.children.map(textOf).join(""));
const walk = (e) => [e, ...e.children.filter((v) => v instanceof Element).flatMap(walk)];
async function browser(
  session,
  chatTransport,
  storage = new Map(),
  tabStorage = new Map(),
  evidenceTransport,
) {
  const map = new Map();
  const element = (id) => {
    if (!map.has(id)) map.set(id, new Element());
    return map.get(id);
  };
  const document = {
    getElementById: (id) =>
      id === "download-handoff"
        ? (walk(element("steps")).find((n) => n.id === id) ?? null)
        : element(id),
    createElement: (tag) => new Element(tag),
    createTextNode: (value) => value,
    createDocumentFragment: () => new Element(),
    addEventListener() {},
    body: new Element(),
    documentElement: new Element(),
  };
  let uuid = 0;
  const context = vm.createContext({
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    sessionStorage: {
      getItem: (key) => tabStorage.get(key) ?? null,
      setItem: (key, value) => tabStorage.set(key, value),
    },
    location: { pathname: "/token/" },
    crypto: {
      randomUUID: () => "00000000-0000-4000-8000-" + (++uuid).toString().padStart(12, "0"),
    },
    getSelection: () => context.selection,
    addEventListener() {},
    innerWidth: 1200,
    innerHeight: 900,
    setTimeout: () => 1,
    clearTimeout() {},
    Date,
    structuredClone,
    fetch: async (url, options) =>
      url.endsWith("/review-evidence")
        ? {
            ok: true,
            json: async () => (evidenceTransport ? evidenceTransport(options) : { entries: [] }),
          }
        : url.endsWith("/chat")
          ? chatTransport
            ? chatTransport(options)
            : { ok: true, json: async () => ({ messages: [], busy: false, available: false }) }
          : {
              ok: true,
              json: async () =>
                options
                  ? session.transition(url.split("/").at(-1), JSON.parse(options.body))
                  : session.view(),
            },
  });
  vm.runInContext(client, context);
  await tick();
  const find = (text) => {
    const result = [...walk(element("steps")), ...walk(element("chat-transcript"))].find(
      (n) => n.textContent === text,
    );
    assert.ok(result, "Missing control: " + text);
    return result;
  };
  const fill = (label, value, tag = "textarea") => {
    const control = find(label).children.find((n) => n.tag === tag);
    assert.ok(control);
    control.value = value;
    control.handlers[tag === "select" ? "change" : "input"]();
  };
  const click = async (text) => {
    if (
      text === "Submit first pass" &&
      !walk(element("chat-transcript")).some((n) => n.textContent === text)
    )
      element("chat-next").handlers.click();
    find(text).handlers.click();
    await tick();
  };
  return { element, fill, click, find, context };
}
function sessionFor(t, ready = false) {
  const f = fixture(t),
    s = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(s, exercise(s));
  const notes = ready
    ? [
        {
          id: "existing",
          anchor: { kind: "change" },
          constraint: "Confirm contract.",
          trigger: "Equality.",
          uncertainty: "",
        },
      ]
    : [];
  session.transition("submit", {
    prediction: "Unclear.",
    annotations: notes,
    noFindings: notes.length ? "" : "No independent findings.",
  });
  session.transition("reveal", {});
  if (ready) {
    session.transition("assess", {
      assessments: [
        {
          id: "existing",
          kind: "question",
          evidence: "",
          disposition: "question",
          next: "Old question.",
          repairNote: "",
        },
      ],
      region: { kind: "reread", note: "Reviewed the captured boundary." },
      referenceDispute: "",
    });
    session.transition("followup", { prediction: "true", dispute: "" });
  }
  return session;
}
test("confirming the inline review card keeps new findings as questions and prepares handoff without forms", async (t) => {
  const session = sessionFor(t),
    page = await browser(session);
  page.element("anchor-kind").value = "change";
  page.element("constraint").value = "Requirement clarification";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  page.element("chat-card").handlers.click();
  await tick();
  assert.ok(
    !walk(page.element("chat-transcript")).some((e) => e.tag === "textarea" || e.tag === "select"),
  );
  await page.click("Confirm review card");
  assert.equal(page.element("error").textContent, "");
  assert.equal(session.view().assessments[0].kind, "question");
  assert.match(session.view().assessments[0].next, /Requirement clarification/);
  assert.ok(session.view().followup);
  assert.match(session.export(), /Requirement clarification/);
});
test("new chat after card confirmation blocks export until the updated card is confirmed", async (t) => {
  const session = sessionFor(t, true);
  let messages = [{ role: "assistant", text: "Summary" }];
  const page = await browser(session, async (options) => {
    if (options) {
      const body = JSON.parse(options.body);
      messages = messages.concat(
        { role: "user", text: body.message },
        { role: "assistant", text: "A hypothesis only." },
      );
    }
    return { ok: true, json: async () => ({ messages, available: true, busy: false }) };
  });
  page.element("chat-card").handlers.click();
  await tick();
  await page.click("Confirm review card");
  assert.equal(page.find("Export handoff").disabled, false);
  page.element("chat-message").value = "There is another unresolved question.";
  page.element("chat-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(page.find("Export handoff").disabled, true);
  await page.click("Confirm review card");
  assert.equal(page.find("Export handoff").disabled, false);
  assert.match(session.export(), /another unresolved question/);
});

test("selecting displayed code opens a nearby comment editor and saves a comment without an invented trigger", async (t) => {
  const f = fixture(t),
    s = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(s, exercise(s)),
    page = await browser(session);
  const rows = page.element("code").children.filter((row) => row.className?.includes("code-row"));
  const row = rows.find((row) => row.dataset.line === "2" && row.dataset.kind === "candidate");
  assert.ok(row, "Candidate row metadata");
  page.context.selection = {
    isCollapsed: false,
    anchorNode: row.children[1],
    focusNode: row.children[1],
    toString: () => "count > limit",
    rangeCount: 1,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 300, bottom: 200 }) }),
  };
  page.element("code").handlers.keyup({ key: "ArrowRight" });
  assert.equal(page.element("comment-dialog").open, false);
  page.element("code").handlers.keyup({ key: "Shift" });
  assert.equal(page.element("comment-dialog").open, true);
  page.element("close-comment").handlers.click();
  page.element("code").handlers.mouseup();
  assert.equal(page.element("comment-dialog").open, true);
  assert.equal(page.element("anchor-line").value, 2);
  page.element("constraint").value = "Could equality violate the requirement?";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(page.element("comment-dialog").open, false);
  await page.click("Submit first pass");
  assert.equal(session.view().annotations[0].constraint, "Could equality violate the requirement?");
  assert.equal(session.view().annotations[0].trigger, "Not yet established.");
  assert.equal(session.view().annotations[0].anchor.line, 2);
});

test("closing a comment preserves its draft and selecting another line does not move it", async (t) => {
  const session = sessionFor(t),
    page = await browser(session);
  const rows = page.element("code").children.filter((row) => row.className?.includes("code-row"));
  rows
    .find((row) => row.dataset.kind === "candidate" && row.dataset.line === "2")
    .children[0].handlers.click();
  await tick();
  page.element("constraint").value = "Keep this unfinished question";
  page.element("close-comment").handlers.click();
  assert.equal(page.element("comment-dialog").open, false);
  assert.equal(page.element("resume-comment").hidden, false);
  rows
    .find((row) => row.dataset.kind === "candidate" && row.dataset.line === "3")
    .children[0].handlers.click();
  await tick();
  assert.equal(page.element("anchor-line").value, 2);
  assert.equal(page.element("constraint").value, "Keep this unfinished question");
  assert.equal(page.element("comment-dialog").open, true);
  page.element("clear-draft").handlers.click();
  assert.equal(page.element("constraint").value, "");
  assert.equal(page.element("comment-dialog").open, false);
});

// The chat transport is independent of review transitions: chat must never reveal answers.
test("chat loads one opening summary and keeps the review reading", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot));
  let messages = [],
    openings = 0;
  const transport = async (options) => {
    if (options) {
      openings++;
      messages = [{ role: "assistant", text: "This change adjusts a boundary check." }];
    }
    return { ok: true, json: async () => ({ messages, busy: false, available: true }) };
  };
  const page = await browser(session, transport);
  await tick();
  assert.equal(openings, 1);
  assert.ok(walk(page.element("chat-transcript")).some((n) => textOf(n) === messages[0].text));
  await browser(session, transport);
  assert.equal(openings, 1);
  assert.equal(session.view().phase, "reading");
});

test("chat sends chosen comments only with an explicit turn and preserves a failed draft for retry", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot));
  let fail = true,
    sent = [];
  const transport = async (options) => {
    if (options) {
      const body = JSON.parse(options.body);
      sent.push(body);
      if (fail) return { ok: false, json: async () => ({ error: "Chat unavailable. Retry." }) };
      return {
        ok: true,
        json: async () => ({
          messages: [
            { role: "user", text: body.message },
            { role: "assistant", text: "Check the equality case." },
          ],
          busy: false,
          available: true,
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        messages: [{ role: "assistant", text: "Opening summary." }],
        busy: false,
        available: true,
      }),
    };
  };
  const page = await browser(session, transport);
  page.element("anchor-kind").value = "change";
  page.element("constraint").value = "Check equality.";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(sent.length, 0);
  page.element("chat-message").value = "Explain the boundary.";
  page.element("chat-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(page.element("chat-message").value, "Explain the boundary.");
  assert.equal(page.element("chat-retry").hidden, false);
  assert.equal(sent[0].annotations[0].constraint, "Check equality.");
  assert.equal(typeof sent[0].requestId, "string");
  fail = false;
  page.element("chat-retry").handlers.click();
  await tick();
  assert.equal(page.element("chat-message").value, "");
  assert.equal(sent[1].requestId, sent[0].requestId);
  page.element("chat-message").value = "Explain a different case.";
  page.element("chat-message").handlers.input();
  page.element("chat-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.notEqual(sent[2].requestId, sent[1].requestId);
  assert.ok(
    walk(page.element("chat-transcript")).some((n) => textOf(n) === "Check the equality case."),
  );
  assert.equal(session.view().phase, "reading");
});

test("opening summary shows pending state and can be retried after failure", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot));
  let finish,
    attempts = 0;
  const transport = async (options) => {
    if (options) {
      attempts++;
      if (attempts === 1)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return {
        ok: true,
        json: async () => ({
          messages: [{ role: "assistant", text: "Neutral summary." }],
          busy: false,
          available: true,
        }),
      };
    }
    return { ok: true, json: async () => ({ messages: [], busy: false, available: true }) };
  };
  const page = await browser(session, transport);
  assert.equal(page.element("chat-send").disabled, true);
  assert.equal(page.element("chat-status").textContent, "Thinking…");
  finish({ ok: false, json: async () => ({ error: "Summary unavailable." }) });
  await tick();
  assert.equal(page.element("chat-retry").hidden, false);
  page.element("chat-retry").handlers.click();
  await tick();
  assert.equal(page.element("chat-send").disabled, false);
  assert.equal(page.element("chat-error").hidden, true);
  assert.ok(walk(page.element("chat-transcript")).some((n) => textOf(n) === "Neutral summary."));
  assert.equal(session.view().phase, "reading");
});

test("review steps and requirements appear inside chat without opening dialogs", async (t) => {
  const page = await browser(sessionFor(t));
  page.element("open-workflow").handlers.click();
  await tick();
  assert.notEqual(page.element("workflow-dialog").open, true);
  page.element("open-details").handlers.click();
  await tick();
  assert.notEqual(page.element("details-dialog").open, true);
  assert.match(textOf(page.element("chat-transcript")), /Requirements|contract|limit/i);
});

test("quoting a selected comment preserves the chat draft and uses displayed code without sending", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot));
  const sends = [];
  const page = await browser(session, async (options) => {
    if (options) sends.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        messages: [{ role: "assistant", text: "Summary" }],
        available: true,
        busy: false,
      }),
    };
  });
  const rows = page.element("code").children.filter((row) => row.dataset.kind === "candidate");
  const start = rows.find((row) => row.dataset.line === "2"),
    end = rows.find((row) => row.dataset.line === "3");
  page.context.selection = {
    isCollapsed: false,
    anchorNode: end.children[1],
    focusNode: start.children[1],
    toString: () => "selected code",
    rangeCount: 0,
  };
  page.element("code").handlers.mouseup();
  page.element("constraint").value = "Does equality work?";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  page.element("chat-message").value = "My existing question";
  const quote = walk(page.element("code")).find((e) => e.textContent === "Quote in chat");
  assert.ok(quote, "Saved comments have an explicit quote action");
  quote.handlers.click();
  await tick();
  const draft = page.element("chat-message").value;
  assert.match(draft, /^My existing question/);
  assert.match(draft, /allow.ts:2–3/);
  assert.match(draft, /count > limit/);
  assert.doesNotMatch(draft, /count >= limit/);
  assert.match(draft, /Does equality work\?/);
  assert.equal(sends.length, 0);
  page.element("chat-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(sends[0].message, draft);
  assert.equal(session.view().phase, "reading");
});

test("an oversized quotation leaves the existing chat draft intact", async (t) => {
  const page = await browser(sessionFor(t, true));
  const draft = "x".repeat(3990);
  page.element("chat-message").value = draft;
  const quote = walk(page.element("code")).find((e) => e.textContent === "Quote in chat");
  assert.ok(quote);
  quote.handlers.click();
  await tick();
  assert.equal(page.element("chat-message").value, draft);
  assert.match(page.element("chat-error").textContent, /4,000/);
});

test("quoting after reveal reads clean displayed code instead of retaining an earlier review excerpt", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot));
  session.transition("submit", {
    prediction: "Uncertain",
    annotations: [
      {
        id: "line",
        anchor: { kind: "candidate", path: "allow.ts", line: 2 },
        constraint: "Check equality",
        trigger: "Equality",
        uncertainty: "",
      },
    ],
    noFindings: "",
  });
  session.transition("reveal", {});
  const page = await browser(session);
  walk(page.element("code"))
    .find((e) => e.textContent === "Quote in chat")
    .handlers.click();
  await tick();
  assert.match(page.element("chat-message").value, /Captured clean candidate/);
  assert.match(page.element("chat-message").value, /count >= limit/);
  assert.doesNotMatch(page.element("chat-message").value, /count > limit/);
});

test("saved comments and selection ranges survive closing a tab and reopening the session", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot)),
    storage = new Map();
  const page = await browser(session, undefined, storage);
  const rows = page.element("code").children.filter((row) => row.dataset.kind === "candidate");
  const start = rows.find((row) => row.dataset.line === "2"),
    end = rows.find((row) => row.dataset.line === "3");
  page.context.selection = {
    isCollapsed: false,
    anchorNode: start.children[1],
    focusNode: end.children[1],
    toString: () => "code",
    rangeCount: 0,
  };
  page.element("code").handlers.mouseup();
  page.element("constraint").value = "Read both branches";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  const reloaded = await browser(session, undefined, storage);
  walk(reloaded.element("code"))
    .find((e) => e.textContent === "Quote in chat")
    .handlers.click();
  await tick();
  assert.match(reloaded.element("chat-message").value, /allow.ts:2–3/);
  assert.match(reloaded.element("chat-message").value, /return true/);
  assert.match(reloaded.element("chat-message").value, /Read both branches/);
});

test("double-click selection can be added directly to chat without saving a comment or sending", async (t) => {
  const page = await browser(sessionFor(t));
  const row = page
    .element("code")
    .children.find((row) => row.dataset.kind === "candidate" && row.dataset.line === "2");
  page.context.selection = {
    isCollapsed: false,
    anchorNode: row.children[1],
    focusNode: row.children[1],
    toString: () => "count",
    rangeCount: 0,
  };
  assert.ok(page.element("code").handlers.dblclick);
  page.element("code").handlers.dblclick();
  assert.equal(page.element("comment-dialog").open, true);
  page.element("selection-chat").handlers.click();
  await tick();
  assert.match(page.element("chat-message").value, /allow.ts:2/);
  assert.match(page.element("chat-message").value, /count >= limit/);
  assert.equal(page.element("comment-dialog").open, false);
  assert.equal(
    walk(page.element("code")).filter((e) => e.className?.includes("inline-comment")).length,
    0,
  );
});

test("the comment editor has no trigger or annotation-details controls", () => {
  assert.doesNotMatch(pageMarkup, /Trigger and annotation details|Trigger \/ example/);
});

test("existing tab comments migrate without storing source or reference answers", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot));
  const storage = new Map(),
    tabStorage = new Map([
      [
        "minesweeper-comments:token",
        JSON.stringify({
          phase: "reading",
          notes: [
            {
              id: "old",
              anchor: { kind: "candidate", path: "allow.ts", line: 2 },
              constraint: "Check both lines",
              trigger: "Not yet established.",
              uncertainty: "",
            },
          ],
          ranges: [["old", { first: 2, last: 3 }]],
        }),
      ],
    ]);
  await browser(session, undefined, storage, tabStorage);
  const restored = await browser(session, undefined, storage);
  walk(restored.element("code"))
    .find((e) => e.textContent === "Quote in chat")
    .handlers.click();
  await tick();
  assert.match(restored.element("chat-message").value, /allow.ts:2–3/);
  const saved = JSON.parse(storage.get("minesweeper-comments:token"));
  assert.deepEqual(Object.keys(saved).sort(), ["notes", "phase", "ranges"]);
  assert.doesNotMatch(
    JSON.stringify(saved),
    /count > limit|count >= limit|initialReference|mutationReference|replacement|snapshot/,
  );
});

test("appearance preference restores on reopen and switching themes does not change review state", async (t) => {
  const session = sessionFor(t),
    storage = new Map([["antislope-appearance", "dark"]]);
  const page = await browser(session, undefined, storage);
  assert.equal(page.context.document.documentElement.dataset.theme, "dark");
  assert.equal(page.element("appearance").value, "dark");
  page.element("appearance").value = "light";
  page.element("appearance").handlers.change();
  assert.equal(page.context.document.documentElement.dataset.theme, "light");
  assert.equal(storage.get("antislope-appearance"), "light");
  const reopened = await browser(session, undefined, storage);
  assert.equal(reopened.context.document.documentElement.dataset.theme, "light");
  assert.equal(session.view().phase, "revealed");
});

test("file view selection keeps diff and full captured versions available", async (t) => {
  const page = await browser(sessionFor(t));
  page.element("file-view").value = "baseline";
  page.element("file-view").handlers.change();
  assert.match(page.element("code-help").textContent, /Captured baseline/);
  page.element("file-view").value = "candidate";
  page.element("file-view").handlers.change();
  assert.match(page.element("code-help").textContent, /Captured clean candidate/);
});

test("line comments render inline after the selected range and survive view changes", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot));
  const page = await browser(session);
  const rows = page.element("code").children.filter((e) => e.dataset.kind === "candidate");
  const first = rows.find((e) => e.dataset.line === "2"),
    last = rows.find((e) => e.dataset.line === "3");
  page.context.selection = {
    isCollapsed: false,
    anchorNode: first.children[1],
    focusNode: last.children[1],
    toString: () => "code",
    rangeCount: 0,
  };
  page.element("code").handlers.mouseup();
  page.element("constraint").value = "Check both branches";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  for (const mode of ["diff", "candidate"]) {
    page.element("file-view").value = mode;
    page.element("file-view").handlers.change();
    const children = page.element("code").children;
    const index = children.findIndex((e) => e.className?.includes("inline-comment"));
    assert.ok(index > 0);
    assert.equal(children[index - 1].dataset.line, "3");
    assert.equal(children[index - 1].dataset.kind, "candidate");
    assert.match(
      walk(children[index])
        .map((e) => e.textContent)
        .join(" "),
      /Check both branches/,
    );
  }
});

test("splitter drag and keyboard resizing stay bounded and remember the chosen width", async (t) => {
  const storage = new Map(),
    session = sessionFor(t),
    page = await browser(session, undefined, storage),
    divider = page.element("pane-divider");
  assert.ok(divider.handlers.pointerdown);
  divider.handlers.pointerdown({ button: 0, pointerId: 1, clientX: 840, preventDefault() {} });
  divider.handlers.pointermove({ pointerId: 1, clientX: 900 });
  divider.handlers.pointerup({ pointerId: 1 });
  assert.equal(storage.get("antislope-code-width"), "75");
  const reopened = await browser(session, undefined, storage);
  assert.equal(reopened.element("workspace").style["--code-width"], "75%");
  reopened.element("pane-divider").handlers.keydown({ key: "ArrowLeft", preventDefault() {} });
  assert.equal(storage.get("antislope-code-width"), "73");
  reopened.element("pane-divider").handlers.keydown({ key: "End", preventDefault() {} });
  assert.ok(Number(storage.get("antislope-code-width")) < 100);
});

test("deleted-line comments retain their baseline anchor while file and change comments remain visible", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot));
  session.transition("submit", {
    prediction: "Uncertain",
    annotations: [
      {
        id: "deleted",
        anchor: { kind: "baseline", path: "allow.ts", line: 2 },
        constraint: "Was this removed check needed?",
        trigger: "Not yet established.",
        uncertainty: "",
      },
      {
        id: "file",
        anchor: { kind: "file", path: "allow.ts" },
        constraint: "File question",
        trigger: "Not yet established.",
        uncertainty: "",
      },
      {
        id: "change",
        anchor: { kind: "change" },
        constraint: "Change question",
        trigger: "Not yet established.",
        uncertainty: "",
      },
    ],
    noFindings: "",
  });
  const page = await browser(session);
  const children = page.element("code").children,
    index = children.findIndex((e) => e.dataset.noteId === "deleted");
  assert.equal(children[index - 1].dataset.kind, "baseline");
  assert.equal(children[index - 1].dataset.line, "2");
  page.element("file-view").value = "candidate";
  page.element("file-view").handlers.change();
  assert.equal(
    walk(page.element("code")).filter((e) => e.className?.includes("inline-comment")).length,
    3,
  );
  const link = walk(page.element("code")).find((e) => e.textContent === "View baseline");
  assert.ok(link);
  link.handlers.click();
  await tick();
  assert.equal(page.element("file-view").value, "baseline");
  const all = page.element("code").children,
    pos = all.findIndex((e) => e.dataset.noteId === "deleted");
  assert.equal(all[pos - 1].dataset.kind, "baseline");
});

test("chat renders Markdown and highlights fenced TypeScript while HTML and unsafe links stay inert", async (t) => {
  const reply =
    '# A hypothesis\n\n**Boundary** and `count` matter.\n\n- Check equality\n- Read both branches\n\n```ts\nconst message = "hello"; // example\nif (count >= 2) return true;\n```\n\n[Docs](https://example.com/docs) [Unsafe](javascript:alert)\n\n<img src=x onerror=alert(1)>\n\n```html\n<script>alert(1)</script>\n```';
  const page = await browser(sessionFor(t), async () => ({
    ok: true,
    json: async () => ({
      messages: [{ role: "assistant", text: reply }],
      available: true,
      busy: false,
    }),
  }));
  const elements = walk(page.element("chat-transcript"));
  for (const tag of ["h1", "strong", "ul", "li", "pre", "code"])
    assert.ok(
      elements.some((e) => e.tag === tag),
      tag,
    );
  assert.ok(elements.some((e) => e.className === "syntax-keyword" && e.textContent === "const"));
  assert.ok(elements.some((e) => e.className === "syntax-comment"));
  assert.ok(elements.some((e) => e.tag === "a" && e.href === "https://example.com/docs"));
  assert.ok(!elements.some((e) => ["img", "script", "iframe"].includes(e.tag)));
  assert.ok(!elements.some((e) => e.tag === "a" && e.href?.startsWith("javascript:")));
});

test("the visible progress bar opens first pass without revealing answers", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot)),
    page = await browser(session);
  const first = walk(page.element("review-progress")).find((e) => e.dataset.step === "1");
  assert.ok(first);
  assert.equal(first.disabled, false);
  const reveal = walk(page.element("review-progress")).find((e) => e.dataset.step === "2");
  assert.equal(reveal.disabled, true);
  first.handlers.click();
  assert.notEqual(page.element("workflow-dialog").open, true);
  assert.ok(page.element("chat-transcript").children.length > 0);
  assert.equal(session.view().phase, "reading");
  assert.equal(session.view().initialReference, undefined);
});

test("progress navigation opens available steps without changing the reveal or handoff stage", async (t) => {
  const session = sessionFor(t, true),
    page = await browser(session);
  const controls = walk(page.element("review-progress")).filter((e) => e.dataset.step);
  assert.equal(controls.length, 5);
  assert.ok(controls.every((e) => !e.disabled));
  for (const control of controls) {
    control.handlers.click();
    await tick();
    assert.equal(session.view().phase, "revealed");
  }
  assert.notEqual(page.element("workflow-dialog").open, true);
  assert.ok(page.element("chat-transcript").children.length > 0);
});

test("chat shortcuts navigate safely and the review card contains comments without answers or scores", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot)),
    page = await browser(session);
  assert.equal(page.element("chat-hint").disabled, true);
  assert.equal(page.element("chat-next").disabled, false);
  page.element("chat-next").handlers.click();
  assert.notEqual(page.element("workflow-dialog").open, true);
  assert.ok(page.element("chat-transcript").children.length > 0);
  assert.equal(session.view().phase, "reading");
  page.element("file-anchor").handlers.click();
  page.element("constraint").value = "Clarify the equality requirement";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  page.element("chat-card").handlers.click();
  assert.notEqual(page.element("review-card-dialog").open, true);
  assert.match(textOf(page.element("chat-transcript")), /Clarify the equality requirement/);
  assert.doesNotMatch(
    textOf(page.element("chat-transcript")),
    /Deliberate errors|Curator reference|Displayed actual behavior|score|hit rate/i,
  );
  assert.equal(session.view().phase, "reading");
  assert.equal(page.element("review-card-dialog").open, false);
});

test("Hint shortcut unlocks after first pass and renders the runtime hint only in chat", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot));
  session.transition("submit", {
    prediction: "Uncertain",
    annotations: [],
    noFindings: "Read the boundary",
  });
  const page = await browser(session);
  assert.equal(page.element("chat-hint").disabled, false);
  page.element("chat-hint").handlers.click();
  await tick();
  assert.notEqual(page.element("workflow-dialog").open, true);
  assert.ok(page.element("chat-transcript").children.length > 0);
  assert.equal(session.view().phase, "submitted");
  assert.equal(session.view().initialReference, undefined);
});

test("local metadata persists safe outcomes across reopening without source, hints, or answers", async (t) => {
  const storage = new Map(),
    session = sessionFor(t, true),
    page = await browser(session, undefined, storage);
  const saved = JSON.parse(storage.get("antislope-review-metadata"));
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].stages.assessed, true);
  assert.equal(saved.records[0].outcomes.unresolvedQuestions, 1);
  assert.doesNotMatch(
    JSON.stringify(saved),
    /allow\.ts|count >= limit|mutation|hintLevel|initialReference|referenceDispute|prediction|trigger/i,
  );
  await browser(session, undefined, storage);
  const reopened = JSON.parse(storage.get("antislope-review-metadata"));
  assert.equal(reopened.participantId, saved.participantId);
  assert.equal(reopened.records.length, 1);
  page.element("metadata-usefulness").value = "useful";
  page.element("metadata-usefulness").handlers.change();
  assert.equal(
    JSON.parse(storage.get("antislope-review-metadata")).records[0].usefulness,
    "useful",
  );
});

test("first pass reuses existing comments and chat without prediction or no-findings fields", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot));
  const page = await browser(session, async () => ({
    ok: true,
    json: async () => ({
      messages: [
        { role: "assistant", text: "AI hypothesis should not become the author's answer." },
        { role: "user", text: "I suspect equality returns true. Need to check the contract." },
      ],
      available: true,
      busy: false,
    }),
  }));
  assert.ok(!walk(page.element("steps")).some((e) => e.tag === "textarea"));
  await page.click("Submit first pass");
  assert.equal(session.view().phase, "submitted");
  assert.match(session.view().firstPass.prediction, /I suspect equality returns true/);
  assert.doesNotMatch(session.view().firstPass.prediction, /AI hypothesis/);
  assert.equal(session.view().initialReference, undefined);
});

test("first pass can continue with no comments or chat and freezes only the submitted content", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot)),
    page = await browser(session);
  await page.click("Submit first pass");
  assert.equal(session.view().phase, "submitted");
  assert.equal(session.view().firstPass.annotations.length, 0);
  assert.match(session.view().firstPass.noFindings, /No comments/);
  assert.doesNotMatch(session.view().firstPass.prediction, /correct|safe|verified/i);
});

test("long author discussion is preserved locally while the legacy session stores a bounded excerpt", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot)),
    storage = new Map();
  const messages = [
    { role: "user", text: "First hypothesis: " + "a".repeat(3500) },
    { role: "user", text: "Second hypothesis: " + "b".repeat(3500) },
  ];
  const page = await browser(
    session,
    async () => ({ ok: true, json: async () => ({ messages, available: true, busy: false }) }),
    storage,
  );
  await page.click("Submit first pass");
  const saved = JSON.parse(storage.get("minesweeper-author-evidence:token"));
  assert.deepEqual(saved.firstPass.messages, messages);
  assert.ok(session.view().firstPass.prediction.length <= 4000);
  assert.match(session.view().firstPass.prediction, /earlier text omitted/);
});

test("runtime hints stay in the chat UI and never enter AI turn payloads or review source", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot));
  session.transition("submit", {
    prediction: "Context",
    annotations: [],
    noFindings: "No comments",
  });
  const sent = [],
    page = await browser(session, async (options) => {
      if (options) sent.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          messages: [{ role: "assistant", text: "Summary" }],
          available: true,
          busy: false,
        }),
      };
    });
  page.element("chat-hint").handlers.click();
  await tick();
  assert.match(textOf(page.element("chat-transcript")), /Give me a hint/);
  assert.match(textOf(page.element("chat-transcript")), /Deliberate errors: 1/);
  assert.equal(session.view().phase, "submitted");
  page.element("chat-message").value = "Help trace this branch.";
  page.element("chat-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(sent.length, 1);
  assert.doesNotMatch(JSON.stringify(sent[0]), /Deliberate errors|hintLevel|Give me a hint/);
  assert.equal(session.view().initialReference, undefined);
});

test("review card does not infer verification from AI claims and follow-up release requires explicit confirmation", async (t) => {
  const session = sessionFor(t),
    page = await browser(session, async () => ({
      ok: true,
      json: async () => ({
        messages: [
          { role: "assistant", text: "This issue is verified and tests pass." },
          { role: "user", text: "Could the requirement be unclear?" },
        ],
        available: true,
        busy: false,
      }),
    }));
  page.element("chat-card").handlers.click();
  await tick();
  assert.equal(session.view().followupReference, undefined);
  await page.click("Confirm review card");
  assert.ok(session.view().followupReference);
  assert.ok(session.view().assessments.every((a) => a.kind === "question" && a.evidence === ""));
  assert.ok(!session.export().includes("tests pass"));
});

test("real issues require explicit confirmation using author discussion recorded after reveal", async (t) => {
  const session = sessionFor(t),
    messages = [{ role: "assistant", text: "AI claims alone are not verification." }],
    page = await browser(session, async (options) => {
      if (options) {
        const value = JSON.parse(options.body);
        messages.push(
          { role: "user", text: value.message },
          { role: "assistant", text: "Thanks for the recorded evidence." },
        );
      }
      return {
        ok: true,
        json: async () => ({ messages: [...messages], available: true, busy: false }),
      };
    });
  page.element("anchor-kind").value = "change";
  page.element("constraint").value = "A clean-code issue to check";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  page.element("chat-card").handlers.click();
  await tick();
  assert.equal(page.find("Confirm verified issue").disabled, true);
  page.element("chat-message").value =
    "I checked the captured clean code and ran the triggering test locally. Here is my evidence.";
  page.element("chat-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(page.find("Confirm verified issue").disabled, false);
  await page.click("Confirm verified issue");
  await page.click("Confirm review card");
  const issue = session.view().assessments.find((a) => a.kind === "real");
  assert.ok(issue);
  assert.match(issue.evidence, /I checked the captured clean code/);
  assert.doesNotMatch(issue.evidence, /AI claims/);
});

test("the comment editor is not nested inside a closed dialog or an unclosed section", () => {
  const stack = [];
  for (const match of pageMarkup.matchAll(/<\/?(dialog|section)\b[^>]*>/g)) {
    const [tag, kind] = match;
    if (tag.startsWith("</"))
      assert.equal(stack.pop()?.kind, kind, "Mismatched container closing tag");
    else {
      if (tag.includes('id="comment-dialog"'))
        assert.ok(
          !stack.some((parent) => parent.kind === "dialog"),
          "Comment editor must be independent of closed dialogs",
        );
      stack.push({ kind });
    }
  }
  assert.equal(stack.length, 0);
});

test("review shortcut history survives a new tab without repeating hints or revealing answers", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot)),
    storage = new Map();
  const transport = async () => ({
    ok: true,
    json: async () => ({
      messages: [{ role: "assistant", text: "Summary" }],
      available: true,
      busy: false,
    }),
  });
  const page = await browser(session, transport, storage);
  page.element("chat-next").handlers.click();
  await page.click("Submit first pass");
  page.element("chat-hint").handlers.click();
  await tick();
  page.element("chat-next").handlers.click();
  page.element("chat-card").handlers.click();
  const before = session.view();
  const reopened = await browser(session, transport, storage, new Map());
  const transcript = textOf(reopened.element("chat-transcript"));
  assert.match(transcript, /Give me a hint/);
  assert.match(transcript, /Deliberate errors: 1/);
  assert.match(transcript, /Show my review card/);
  assert.match(transcript, /Reveal clean code/);
  assert.equal(session.view().phase, "submitted");
  assert.equal(session.view().hintLevel, before.hintLevel);
  assert.equal(session.view().initialReference, undefined);
  assert.equal(reopened.find("Submit first pass").disabled, true);
  await reopened.click("Reveal clean code");
  await reopened.click("Confirm review card");
  const continued = await browser(session, transport, storage, new Map());
  assert.match(textOf(continued.element("chat-transcript")), /Review card confirmed/);
  assert.equal(continued.find("Export handoff").disabled, false);
  assert.equal(continued.find("Reveal clean code").disabled, true);
  const saved = JSON.parse(storage.get("minesweeper-review-history:token"));
  saved.readerId = "different-session";
  storage.set("minesweeper-review-history:token", JSON.stringify(saved));
  const other = await browser(session, transport, storage, new Map());
  assert.doesNotMatch(
    textOf(other.element("chat-transcript")),
    /Give me a hint|Review card confirmed/,
  );
});

test("Enter sends chat once; Shift+Enter and IME confirmation preserve the draft", async (t) => {
  const session = sessionFor(t),
    sent = [];
  const page = await browser(session, async (options) => {
    if (options) sent.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        messages: [{ role: "assistant", text: "Summary" }],
        busy: false,
        available: true,
      }),
    };
  });
  const composer = page.element("chat-message");
  composer.value = "A hypothesis";
  let prevented = 0;
  const key = (extra = {}) =>
    composer.handlers.keydown({
      key: "Enter",
      preventDefault() {
        prevented++;
      },
      ...extra,
    });
  key({ shiftKey: true });
  key({ isComposing: true });
  key({ keyCode: 229 });
  assert.equal(sent.length, 0);
  assert.equal(prevented, 0);
  assert.equal(composer.value, "A hypothesis");
  key();
  key({ repeat: true });
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message, "A hypothesis");
  assert.equal(composer.value, "");
  assert.ok(prevented > 0);
});

test("partial replies render while busy and scrolling history pauses following until returning to bottom", async (t) => {
  const session = sessionFor(t);
  let pending = { message: "Trace a branch", text: "First **fragment**" };
  const page = await browser(session, async () => ({
    ok: true,
    json: async () => ({
      messages: [{ role: "assistant", text: "Earlier history" }],
      pending,
      busy: true,
      available: true,
    }),
  }));
  const transcript = page.element("chat-transcript");
  transcript.scrollHeight = 1000;
  transcript.clientHeight = 300;
  transcript.scrollTop = 200;
  transcript.handlers.scroll();
  pending = { message: "Trace a branch", text: "First **fragment** and more" };
  await vm.runInContext("loadChat(false)", page.context);
  assert.match(textOf(transcript), /First fragment and more/);
  assert.equal(transcript.scrollTop, 200);
  assert.equal(page.element("chat-send").disabled, true);
  transcript.scrollTop = 700;
  transcript.handlers.scroll();
  transcript.scrollHeight = 1200;
  pending = { message: "Trace a branch", text: "An evolving reply" };
  await vm.runInContext("loadChat(false)", page.context);
  assert.equal(transcript.scrollTop, 1200);
});

test("mine counts stay hidden until reveal and overlapping comment ranges count one mine", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot));
  const annotations = [1, 2].map((line) => ({
    id: "range-" + line,
    anchor: { kind: "candidate", path: "allow.ts", line },
    constraint: "Check boundary",
    trigger: "Not yet established.",
    uncertainty: "",
  }));
  session.transition("submit", { prediction: "Unclear", annotations, noFindings: "" });
  const storage = new Map([
    [
      "minesweeper-comments:token",
      JSON.stringify({
        phase: "submitted",
        notes: annotations,
        ranges: [
          ["range-1", { first: 1, last: 3 }],
          ["range-2", { first: 2, last: 2 }],
        ],
      }),
    ],
  ]);
  let page = await browser(session, undefined, storage);
  page.element("chat-card").handlers.click();
  assert.match(textOf(page.element("chat-transcript")), /Mine count is hidden until reveal/);
  assert.equal(walk(page.element("code")).filter((n) => n.dataset.mine).length, 0);
  session.transition("reveal", {});
  page = await browser(session, undefined, storage);
  page.element("chat-card").handlers.click();
  assert.match(
    textOf(page.element("mine-summary")),
    /Total mines: 1.*Flagged by your comments: 1.*Reviewed with evidence: 0/,
  );
  assert.equal(walk(page.element("code")).filter((n) => n.dataset.mine).length, 1);
  assert.match(
    textOf(walk(page.element("code")).find((n) => n.dataset.mine)),
    /Mine · flagged · verification pending/,
  );
  assert.equal(
    walk(page.element("chat-transcript")).some(
      (n) => n.textContent === "Confirm mine region reviewed",
    ),
    false,
  );
  await page.click("Confirm review card");
  assert.equal(session.view().region.kind, "handoff");
  page = await browser(session, undefined, storage);
  assert.match(textOf(page.element("mine-summary")), /Reviewed with evidence: 0/);
});

test("file-level questions do not count as located mines and zero-mine sessions have no markers", async (t) => {
  const session = sessionFor(t, true),
    page = await browser(session);
  assert.match(textOf(page.element("mine-summary")), /Flagged by your comments: 0/);
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const control = new ReviewSession(snapshot, exercise(snapshot, false));
  control.transition("submit", { prediction: "Unclear", annotations: [], noFindings: "Unclear" });
  control.transition("reveal", {});
  const empty = await browser(control);
  assert.match(textOf(empty.element("mine-summary")), /Total mines: 0.*Reviewed with evidence: 0/);
  assert.equal(walk(empty.element("code")).filter((n) => n.dataset.mine).length, 0);
});

test("mine review derives from grounded author evidence and restores without another confirmation", async (t) => {
  const session = sessionFor(t),
    storage = new Map();
  const report =
    "For count=3, limit=3, tracing the clean >= branch returns false. Requirement: equality must be rejected.";
  const messages = [
    { role: "user", text: report },
    { role: "assistant", text: "Tests all pass." },
  ];
  const transport = async () => ({
    ok: true,
    json: async () => ({ messages, busy: false, available: true }),
  });
  let requests = 0;
  const evidence = () => {
    requests++;
    return {
      entries: [
        {
          path: "allow.ts",
          first: 2,
          last: 2,
          kind: "trace",
          sources: [{ id: "user:0", quote: report }],
          input: "count=3, limit=3",
          observed: "returns false",
          expected: "equality must be rejected",
          basis: "tracing the clean >= branch",
        },
      ],
    };
  };
  let page = await browser(session, transport, storage, new Map(), evidence);
  page.element("chat-card").handlers.click();
  await tick();
  await tick();
  assert.match(
    textOf(page.element("mine-summary")),
    /Reviewed with evidence: 1.*Pending verification: 0/,
  );
  assert.match(textOf(page.element("chat-transcript")), /count=3, limit=3/);
  await page.click("Confirm review card");
  assert.equal(session.view().region.kind, "explained");
  assert.match(session.view().region.note, /returns false/);
  page = await browser(session, transport, storage, new Map(), evidence);
  await tick();
  assert.match(textOf(page.element("mine-summary")), /Reviewed with evidence: 1/);
  assert.equal(requests, 1);
});

test("a short comment gets a labeled AI counterexample without becoming a verified clean-code issue", async (t) => {
  const session = sessionFor(t),
    storage = new Map(),
    transport = async () => ({
      ok: true,
      json: async () => ({ messages: [], busy: false, available: true }),
    });
  const comment = {
    id: "boundary",
    anchor: { kind: "candidate", path: "allow.ts", line: 2 },
    constraint: "Should reject equality",
    trigger: "Not yet established.",
    uncertainty: "",
  };
  session.transition("revise", { annotations: [comment] });
  let requests = 0;
  const counter = {
    path: "allow.ts",
    first: 2,
    last: 2,
    kind: "ai-counterexample",
    version: "review",
    sources: [{ id: "comment:boundary", quote: "Should reject equality" }],
    input: "count = 3, limit = 3",
    observed: "The displayed > comparison is false, so the function returns true.",
    expected: "The requirement rejects equality, so it should return false.",
    basis: "The public contract requires rejection at the limit.",
    steps: ["3 > 3 is false.", "The false rejection branch falls through to return true."],
    code: [{ line: 2, text: "  if (count > limit) return false;" }],
  };
  const evidence = () => {
    requests++;
    return { entries: [counter] };
  };
  let page = await browser(session, transport, storage, new Map(), evidence);
  page.element("chat-card").handlers.click();
  await tick();
  await tick();
  assert.match(textOf(page.element("chat-transcript")), /AI counterexample/);
  assert.match(textOf(page.element("chat-transcript")), /not executed/);
  assert.match(textOf(page.element("chat-transcript")), /count = 3, limit = 3/);
  await page.click("Confirm review card");
  assert.equal(session.view().assessments[0].kind, "question");
  assert.match(session.view().region.note, /AI code reasoning.*not executed/);
  assert.match(session.view().region.note, /count = 3/);
  page = await browser(session, transport, storage, new Map(), evidence);
  await tick();
  assert.match(textOf(page.element("chat-transcript")), /AI counterexample/);
  assert.equal(requests, 1);
});

test("a broad AI counterexample range does not resolve an uncited mine line", async (t) => {
  const session = sessionFor(t),
    comment = {
      id: "return",
      anchor: { kind: "candidate", path: "allow.ts", line: 3 },
      constraint: "Check this return.",
      trigger: "Not yet established.",
      uncertainty: "",
    };
  session.transition("revise", { annotations: [comment] });
  const page = await browser(
    session,
    async () => ({ ok: true, json: async () => ({ messages: [], busy: false, available: true }) }),
    new Map(),
    new Map(),
    () => ({
      entries: [
        {
          path: "allow.ts",
          first: 1,
          last: 4,
          kind: "ai-counterexample",
          version: "review",
          sources: [{ id: "comment:return", quote: "Check this return." }],
          input: "count = 3",
          observed: "A proposed return.",
          expected: "Check the contract.",
          basis: "Question remains.",
          steps: ["Inspect the return."],
          code: [{ line: 3, text: "  return true;" }],
        },
      ],
    }),
  );
  page.element("chat-card").handlers.click();
  await tick();
  await tick();
  assert.match(
    textOf(page.element("mine-summary")),
    /Reviewed with evidence: 0.*Pending verification: 1/,
  );
});

test("saving a comment automatically builds a prereveal counterexample card without disclosing mine metadata", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot)),
    storage = new Map();
  const transport = async () => ({
    ok: true,
    json: async () => ({
      messages: [{ role: "assistant", text: "Neutral summary." }],
      available: true,
      busy: false,
    }),
  });
  let requests = 0;
  const evidence = (options) => {
    requests++;
    const note = JSON.parse(options.body).annotations[0];
    return {
      entries: note
        ? [
            {
              path: "allow.ts",
              first: 2,
              last: 2,
              kind: "ai-counterexample",
              version: "review",
              sources: [{ id: "comment:" + note.id, quote: "Should reject equality" }],
              input: "count = 3, limit = 3",
              observed: "The displayed comparison falls through to true.",
              expected: "Equality should return false.",
              basis: "Equality must be rejected.",
              steps: ["3 > 3 is false.", "The rejection branch is skipped."],
              code: [{ line: 2, text: "  if (count > limit) return false;" }],
            },
          ]
        : [],
    };
  };
  let page = await browser(session, transport, storage, new Map(), evidence);
  page.element("anchor-kind").value = "candidate";
  page.element("anchor-path").value = "allow.ts";
  page.element("anchor-line").value = "2";
  page.element("constraint").value = "Should reject equality";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  await tick();
  assert.match(
    textOf(page.element("chat-transcript")),
    /AI counterexample · code reasoning, not executed/,
  );
  assert.match(textOf(page.element("chat-transcript")), /count = 3, limit = 3/);
  assert.doesNotMatch(
    textOf(page.element("chat-transcript")),
    /Total mines:|Flagged by your comments:|View mine|Released reference:/,
  );
  assert.equal(walk(page.element("code")).filter((n) => n.dataset.mine).length, 0);
  assert.equal(page.element("mine-summary").hidden, true);
  assert.equal(session.view().phase, "reading");
  assert.equal(session.view().mutationReference, undefined);
  page = await browser(session, transport, storage, new Map(), evidence);
  await tick();
  assert.match(textOf(page.element("chat-transcript")), /AI counterexample/);
  assert.equal(requests, 1);
  assert.match(textOf(page.element("chat-transcript")), /Unverified question/);
  page.element("chat-next").handlers.click();
  await page.click("Submit first pass");
  assert.equal(session.view().phase, "submitted");
  assert.equal(requests, 1);
});

test("removing a prereveal comment discards its in-flight counterexample", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot));
  let release,
    oldNote,
    requests = 0;
  const page = await browser(
    session,
    async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "assistant", text: "Neutral summary." }],
        available: true,
        busy: false,
      }),
    }),
    new Map(),
    new Map(),
    (options) => {
      requests++;
      const notes = JSON.parse(options.body).annotations;
      if (!notes.length) return { entries: [] };
      oldNote = notes[0];
      return new Promise((resolve) => (release = resolve));
    },
  );
  page.element("anchor-kind").value = "candidate";
  page.element("anchor-path").value = "allow.ts";
  page.element("anchor-line").value = "2";
  page.element("constraint").value = "Should reject equality";
  page.element("annotation-form").handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(requests, 1);
  walk(page.element("code"))
    .find((n) => n.textContent === "Remove")
    .handlers.click();
  await tick();
  release({
    entries: [
      {
        path: "allow.ts",
        first: 2,
        last: 2,
        kind: "ai-counterexample",
        version: "review",
        sources: [{ id: "comment:" + oldNote.id, quote: "Should reject equality" }],
        input: "count=3",
        observed: "true",
        expected: "false",
        basis: "Equality must be rejected.",
        steps: ["3 > 3 is false."],
        code: [{ line: 2, text: "  if (count > limit) return false;" }],
      },
    ],
  });
  await tick();
  await tick();
  assert.doesNotMatch(
    textOf(page.element("chat-transcript")),
    /AI counterexample · code reasoning/,
  );
  assert.equal(
    walk(page.element("code")).filter((n) => n.className?.includes("inline-comment")).length,
    0,
  );
  assert.equal(session.view().phase, "reading");
  assert.equal(page.element("mine-summary").hidden, true);
});
