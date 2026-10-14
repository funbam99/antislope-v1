# Curated Minesweeper exercises

This describes the manual preparation path for an author and a separate human curator. The curator's review and preparation effort is part of the experiment's cost. The alternative [skill workflow](./minesweeper-skills.md) uses independent, experimental Codex generation; it does not replace human verification of references.

## Try an example

From the Anti-Slope checkout:

```sh
npm run build
node examples/minesweeper/create-example.mjs
```

The setup prints four paths. It creates a separate temporary Git repository with clean TypeScript code, a source-containing snapshot, and a private exercise outside that repository. It does not plant a bug in any repository file. Use those printed paths:

```sh
npm start -- minesweeper review --repo /path/to/repo --exercise /path/to/exercise.json
```

Author review prints a private loopback URL; open it in a browser. Curators may separately use `npm start -- minesweeper validate --snapshot /path/to/snapshot.json --exercise /path/to/exercise.json --preview` to inspect preparation. Author readers should not open that preview or the private exercise JSON. Ctrl-C discards the temporary curator preview but preserves author review checkpoints. Resume author review with `npm start -- minesweeper resume --session <id>`, using the ID printed at startup. `--control` on the example setup prepares zero injection. The setup checks projected text with the existing development formatter; review and validation never run formatters or target code. The tiny example demonstrates the flow, rather than providing a blinded research trial.

## Prepare a real exercise

1. The author selects a small TypeScript change and necessary unchanged supporting files, then freezes their contents during preparation.
2. Export a private snapshot outside the target repository. This command emits actual baseline and clean candidate source, exact hashes, diff rows, modes, and version metadata:

   ```sh
   npm --silent start -- minesweeper snapshot --repo /path/to/repo --base main --file src/changed.ts --file src/helper.ts > /outside/repo/snapshot.json
   ```

   Use `--silent` when redirecting npm output so npm's script banner does not enter the JSON file; invoking `node dist/cli.js minesweeper snapshot ...` directly also emits only JSON.

3. Share the snapshot and requirements with the curator through a manually chosen channel. The application sends nothing automatically. Keep repository secrets out of the selected material.
4. The curator authors JSON following the example's schema, verifies correctness against requirements, records evidence, and runs `validate --preview`. Inspect diff and full-file views for accidental cues.
5. Deliver the private exercise outside the target repository. The author runs `review`. A preparation-time content mismatch needs a newly verified exercise. Author startup failures deliberately omit paths, lines, and source: contact the curator for detailed diagnosis.

`--base` names a comparison ref. Preparation fixes its unique merge-base with HEAD, not its potentially newer branch tip. A commit with unchanged selected content does not invalidate an exercise. Relative JSON paths resolve against the CLI working directory. V1 accepts 1–12 tracked, regular UTF-8 `.ts` files, each at most 128 KiB and 2000 lines. At least one must differ from baseline. Added/deleted/renamed files, symlinks, non-text content, and changes to index file mode are unsupported. Unselected changes remain outside the captured review.

## Exercise fields

The schema uses `schemaVersion: 1`; unknown fields are rejected. The runnable example is the complete authoring template.

| Field                                                   | Meaning                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshotId`, `baseline`, `comparison`, `head`, `files` | Copy snapshot metadata and each selected path's `baselineHash` and `candidateHash`. `head` is preparation information.                                                     |
| `title`, `requirements`, `intent`                       | Explicit requirements and a neutral account of the path's purpose. Avoid claims such as “all boundaries are handled.”                                                      |
| `initial`                                               | `prompt`, actual `displayed` behavior, actual `clean` behavior, `intended` requirement behavior, and `explanation` of differences. The scenario may traverse the mutation. |
| `followup`                                              | A previously unseen `prompt`, actual clean-code `answer`, and requirement-based `explanation`.                                                                             |
| `mutation`                                              | `null`, or one descriptor: `path`, `line`, `clean`, `replacement`, `category`, `trigger`, `expected`, `explanation`, `evidence`.                                           |
| `clue`                                                  | A narrower hint for a mutation; `null` in a zero-injection control. Count and category hints are derived server-side.                                                      |

A replacement must change one added candidate line, preserve line count, match the captured clean line, contain no newline, and differ from its paired baseline row. It must be a verified semantic error with a concrete trigger and correctness grounds. A difference from clean code alone is not evidence of an error. The original clean output may itself be wrong.

Check the whole projected file against the project's formatter in a separate preparation environment outside the target workspace; record the command/configuration and result. Without a formatter, record manual syntax and style review. Do not run untrusted project scripts to format or verify it. `validate` checks structural contracts and evidence presence, not TypeScript semantics, formatter results, or truth of reference answers.

Tiny diffs often offer few natural mutation sites. Do not enlarge the change, add arbitrary mutations to unchanged lines, or enforce a minimum line count. Choose a zero-injection control or another change if preview makes the mutation obvious. In zero/one exercises, the count hint reveals the control condition after the first pass; later hinted responses are no longer blinded observations.

## Read, assess, and hand over

The main UI has two columns: code/comments and AI discussion. Requirements are available in the header menu; first-pass submission, hints, explicit reveal, review cards and export are integrated into the right-hand conversation. In-page AI uses only displayed code, requirements, reader comments explicitly sent with a message, and its own session conversation. It opens with a neutral summary and does not receive curator references. Chat is disabled in curator preview. Author review chat requires the supported, authenticated Codex CLI; otherwise it reports unavailability and preserves the message draft.

The reader shows three context lines per diff hunk and can expand every selected candidate or baseline file. Before reveal, both candidate views contain the same virtual replacement. The server holds the clean counterpart and answers until their disclosure stages.

Clean-content hashes and deterministic snapshot identifiers are also withheld until reveal so they cannot serve as a comparison oracle. The initial reader uses a random opaque ID. The reader normalizes line endings for display, so newline-only changes have no visible text hunk; exported source and hashes retain the exact bytes.

Select displayed code or click a line number to open a nearby comment editor. A multi-line selection retains its full range and attaches to its first line. Write a comment without additional trigger or uncertainty fields. Saving it automatically requests a counterexample and updates the inline review card, including before reveal. AI reasoning is labeled unexecuted and may remain a question. Closing preserves the unsent draft in the active page; Discard clears it.

Annotations can refer to any selected candidate line, a deleted baseline line, a selected file, or the whole change. Use a change-level question for unselected dependencies and record independent evidence before calling that a verified issue. First-pass submission preserves existing comments and the visible discussion without requiring a separate prediction or no-findings explanation. No comments or sent messages is also a valid first pass. A local snapshot retains the full discussion and selected ranges; the session keeps a bounded author-message excerpt. AI replies are not automatically treated as findings. AI discussion using the [filtered discussion view](./minesweeper-skills.md#collaborative-analysis) is allowed before reveal. Optional hints unlock after submission, and reveal is explicit. Both operate through the right-hand chat. Hint responses and released references are separate runtime messages, excluded from AI context. The inline review card organizes comments, author discussion and AI counterexamples before reveal, without mine metadata or reference answers. After reveal, it also supports assessment and follow-up context without duplicate text fields. New items remain questions; an author can confirm a real issue using recorded post-reveal evidence. Confirming the card saves dispositions and the existing follow-up discussion context, then enables export. No separate scenario answer is inferred, and updated comments/chat invalidate export approval until reconfirmed.

At reveal, assess findings against captured clean code, not the exercise replacement. Preserve questions, false positives, and disputes. A verified real issue requires evidence and a next action: hand over for fix, test/verification, a question, or decline with reason. Review the clean-code follow-up context, confirm the card, then download the Markdown handoff. Fixes and new tests normally follow export through the ordinary clean-code workflow.

Workspace changes during a session preserve annotations and transition it to historical review. It continues against the captured version, and exports require rechecking current code. Reports of repairs already made are unverified notes, never verified fixes. Missing a deliberate error is not a failure or a measure of ability.

The handoff contains captured-version real findings, evidence, dispositions, and questions. It excludes private hints, reference answers, and exercise outcomes. Sharing it is the author's decision. No scores, personal trends, behavioral logs, code execution, or automatic external posts are provided. Saved comments, selection ranges and workflow messages remain in browser local storage; unsent drafts survive only in the active page. Closing the author server preserves its private checkpoint, including successful chat and review progress. Resume retains the original URL so browser-local history reconnects. Download retry remains available after completion.
