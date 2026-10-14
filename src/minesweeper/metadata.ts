export interface ReviewMetadataRecord {
  sessionId: string;
  revision: number;
  startedOn: string;
  updatedOn: string;
  phase: "reading" | "submitted" | "revealed" | "completed";
  freshness: "current" | "historical" | "unknown";
  stages: {
    firstPassSubmitted: boolean;
    revealed: boolean;
    assessed: boolean;
    followupSubmitted: boolean;
    completed: boolean;
  };
  outcomes: {
    comments: number;
    authorReportedRealIssues: number;
    evidenceBackedRealIssues: number;
    testHandoffs: number;
    unresolvedQuestions: number;
  };
  usefulness: "useful" | "uncertain" | "not-useful" | null;
}
export interface ReviewMetadataExport {
  schemaVersion: 1;
  participantId: string;
  records: ReviewMetadataRecord[];
}
function metadataObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid review metadata");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(data, key))
  )
    throw new Error("Invalid review metadata fields");
  return data;
}
export function validateMetadataRecord(value: unknown): ReviewMetadataRecord {
  const data = metadataObject(value, [
    "sessionId",
    "revision",
    "startedOn",
    "updatedOn",
    "phase",
    "freshness",
    "stages",
    "outcomes",
    "usefulness",
  ]);
  if (
    typeof data.sessionId !== "string" ||
    !/^[a-f0-9]{32}$/.test(data.sessionId) ||
    !Number.isSafeInteger(data.revision) ||
    (data.revision as number) < 1
  )
    throw new Error("Invalid review metadata identity");
  for (const key of ["startedOn", "updatedOn"]) {
    const day = data[key];
    if (
      typeof day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day
    )
      throw new Error("Invalid review metadata date");
  }
  if (
    (data.startedOn as string) > (data.updatedOn as string) ||
    !["reading", "submitted", "revealed", "completed"].includes(data.phase as string) ||
    !["current", "historical", "unknown"].includes(data.freshness as string) ||
    ![null, "useful", "uncertain", "not-useful"].includes(data.usefulness as null | string)
  )
    throw new Error("Invalid review metadata state");
  const stages = metadataObject(data.stages, [
    "firstPassSubmitted",
    "revealed",
    "assessed",
    "followupSubmitted",
    "completed",
  ]);
  if (
    Object.values(stages).some((value) => typeof value !== "boolean") ||
    stages.firstPassSubmitted !== (data.phase !== "reading") ||
    stages.revealed !== (data.phase === "revealed" || data.phase === "completed") ||
    stages.completed !== (data.phase === "completed") ||
    ((stages.assessed || stages.followupSubmitted) && !stages.revealed) ||
    (stages.completed && (!stages.assessed || !stages.followupSubmitted))
  )
    throw new Error("Invalid review metadata stages");
  const outcomes = metadataObject(data.outcomes, [
    "comments",
    "authorReportedRealIssues",
    "evidenceBackedRealIssues",
    "testHandoffs",
    "unresolvedQuestions",
  ]);
  if (
    Object.values(outcomes).some(
      (value) => !Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 50,
    ) ||
    (outcomes.authorReportedRealIssues as number) > (outcomes.comments as number) ||
    (outcomes.evidenceBackedRealIssues as number) > (outcomes.authorReportedRealIssues as number) ||
    (outcomes.testHandoffs as number) > (outcomes.comments as number) ||
    (outcomes.unresolvedQuestions as number) > (outcomes.comments as number) ||
    (!stages.assessed &&
      Object.entries(outcomes).some(([key, value]) => key !== "comments" && value !== 0))
  )
    throw new Error("Invalid review metadata outcomes");
  return {
    sessionId: data.sessionId,
    revision: data.revision as number,
    startedOn: data.startedOn as string,
    updatedOn: data.updatedOn as string,
    phase: data.phase as ReviewMetadataRecord["phase"],
    freshness: data.freshness as ReviewMetadataRecord["freshness"],
    stages: {
      firstPassSubmitted: stages.firstPassSubmitted as boolean,
      revealed: stages.revealed as boolean,
      assessed: stages.assessed as boolean,
      followupSubmitted: stages.followupSubmitted as boolean,
      completed: stages.completed as boolean,
    },
    outcomes: {
      comments: outcomes.comments as number,
      authorReportedRealIssues: outcomes.authorReportedRealIssues as number,
      evidenceBackedRealIssues: outcomes.evidenceBackedRealIssues as number,
      testHandoffs: outcomes.testHandoffs as number,
      unresolvedQuestions: outcomes.unresolvedQuestions as number,
    },
    usefulness: data.usefulness as ReviewMetadataRecord["usefulness"],
  };
}
export function validateMetadataExport(value: unknown): ReviewMetadataExport {
  const data = metadataObject(value, ["schemaVersion", "participantId", "records"]);
  if (
    data.schemaVersion !== 1 ||
    typeof data.participantId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.participantId) ||
    !Array.isArray(data.records) ||
    data.records.length > 10000
  )
    throw new Error("Invalid review metadata export");
  const records = data.records.map((value) => validateMetadataRecord(value));
  if (new Set(records.map((record) => record.sessionId)).size !== records.length)
    throw new Error("Duplicate review metadata session");
  return { schemaVersion: 1, participantId: data.participantId.toLowerCase(), records };
}
export function summarizeMetadata(exports: unknown[]) {
  const latest = new Map<string, { participantId: string; record: ReviewMetadataRecord }>();
  for (const input of exports) {
    const data = validateMetadataExport(input);
    for (const record of data.records) {
      const key = data.participantId + ":" + record.sessionId,
        old = latest.get(key);
      if (
        old &&
        old.record.revision === record.revision &&
        JSON.stringify(old.record) !== JSON.stringify(record)
      )
        throw new Error("Conflicting review metadata revisions");
      if (!old || record.revision > old.record.revision)
        latest.set(key, { participantId: data.participantId, record });
    }
  }
  const records = [...latest.values()].map((entry) => entry.record);
  return {
    schemaVersion: 1,
    participants: new Set([...latest.values()].map((entry) => entry.participantId)).size,
    reviews: records.length,
    submittedReviews: records.filter((record) => record.stages.firstPassSubmitted).length,
    revealedReviews: records.filter((record) => record.stages.revealed).length,
    assessedReviews: records.filter((record) => record.stages.assessed).length,
    completedReviews: records.filter((record) => record.stages.completed).length,
    authorReportedRealIssues: records.reduce(
      (total, record) => total + record.outcomes.authorReportedRealIssues,
      0,
    ),
    evidenceBackedRealIssues: records.reduce(
      (total, record) => total + record.outcomes.evidenceBackedRealIssues,
      0,
    ),
    testHandoffs: records.reduce((total, record) => total + record.outcomes.testHandoffs, 0),
    unresolvedQuestions: records.reduce(
      (total, record) => total + record.outcomes.unresolvedQuestions,
      0,
    ),
    feedbackResponses: records.filter((record) => record.usefulness !== null).length,
    usefulReviews: records.filter((record) => record.usefulness === "useful").length,
    uncertainReviews: records.filter((record) => record.usefulness === "uncertain").length,
    notUsefulReviews: records.filter((record) => record.usefulness === "not-useful").length,
  };
}
// Share the same whitelist and aggregation logic with the DOM-only client.
export const metadataBrowser = [
  metadataObject,
  validateMetadataRecord,
  validateMetadataExport,
  summarizeMetadata,
]
  .map((fn) => fn.toString())
  .join("\n");
