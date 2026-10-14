import test from "node:test";
import { request } from "node:http";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, exercise, candidate } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { ReviewSession } from "../src/minesweeper/session.ts";
import { startServer } from "../src/minesweeper/server.ts";
async function setup(t, preview = false) {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]);
  const session = new ReviewSession(snapshot, exercise(snapshot), f.repo, preview);
  const server = await startServer(session);
  t.after(() => server.close());
  const url = server.url;
  const origin = new URL(url).origin;
  const token = new URL(url).pathname.split("/")[1];
  const post = (path, data, headers = {}) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Minesweeper-Session": token,
        ...headers,
      },
      body: JSON.stringify(data),
    });
  return { ...f, url, origin, token, post };
}
test("capability, origin and transition checks hide private answers over real HTTP", async (t) => {
  const f = await setup(t);
  const state = await fetch(f.url + "state");
  const value = await state.text();
  assert.equal(state.status, 200);
  assert.match(state.headers.get("cache-control"), /no-store/);
  assert.match(state.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  for (const secret of ["count >= limit", "Independent truth table", "Equality must be rejected."])
    assert.equal(value.includes(secret), false);
  assert.equal((await fetch(f.origin + "/wrong/state")).status, 404);
  assert.equal((await f.post("action/reveal", {})).status, 409);
  assert.equal(
    (await f.post("action/submit", {}, { Origin: "https://example.invalid" })).status,
    403,
  );
  assert.equal(
    (await f.post("action/submit", {}, { "X-Minesweeper-Session": "wrong" })).status,
    403,
  );
  const hostileHost = await new Promise((resolve) => {
    request(f.url + "state", { headers: { Host: "example.invalid" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).end();
  });
  assert.equal(hostileHost, 403);
  assert.equal(
    (
      await f.post("action/submit", {
        prediction: "false",
        annotations: [],
        noFindings: "No issue identified.",
      })
    ).status,
    200,
  );
  assert.equal((await f.post("action/reveal", {})).status, 200);
  assert.match(await (await fetch(f.url + "state")).text(), /Independent truth table/);
});
test("oversized and malformed requests fail generically; session operations never write target files", async (t) => {
  const f = await setup(t);
  const index = readFileSync(join(f.repo, ".git/index"));
  const config = readFileSync(join(f.repo, ".git/config"));
  const response = await f.post("action/submit", { prediction: "x".repeat(1024 * 1024 + 1) });
  assert.equal(response.status, 413);
  const invalid = await fetch(f.url + "action/submit", {
    method: "POST",
    headers: {
      Origin: f.origin,
      "X-Minesweeper-Session": f.token,
      "Content-Type": "application/json",
    },
    body: '{"secret":"never leak this"',
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.text()).includes("never leak"), false);
  await f.post("action/submit", {
    prediction: "true",
    annotations: [],
    noFindings: "Nothing independently identified.",
  });
  await f.post("action/reveal", {});
  await f.post("action/assess", {
    assessments: [],
    region: { kind: "reread", note: "Read equality again." },
    referenceDispute: "",
  });
  await f.post("action/followup", { prediction: "true", dispute: "" });
  const card = await f.post("export", {});
  assert.equal(card.status, 200);
  assert.match(card.headers.get("content-disposition"), /attachment/);
  assert.equal((await f.post("export", {})).status, 200);
  assert.equal(readFileSync(join(f.repo, "allow.ts"), "utf8"), candidate);
  assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
  assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
});
test("curator preview cannot reach state-changing routes", async (t) => {
  const f = await setup(t, true);
  assert.equal((await fetch(f.url + "state")).status, 200);
  assert.equal((await f.post("action/submit", {})).status, 409);
  assert.equal((await f.post("export", {})).status, 409);
});

test("reader serves runnable external assets and full-file context without injecting exercise text into HTML", async (t) => {
  const f = await setup(t);
  const page = await fetch(f.url);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /src="app.js"/);
  assert.match(html, /href="app.css"/);
  assert.equal(html.includes("Independent truth table"), false);
  const js = await fetch(f.url + "app.js");
  assert.equal(js.status, 200);
  const css = await fetch(f.url + "app.css");
  assert.equal(css.status, 200);
  assert.match(js.headers.get("content-type"), /javascript/);
  const view = await (await fetch(f.url + "state")).json();
  assert.deepEqual(view.files[0].baseline, [
    "export function allow(count: number, limit: number): boolean {",
    "  return count < limit;",
    "}",
  ]);
  assert.equal(view.files[0].candidate[1], "  if (count > limit) return false;");
});
