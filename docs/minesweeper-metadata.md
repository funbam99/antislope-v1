# Local review metadata

Open **Review settings → Usage & outcomes**, or choose it from **Review card**, to see your local history and outcomes. Records are stored in browser local storage. No data is uploaded. Export metadata JSON only when you choose to share it.

## What the records mean

Each session has one latest record, identified by its opaque reader ID. State changes replace that record with a newer revision. Refreshes, opening dialogs, hints, and repeated exports do not create additional reviews. Curator previews are excluded.

| Field                               | Meaning                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `participantId`                     | Random anonymous UUID, shared across records in this export                                                                                                  |
| `sessionId`                         | Opaque reader ID; contains no repository or exercise identity                                                                                                |
| `revision`                          | Version of this session's metadata, used to deduplicate exports                                                                                              |
| `startedOn`, `updatedOn`            | UTC calendar dates, without times or elapsed durations                                                                                                       |
| `phase`, `freshness`                | Review stage and whether captured content is current, historical, or unknown                                                                                 |
| `stages`                            | First pass, reveal, card assessment, follow-up context, and handoff completion flags; follow-up records context confirmation, not a separately answered quiz |
| `outcomes.comments`                 | Saved review items: comments and, when present, a bounded author-discussion entry, including unassessed observations                                         |
| `outcomes.authorReportedRealIssues` | Findings classified as real by the author                                                                                                                    |
| `outcomes.evidenceBackedRealIssues` | Those real findings with recorded evidence text                                                                                                              |
| `outcomes.testHandoffs`             | Real findings assigned a test or verification handoff                                                                                                        |
| `outcomes.unresolvedQuestions`      | Unresolved-question findings, or real findings handed over as questions                                                                                      |
| `usefulness`                        | Optional user feedback: useful, uncertain, not useful, or unanswered                                                                                         |

Evidence is author-reported, not independently executed or verified by this tool. A test handoff is a proposed next action, not proof that a test was run or a fix succeeded. Unassessed observations are not counted as real issues. These outcomes describe the review's recorded outputs; they do not prove a causal improvement, complete review, or personal ability. There are no scores, individual rankings, deliberate-error hit rates, or performance ratings.

Records exclude source and file paths, repository hashes, requirements, predictions, comment text, chat, reference answers, mutation data, seeds, hint usage, and exercise-region outcomes. No click trails or dwell times are retained. Clearing browser storage removes the local records. An unreadable existing store is left untouched; storage failures are shown and the in-memory records remain manually exportable.

## Consistent anonymous participants

The browser stores history for the current local address. A different port, browser, or device has a separate store and initially generates a different ID. Copy the participant ID to **Anonymous participant ID** in another session and save it to reuse the same identity across its local history. Export each separate history.

Use an anonymous UUID, not an email address or employee name. The ID setting applies to the entire local history, so use a separate browser profile for different participants. Do not change IDs between exports from the same history: this would cause the same reviews to be counted under separate identities.

Unique IDs represent participants, not verified employee headcount. An internal pilot needs a consistent process for assigning/reusing IDs to obtain a reliable unique-participant total.

## Internal aggregation

Collect exports through your chosen internal process, with participants explicitly choosing to share them. The tool does not send files or summaries automatically.

```sh
npm run build
npm run metadata:summary -- participant-a.json participant-b.json
```

The command reads local JSON files and prints aggregate JSON. It counts unique participant IDs, reviews at each stage, recorded issue/question/test-handoff outcomes, and usefulness responses. Repeated exports are deduplicated by participant ID and session ID, using the latest revision. Conflicting records with the same revision are rejected instead of guessed. Aggregate output contains no participant or session IDs.

Do not interpret unfinished reviews as ineffective, zero findings as poor attention, or the sum of findings as unique bugs across the company. Different reviews can identify the same issue. Completion and usefulness feedback are descriptive pilot measures, with no control group or causal estimate. Inspect the author handoff separately when validating real problems and follow-up work; it is not part of the aggregate export.

Stopping the local server still ends its review session. Metadata remains in the browser for later viewing/export when a reader runs at that address, but it does not restore the private exercise or chat history.
