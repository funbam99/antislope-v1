import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMetadata, validateMetadataExport } from "../src/minesweeper/metadata.ts";
const participant = "00000000-0000-4000-8000-000000000001";
const record = (overrides = {}) => ({
  sessionId: "a".repeat(32),
  revision: 1,
  startedOn: "2026-10-12",
  updatedOn: "2026-10-12",
  phase: "reading",
  freshness: "current",
  stages: {
    firstPassSubmitted: false,
    revealed: false,
    assessed: false,
    followupSubmitted: false,
    completed: false,
  },
  outcomes: {
    comments: 0,
    authorReportedRealIssues: 0,
    evidenceBackedRealIssues: 0,
    testHandoffs: 0,
    unresolvedQuestions: 0,
  },
  usefulness: null,
  ...overrides,
});
const file = (records, id = participant) => ({ schemaVersion: 1, participantId: id, records });
test("metadata aggregation deduplicates exports by session and uses the latest revision", () => {
  const first = record(),
    last = record({
      revision: 2,
      phase: "completed",
      stages: {
        firstPassSubmitted: true,
        revealed: true,
        assessed: true,
        followupSubmitted: true,
        completed: true,
      },
      outcomes: {
        comments: 2,
        authorReportedRealIssues: 1,
        evidenceBackedRealIssues: 1,
        testHandoffs: 1,
        unresolvedQuestions: 1,
      },
      usefulness: "useful",
    });
  const summary = summarizeMetadata([
    file([first]),
    file([last]),
    file([last]),
    file([record({ sessionId: "b".repeat(32) })], "00000000-0000-4000-8000-000000000002"),
  ]);
  assert.equal(summary.participants, 2);
  assert.equal(summary.reviews, 2);
  assert.equal(summary.completedReviews, 1);
  assert.equal(summary.authorReportedRealIssues, 1);
  assert.equal(summary.evidenceBackedRealIssues, 1);
  assert.equal(summary.unresolvedQuestions, 1);
  assert.equal(summary.usefulReviews, 1);
  assert.ok(!JSON.stringify(summary).includes(participant));
});
test("metadata rejects private fields, invalid outcomes and contradictory lifecycle records", () => {
  for (const bad of [
    file([record({ mutationReference: "secret" })]),
    { ...file([]), code: "private source" },
    file([
      record({
        outcomes: {
          comments: 1,
          authorReportedRealIssues: 2,
          evidenceBackedRealIssues: 0,
          testHandoffs: 0,
          unresolvedQuestions: 0,
        },
      }),
    ]),
    file([record({ phase: "completed" })]),
    file([record({ updatedOn: "2026-99-99" })]),
  ])
    assert.throws(() => validateMetadataExport(bad));
  assert.throws(() =>
    summarizeMetadata([file([record()]), file([record({ usefulness: "useful" })])]),
  );
});
