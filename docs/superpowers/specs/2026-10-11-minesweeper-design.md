# Minesweeper: curated author self-review prototype

Status: historical design specification from October 11, 2026. Later product decisions and the implemented v0.1.0 workflow are documented in [README.md](../../../README.md), [exercise preparation](../../minesweeper-exercises.md), and [skill integration](../../minesweeper-skills.md). Scope and status statements below describe the original proposal.

## Purpose and success criteria

Minesweeper is Anti-Slope's first product. It helps an author voluntarily review a small AI-generated TypeScript change before asking another person to review it. A deliberate error provides a reason to inspect the change; useful outputs are verified problems in the clean code, test evidence, and questions for the next reviewer.

The first release is a research prototype with a separate human curator and author. It supports a manually curated exercise, a local diff reader, a behavior prediction, annotations, staged disclosure, finding dispositions, and an explicit local handoff export. Success means an author can finish this flow on a small real change prepared by another person, while the tool leaves the target workspace untouched, keeps reference answers private until their reveal stage, and avoids representing exercise results as proof that the code is safe. This does not yet establish a scalable, independently initiated author self-review workflow; curator effort and preparation delays are part of what the prototype must evaluate.

Zero injected errors is a supported control condition. A session contains at most one injected error. Automatic exercise generation, a coding-tool skill, execution of target code, external posting, repeated exercise rounds, post-fix reassessment, and performance scoring are outside this release.

## Chosen approach

Use the existing Node.js 22, npm, and TypeScript ESM scaffold. Implement the server with Node's HTTP and crypto modules, use Git through argument-array subprocess calls, and render the page with HTML, CSS, and browser JavaScript. No application framework or new runtime dependency is required.

A static HTML exercise was considered and rejected because embedding the complete exercise would expose private reference material before reveal. A coding-tool integration was also considered; it can later wrap the curated exercise contract, after the core experience has been tested.

The local server holds the clean snapshot, mutation descriptor, and reference answers in memory. Browser responses use explicit projections for each allowed stage. Rendering substituted text is necessary to show the exercise; revealing which line was substituted, its clean counterpart, the mutation patch, or its explanation is prohibited until reveal.

Keep clean candidate hashes and deterministic snapshot/exercise digests private until reveal too: comparing them with displayed-source hashes would identify a substitution or control condition. Before reveal, identify the reader with an independently random opaque session ID. Internal version binding remains exact, and revealed data and handoffs include the captured content identifiers. Keep the exercise digest private until follow-up submission as well, because it incorporates that still-hidden reference answer.

V1 deliberately uses virtual injection only. It creates no executable fork or worktree containing substituted code and provides no IDE navigation or target-code execution. A disposable isolated fork that supports code navigation and execution is the next possible product step, requiring a separate design for filesystem containment, teardown, credentials, network access, and an environment with no ability to push to a remote. It is not part of this implementation, and the existing AGENTS safety boundaries remain unchanged.

## Review scope and version binding

An author selects one or more existing, tracked, regular `.ts` files and a Git comparison ref. The initial release supports text modifications to those files. Additions, deletions, renames, symlinks, submodules, binary files, and untracked selected paths fail with a clear unsupported-scope message. Unselected changes are outside the review and are explicitly named as excluded in the session and handoff. The `.ts` restriction deliberately bounds the pilot to one language; the runtime does not parse TypeScript or perform semantic analysis.

At least one selected file must have a text change. Also allow unchanged tracked `.ts` files to be selected as supporting context; capture and hash them using the same rules. This lets an author inspect an unchanged caller or helper without pretending it is part of the diff. The full-file reader and annotation anchors are limited to these selected snapshots. References to unselected code can be recorded in a change-level question, but that code is not captured or represented as verified by this review.

Resolve `--base <ref>` to a commit and compute its merge-base with HEAD during snapshot preparation. This merge-base commit is the immutable diff baseline; the flag names the comparison ref rather than requesting a direct diff against its tip. Fail if there is no common ancestor or more than one merge-base, instead of choosing ambiguously. Store the resolved comparison commit and merge-base in the snapshot. Later movement of a branch name never changes an exercise's baseline. This avoids showing other people's newer branch changes as reverse edits.

Capture baseline file contents and the selected files' current working-tree contents, including staged and unstaged edits. The latter is the clean candidate. Never write either a mutation or a repair to those files. Display the candidate against the baseline, rather than the candidate against its exercise mutation.

Bind the session to the baseline commit, selected paths, SHA-256 hashes of their exact candidate bytes, and a digest of the validated exercise definition, including requirements. Record HEAD as preparation metadata, not as a freshness condition: committing unchanged selected content does not invalidate an exercise. Line anchors explicitly identify either the captured clean candidate or a deleted baseline row; file and change anchors identify their corresponding captured scope.

At review startup, require the selected file bytes to match the exercise hashes. Once the session has captured and validated its immutable snapshot, subsequent edits or missing selected files switch it to historical review. Before first-pass submission, hint disclosure, reveal, follow-up submission, and export, compare selected working-tree contents with the captured hashes. Retain all annotations and answers, and allow the existing flow to finish against the captured snapshot. Do not read edited code into the exercise or silently reanchor annotations.

The opening page recommends recording issues and completing the handoff before editing. If code changes anyway, show a persistent banner identifying the historical snapshot and explaining that findings refer to that version. Keep historical mode once a divergence is observed; do not reload the page or discard unsent annotation drafts to show the warning. Freshness checks use the original path-safety rules, so a replacement symlink is not followed. An unreadable repository is also treated as freshness unknown, rather than as current. Export identifies this state and includes a question to recheck findings against current code. Edits outside the explicit scope do not silently expand it, and the captured requirements remain authoritative only for this exercise.

## CLI and exercise preparation

Preserve `--help` and the read-only `doctor` command. Add these commands under `minesweeper`:

```text
minesweeper snapshot --repo <directory> --base <ref> --file <path> [--file <path> ...]
minesweeper validate --snapshot <snapshot-json-path> --exercise <json-path> [--preview]
minesweeper review --repo <directory> --exercise <json-path>
```

`snapshot` performs read-only inspection and prints a versioned JSON package containing the resolved comparison commit, merge-base baseline, informational HEAD, selected paths and file modes, exact baseline and clean candidate source contents, their hashes, baseline-to-candidate diff rows with line mappings, and excluded paths. Include unchanged selected context files as well. Compute a snapshot digest over the schema version, fixed baseline commit, and selected paths, modes, source bytes, and hashes; informational HEAD, comparison-ref labels, and excluded-path listings are not identity fields. Source bytes and line-ending information must survive serialization and hash checks. Author startup reconstructs these identity fields against the stored baseline, without recalculating merge-base using a newer HEAD. The output contains actual code and is private preparation material, not a reader payload or a mutation. The author can redirect it to a file outside the target repository and manually provide it to the curator. Requirements and business context are supplied separately. The command does not choose mutations or certify correctness.

`validate` is explicitly a curator command. It takes the exported snapshot and exercise, validates their schemas and hashes, recomputes diff rows from the captured source rather than trusting supplied rows, and performs all exercise checks, including line eligibility, clean-line matches, baseline pairing, and hint and prediction contracts. It emits detailed curator diagnostics, including relevant paths and lines, and never installs tools or runs target code. It operates on the supplied snapshot without requiring the author's live repository; live-repository and outside-repository exercise-path checks still run independently at author startup. A successful result establishes structural validity against that snapshot, not semantic correctness or current repository freshness.

With `--preview`, successful validation starts a loopback server using the same pre-reveal projections, full-file reader, and diff renderer as author review. This is a curator-only preview of the captured exercise; submission, hints, reveal, and export are disabled. Private diagnostics stay in the curator's terminal and never enter the preview page. Ctrl-C discards the preview. Curators must validate and inspect this preview before handoff; the application does not attempt to authenticate a person's role.

`review` validates the exercise against the repository, starts a server bound to `127.0.0.1` on an ephemeral port, and prints the private session URL. The author opens that URL in a browser. Ctrl-C closes the server and discards session data. Invalid arguments return exit status 2; validation, repository, and server failures return exit status 1. Any author-side exercise read, schema, binding, or mutation-validation failure returns only: `The exercise could not be validated against the current code. Please contact the curator.` Do not include a mutation path, line, clean text, replacement, parser excerpt, or detailed cause in stdout, stderr, logs, or browser responses. CLI usage errors and non-exercise operational errors may give bounded diagnostics without private exercise data.

### Curator-to-author handoff

The curator must be a different person from the author answering the exercise. The author selects a small change and any necessary supporting context files, exports the source-containing snapshot package, supplies it with requirements through an explicitly chosen manual channel, and freezes the selected file contents during preparation and handoff. The package includes baseline source, clean candidate source, and diff; the curator does not have to reconstruct them from hashes. Making a commit without changing those bytes is allowed. The curator prepares the mutation, verifies its triggering conditions against requirements, and authors both prediction scenarios. This effort resembles a focused review and must be counted as prototype preparation cost.

The curator runs `validate --preview`, checks the diff and expanded files for accidental cues, and delivers the private exercise file outside the target repository. The author starts `review`, which validates the file hashes before opening a session; if preparation-time edits changed them, the curator must update and reverify the exercise. Author startup uses a generic failure message so an invalid exercise cannot reveal the mutation. After startup, the captured snapshot permits historical review as described above. The application does not send these materials to anyone automatically.

The exercise is a manually authored JSON file outside the target repository. Accept an absolute path or resolve a relative path against the CLI's working directory. Resolve the real exercise path before enforcing the outside-repository boundary. Validate a versioned schema containing:

- Snapshot digest, resolved comparison commit, merge-base baseline commit, informational preparation HEAD, selected baseline and candidate path/hash pairs, title, requirements, and neutral intent context.
- An initial behavior scenario with the actual-behavior reference for the displayed exercise version, a separate clean-candidate actual-behavior reference, and a requirement-based explanation of intended behavior. If displayed and clean behavior differ, require an explanation of that difference. Actual behavior and intended behavior are distinct even when the clean code is already defective.
- A separate, previously unseen follow-up scenario with an actual-behavior reference and requirement-based explanation for the captured clean candidate.
- Zero or one mutation: selected path, candidate line number, expected clean line, replacement line, category, trigger, expected behavior, explanation, and curator verification evidence.
- Three ordered hint contents: count, category, and a narrower clue. A zero-mutation control permits no category or location clue.

Require nonempty correctness grounds and verification evidence for a mutation. Treat these as the curator's assertions, not proof established by the product. The runtime does not execute tests, evaluate arbitrary expressions, or infer validity from the original implementation. Users can dispute a reference answer.

The authoring guide requires replacement text to match the surrounding syntax and style. Where the project uses a formatter, the curator must check the entire projected file with that formatter in a separate preparation environment outside the target workspace, confirm that it needs no formatting changes, and record the check and result in verification evidence. Without a formatter, record a manual style and syntax review. Neither `validate` nor `review` invokes project scripts, formatters, hooks, or target code; nonempty evidence records a curator assertion rather than automatically proving it.

Reject a replacement containing CR or LF, an unchanged replacement, an out-of-range line, a clean-line mismatch, or a mutation outside an added candidate line in the selected baseline-to-candidate diff. The last restriction ensures the exercise is visible within the reviewed change without introducing a conspicuous new hunk solely to mark the mutation.

For each contiguous changed block, pair deleted baseline rows with added candidate rows in order for optional inline highlighting; unmatched added rows have no baseline pair. Reject a replacement identical to its paired baseline row. Compute inline differences from the baseline text and the actual displayed text, including the virtual substitution, rather than from the hidden clean candidate. Keep the original hunk layout and candidate line mappings. A mutation must not produce an identical displayed minus/plus pair or misaligned highlights that identify it accidentally.

Do not set a minimum changed-line threshold or enlarge a change to create hiding places. The authoring guide explains that tiny diffs can make the sole eligible mutation obvious and bias the exercise. If there is no natural, verifiable replacement that remains useful after preview, use a zero-mutation control or choose another small change. Zero injection does not certify the clean code, and the eligible-line rule is not broadened to compensate.

Provide an English exercise-format document and a small, independently verified example fixture. Neither runtime nor repository documentation depends on private working notes.

## Components and data flow

Keep responsibilities separate without introducing an extensible plugin architecture:

1. **Repository snapshot:** validates paths and supported scope, reads Git and working-tree content, builds baseline-to-candidate diff rows, and checks version freshness.
2. **Exercise validation and generator state:** validates curator input and applies substitutions to an in-memory review projection, preserving every line number and line count.
3. **Session state:** owns predictions, submitted annotations, hint stage, reveal, finding assessments, missed-region disposition, and completion rules.
4. **Local HTTP server:** exposes stage-specific data and validated state transitions. It never serves exercise files, arbitrary repository files, or private state through a generic file endpoint.
5. **Browser reader:** displays the diff and selected full-file snapshots, accepts typed annotation anchors and predictions, and shows the actions available at the current stage. Curator preview reuses these projections and rendering code.
6. **Handoff formatter:** builds a reviewer-facing Markdown card from verified clean-code findings, evidence, and explicitly unresolved questions.

Only the snapshot reader accesses the target repository. Session mutations change memory. Export is a browser download initiated by the author; the server does not choose an output file inside the repository.

## Session flow and disclosure rules

### 1. Reading and optional AI discussion

Show the requirements, neutral intent summary, scoped diff, initial behavior scenario, and fields for annotations. Ask what the displayed version actually does for that scenario, separately from what the requirements say it should do. The curator may choose a scenario that traverses the mutation; its actual-behavior reference must then describe that displayed version. An annotation uses one of the anchors below and records the suspected violated constraint, a triggering input or event, and uncertainty. Users can record questions or submit no findings with an explanation. Do not require inventing an issue.

The author may collaborate with AI before reveal using the read-only discussion view. It projects the same displayed full files and diff hunks as the UI, public requirements/scenario, and saved annotations. It exposes no clean candidate counterpart, hashes, mutation descriptor, hints, or reference answers. AI may reason through branches, propose triggering cases, and predict behavior as hypotheses; the author selects and submits the findings and predictions. AI must not compare with the clean workspace or execute virtual code. Existing prior knowledge cannot be erased; blind analysis needs a fresh conversation containing only the discussion view. The lightweight status interface stays separate, and only the author controls disclosure in the UI.

### Reading context and annotation anchors

Start each diff hunk with three unchanged lines of context on either side, merging overlapping context ranges. Every selected file, including unchanged supporting files, has an **Expand full file** action. Before reveal, its candidate view uses the same virtual line substitutions as the diff, with original candidate line numbers and no mutation markers. Full-file responses must not include a hidden clean counterpart or mutation metadata. Users can also read the captured baseline file, labeled as baseline, to understand deleted code. Neither view reads live edited code into the session.

Annotations use one of four validated anchor kinds:

- **Candidate line:** selected path plus an in-range clean candidate line number, including unchanged lines outside a diff hunk. Before reveal the visible text at that number may contain a virtual substitution.
- **Deleted baseline line:** selected path plus a baseline line number that appears as a deleted diff row. Keep it attached to the baseline version; never invent a candidate line number for it.
- **File:** a selected changed or supporting file, for broader interactions or missing logic that has no single line.
- **Change:** the captured review scope as a whole, for cross-file behavior, missing requirements, or references to unselected context.

Each annotation also records the suspected violated constraint, triggering input or event, and uncertainty. The page offers anchors from diff rows, full-file rows, file headers, and a change-level action. The handoff preserves the anchor kind and version, formatting deleted lines as baseline references and change-level findings without fabricated file positions. Verification of a claim involving unselected code requires separately recorded evidence; otherwise hand it over as an unresolved question.

The initial browser payload contains no mutation count, category, location marker, clean substituted line, reference answer, generator seed, or verification evidence. The baseline side is ordinary baseline code; it is not a clean-candidate comparison. Reader access to their own repository is possible and is not treated as cheating.

### 2. First-pass submission and optional hints

Submit the initial prediction and annotations, or explicitly state insufficient context. Freeze the first pass before curator hints or reveal. Optional AI discussion does not make this an unaided pass. Then permit revised annotations and optional hints in order: count, category, narrower clue. Each hint endpoint returns only its allowed information. Private hint usage remains in memory.

The author may proceed directly to reveal after submission. Hints are optional and cannot establish how carefully someone read. No completion score or threshold is calculated.

With zero or one mutation, the count hint necessarily reveals whether this is a control exercise. This occurs only after the first pass is frozen. Any later research analysis must distinguish the first pass from responses after that disclosure and avoid treating optional AI discussion as unaided review; hinted responses cannot be treated as blinded control observations. No experimental analytics or automatic result collection is implemented in v1.

### 3. Reveal and clean-code assessment

An explicit reveal action returns the mutation location, clean line, trigger, explanation, curator evidence, and initial prediction references. Present displayed-version actual behavior, clean-candidate actual behavior, and requirement-based intended behavior separately, explaining any differences. It also makes the captured clean candidate available in the reader. In historical mode, these references still describe the captured versions, never the author's subsequently edited code. An annotation at a mutation line is only a candidate match; location alone does not prove a correct explanation.

Assess each finding using the clean candidate. Supported assessments are exercise-only, verified real issue, unresolved question, false positive with reason, and disputed exercise/reference answer. Verification requires recorded evidence and human judgment. A suspected issue is not automatically promoted to a real issue because it falls outside the injected line.

For a verified real issue in the captured clean candidate, require a disposition: hand over for a fix, hand over for a test or other verification, decline with reason, or hand over as an unresolved question. Record evidence establishing the original issue and the concrete next action. V1 normally ends the review before repairs: export the handoff, then fix or add tests on the original branch through the usual development workflow. Do not offer an apply-mutation or apply-fix action.

If the author already edited code during the review, allow a free-text note describing that work, but mark its effect on the issue as unverified against the current revision. Export it as a question requiring verification, not as a verified fix or executed test. V1 does not capture new snapshots, reanchor findings, or confirm post-review repairs.

If the injected problem was not explained, record either that its region was reread or that a remaining concern is explicitly handed over. A disputed exercise can be withdrawn with a reason. None of these decisions rates the author's attention or ability.

### 4. Clean-candidate follow-up and handoff

Present the previously unseen follow-up scenario against the clean candidate. Accept a prediction, reasoning, or a concrete uncertainty. Reveal its reference only after submission, with the same dispute option.

Enable completion when findings have assessments and required dispositions, unresolved questions have explicit handoff text, and the exercise-region and follow-up steps have a recorded outcome. Missing a deliberate bug is never a failure condition.

Saved disputed findings and region concerns must retain their explicit requirement questions in the handoff without copying private curator reference data. Block browser export while an annotation draft, changed assessment, or changed follow-up question is unsaved; do not silently export an older saved decision while displaying newer inputs.

An explicit export action downloads Markdown with the captured scope and version identifiers, snapshot freshness at export, verified findings about the captured clean candidate and their evidence, existing test evidence, proposed fixes or tests, declined issues with reasons, and unresolved questions. Historical findings are clearly labeled as awaiting comparison with current code. Empty findings are valid. Export excludes exercise answers, mutation details, hint usage, and finding/missing counts. Private exercise feedback stays in the page.

After a successful download is initiated, end the session's review flow and show its completion state. Keep the download available for retry until the process closes, since the server cannot prove a browser saved the file. The author then resumes normal clean-code development. Any later review uses a separately prepared exercise; post-fix reassessment is deferred.

## Local server and input safety

Use a cryptographically random session capability in the URL path. Bind only to loopback, validate Host, reject cross-origin state-changing requests, and require JSON requests with a session-specific header for transitions. Supply a restrictive Content Security Policy, no-store caching headers, and no permissive CORS policy. Return bounded, generic errors without private exercise data.

Treat repository text, requirements, hints, and annotations as untrusted display text. Use text nodes or escaped HTML; never interpolate them as executable markup. Bound request body sizes, file sizes, selected-file count, and annotation/text lengths, and reject unsupported methods and invalid transitions.

Repository-relative paths must have no traversal or absolute form. Resolve paths under the real repository root, reject symlinks in their components, and use Git arguments without a shell. Do not allow exercise paths inside the target repository, serve arbitrary paths, execute Git hooks, change Git settings, or start target services.

A random URL protects against incidental local web access; it does not isolate secrets from the same operating-system user who owns the exercise file. State this practical limit accurately.

## Privacy and lifecycle

The server retains active answers and dispositions only in memory. No analytics, dwell times, click trails, browser local storage, interaction histories, or automatic result files are created. Logs contain startup and concise operational errors, without code, submitted answers, or private reference data. Closing the process discards the session. The author controls the exercise input file and downloaded handoff card.

No PR comments, messages, uploads, or review requests are sent. The author chooses whether to share the handoff. Exercise outcomes and hint usage are individual feedback and are excluded from shared output.

## Validation and acceptance criteria

Use Node's test runner with temporary Git repositories and manually authored exercise fixtures. Behavior tests must demonstrate:

- Review start, submission, hints, reveal, and export leave target file bytes, Git index, and Git configuration unchanged.
- Virtual replacements preserve line counts and clean candidate annotation mappings; invalid replacement and binding cases fail safely. Reject replacements identical to paired baseline rows, and verify that inline highlighting uses the actual displayed text.
- Pre-reveal pages, scripts, responses, direct reveal requests, and errors disclose no private mutation descriptor or answer. Each hint stage discloses only its allowed fields, and the follow-up reference remains hidden until its submission.
- Author startup failures for malformed exercises, missing exercise files, line mismatches, out-of-range mutations, and binding failures produce only the fixed generic message, without paths, lines, source, or causes. Curator validation produces detailed diagnostics only in its terminal, and preview uses the same safe projections as author review with stage-changing routes disabled.
- Snapshot export includes exact baseline and candidate source, modes, hashes, and correct diff mappings for changed and unchanged selected files. Curator validation detects inconsistent or tampered source, hashes, and diff rows; committing unchanged content does not change the snapshot identity or break startup.
- Diff context defaults to three lines; full-file expansion preserves substitutions and line numbers before reveal, including mutation lines beyond a collapsed context range. Expanding supporting files provides their captured contents without arbitrary live-file access. After reveal the clean reader switches only to captured clean content.
- Candidate-line, deleted-baseline-line, file, and change anchors survive submission, historical mode, and export without invented line mappings. Reject invalid lines and unselected file anchors; allow cross-scope references as change-level questions with an explicit evidence boundary.
- Preparation-time content mismatches reject startup. During review, selected working-tree edits, deletions, or unreadable files retain annotations and switch the session to historical review; first-pass submission, staged disclosure, captured-clean follow-up, and export still work against the original snapshot. Export cannot claim current-code verification or verified repairs. Staged and unstaged candidate edits are captured correctly, and a commit with unchanged selected bytes leaves the session current.
- Advancing a comparison branch does not alter an existing snapshot's merge-base. Preparation excludes newer comparison-branch changes from the candidate diff, and ambiguous or missing merge-bases fail clearly.
- Initial prediction references describe the displayed version, including a traversed mutation; reveal distinguishes that behavior from the clean candidate and requirements. Follow-up references always describe the captured clean candidate, including in historical mode.
- Traversal, absolute selected paths, symlink escapes, unsupported change types, hostile display text, excessive requests, and cross-origin transitions are rejected or rendered safely. Relative and absolute exercise paths resolve consistently and cannot bypass the outside-repository rule through symlinks.
- No-findings, zero-injection, unclear requirements, disputed references, provisional findings, and unresolved clean-code defects have valid paths through the flow.
- Export requires proper dispositions and excludes private exercise outcomes and answers. A suspected finding without evidence cannot appear as a verified issue. Historical exports include current-code recheck questions; claimed repairs remain unverified. Download retry works after the review flow ends.

Run `npm run check`, `npm run build`, and the behavior tests. Verify help, `doctor`, invalid-argument statuses, source-containing snapshot output, curator validation and preview, generic author validation errors, and review startup/teardown. Perform a browser walkthrough of the example exercise, covering diff and full-file views, all annotation anchors, reveal, dispute, and download. Report unrun or unavailable checks explicitly.

## Delivery scope

Update README and CLI help to describe implemented capabilities and limitations accurately. Update the current-status paragraph in AGENTS only to reflect the resulting implementation; preserve all safety boundaries. Include exercise-authoring documentation and an example without committing any private notes.

This prototype evaluates whether a short curated review produces useful findings and understanding. It does not establish that the methodology improves review quality, that references are always correct, or that a completed session is a substitute for independent review.
