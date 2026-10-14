import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fixture, exercise } from "./helpers.mjs";
import { captureSnapshot } from "../src/minesweeper/snapshot.ts";
import { ReviewSession } from "../src/minesweeper/session.ts";
import { ReviewChat } from "../src/minesweeper/chat.ts";
test("visible reply arrives before completion; internal events and failed partials never enter history", async (t) => {
  const f = fixture(t),
    snapshot = captureSnapshot(f.repo, f.base, ["allow.ts"]),
    session = new ReviewSession(snapshot, exercise(snapshot));
  const worker = join(f.root, "stream-worker.mjs"),
    release = join(f.root, "release");
  writeFileSync(
    worker,
    `#!${process.execPath}\nimport fs from 'node:fs';import readline from 'node:readline';const send=x=>console.log(JSON.stringify(x));readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')send({id:r.id,result:{}});if(r.method==='thread/start')send({id:r.id,result:{thread:{id:'t'}}});if(r.method==='turn/start'){send({id:r.id,result:{turn:{id:'u'}}});send({method:'item/reasoning/textDelta',params:{threadId:'t',delta:'PRIVATE REASONING'}});send({method:'item/started',params:{threadId:'t',item:{type:'agentMessage',id:'a',phase:'final_answer',text:''}}});send({method:'item/agentMessage/delta',params:{threadId:'t',itemId:'a',delta:'First visible fragment'}});const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);send({method:'item/agentMessage/delta',params:{threadId:'t',itemId:'a',delta:' and completion'}});send({method:'item/completed',params:{threadId:'t',item:{type:'agentMessage',id:'a',phase:'final_answer',text:'First visible fragment and completion'}}});send({method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});}},10);}});`,
    { mode: 0o700 },
  );
  const chat = new ReviewChat(() => session.discussionView(), { executable: worker });
  t.after(() => chat.close());
  const turn = chat.turn({});
  let partial;
  for (let n = 0; n < 100; n++) {
    partial = chat.view();
    if (partial.pending?.text) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(partial.busy, true);
  assert.equal(partial.pending.text, "First visible fragment");
  assert.equal(partial.messages.length, 0);
  assert.doesNotMatch(JSON.stringify(partial), /PRIVATE REASONING/);
  assert.equal(chat.checkpoint().messages.length, 0);
  writeFileSync(release, "ok");
  const final = await turn;
  assert.equal(final.messages[0].text, "First visible fragment and completion");
  assert.equal(final.pending, undefined);
});
