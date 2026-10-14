# Anti-Slope

Tools and workflows that help people carefully read and understand AI-generated work before passing it on for review.

Anti-Slope is a project exploring ways to make human review more deliberate, across code, design documents, and other AI-generated work. **Minesweeper is its first product.**

Private GitHub repository: [funbam99/anti-slope](https://github.com/funbam99/antislope-v1).

## First product: Minesweeper

Minesweeper helps authors review AI-generated code before requesting a review from someone else. The curated research prototype introduces zero or one deliberate error only into a local review view. The useful outcome is verified findings about clean code, test evidence, and questions or proposed changes handed over for normal development.

Exercises can be prepared by a separate human curator or an independent Codex process through the bundled skill bridge. Automated references are hypotheses rather than executed test results. Benefit, accuracy, and preparation cost remain experimental.

## Current status

Node.js 22, npm, and TypeScript ESM provide a CLI with help, read-only diagnostics, source snapshot export, curator validation/preview, and a local browser review server. The reader uses a two-column code-and-chat interface with an automatic neutral AI summary. A visible progress bar navigates the review inside the right-hand conversation. First-pass confirmation, explicit reveal, review-card confirmation, follow-up context, and export use chat messages and buttons instead of workflow dialogs or assessment forms. Session actions and appearance settings live in a compact menu; one file-view selector switches between changes, full file, and baseline. System, light, and dark appearance preferences are saved locally. Drag the divider or use its arrow keys to adjust pane widths; double-click restores the default. The width is remembered locally. Comments appear below their selected code range. File/change comments and anchors outside the current view remain visible above the code, with links to the appropriate full-file version. First-pass submission reuses saved comments and sent author chat messages, without separate prediction or no-findings text fields. The visible discussion and comment ranges are frozen locally; a bounded author-message excerpt is retained by the session. AI replies are not automatically treated as findings. New review items stay as unverified questions. The author can confirm a real issue using their recorded post-reveal clean-code evidence, without re-entering it. Confirming the card preserves the follow-up discussion context and releases its reference; it does not claim that a separate prediction was answered. Changed comments or chat require reconfirmation before export. It supports diff and full-file views, four annotation anchors with a selection-triggered comment editor, staged hints and reveal, finding dispositions, historical snapshots, and a downloadable Markdown handoff.

V1 supports selected existing tracked TypeScript files, including unchanged supporting context. It uses a fixed merge-base and content hashes; committing unchanged content preserves validity. Workspace edits during review preserve the captured session as historical. The bundled skills launch independent exercise generation and reuse this runtime/UI. No executable fork, target-code execution, scoring, or external posting is implemented.

See [curated exercise preparation and the runnable example](./docs/minesweeper-exercises.md).

## Skill entrypoints

Load [antislope/SKILL.md](./antislope/SKILL.md) for the project entrypoint. It routes code review to [antislope/minesweeper/SKILL.md](./antislope/minesweeper/SKILL.md). These are repository artifacts; no global installation or settings changes are performed.

The bundled helper requires a built Anti-Slope checkout, Node.js 22, Git, and an installed/authenticated Codex CLI. It sends selected immutable source and requirements to that CLI's built-in default model/provider in a fresh context. User configuration and shared daemons are ignored; custom provider/model configuration and system/enterprise/MDM-managed hosts are unsupported. Use an unmanaged macOS/Linux Codex setup. A private bridge starts `codex exec`, suppresses all worker stdout/stderr, validates the result, deletes temporary generator files, and starts the existing UI. Only safe preparation status and the reader URL reach the main conversation. The lightweight status endpoint returns phase/freshness/opaque ID until author reveal. A separate read-only discussion endpoint shares the same displayed full files and diff as the UI so the author and AI can analyze code and test hypotheses by reasoning before reveal. It withholds the clean candidate counterpart, hashes, mutation metadata, hints, and references. Follow-up references remain withheld until their own submission.

In-page chat uses independent, ephemeral Codex app-server calls with only the displayed discussion view, explicitly shared comments, and its own saved conversation. It receives no exercise object, hidden candidate counterpart, hints, or references. Provider failures preserve drafts for retry. Visible assistant text streams into the browser while generation is in progress; reasoning, tool events and internal diagnostics are discarded. The browser polls the protected chat projection every 150 ms while busy. Streaming follows the bottom until the author scrolls up, then keeps that reading position until they return near the bottom. Only completed successful turns enter persisted history and future AI context. Each chat call uses a private temporary configuration/auth home with a copy of existing file-backed CLI authentication, without copying user config or hooks; the temporary home is deleted after the child exits. Generator calls retain their existing private exec transport. Chat shortcuts show the next step, request the next runtime hint after first-pass submission, and organize comments and author discussion into an inline review card. Clicking Hint displays “Give me a hint” and the runtime response, without sending either to the collaborative AI. Review shortcut messages and already released hints are saved in browser local storage for the same session. Reloading or reopening restores their place in the discussion and rebuilds workflow controls from the current server state, without repeating actions or consuming another hint. Review cards reflect the current saved comments and discussion. This local history remains separate from AI requests and metadata exports; clearing browser storage removes it. Restart the local server with `npm start -- minesweeper resume --session <id>` to restore the same URL and server state. After reveal, the code pane and inline review card show the total deliberate errors, how many are covered by current candidate comment ranges, and how many have recorded author verification evidence. Overlapping comments count a deliberate error once; whole-file/change comments and chat claims do not establish location. A comment on the mine counts as flagged immediately, even without a full triggering example. The code marker distinguishes a flagged mine awaiting verification from a mine without a covering comment. Pending verification never means the author failed to locate it. A marker links to the captured clean-code region. Saving a comment automatically opens or updates an inline review card and starts a separate ephemeral organizer before reveal. It receives only public requirements, comments, author messages and the captured displayed review code, with no runtime-provided clean counterpart, baseline, hints, hashes or references. Author messages may contain code the author explicitly chose to share. It preserves author-reported traces/tests with exact source quotations. When an actionable comment lacks an example, it can derive a concrete counterexample from that comment and displayed code, with inputs, predicted behavior, requirement expectations, observable branch steps and exact code citations. These generated records are labeled “AI counterexample · code reasoning, not executed.” They explain the exercise region without automatically creating a verified issue in clean code. Missing, disputed, ambiguous or ungrounded reasoning remains pending. No separate verification form or per-mine confirmation button is needed. The review card displays the provenance and its existing confirmation saves the region explanation. AI reasoning and author reports are not independently executed or verified. Before reveal, cards display the unexecuted reasoning and author comments without mine counts, markers, location controls, hint history or references in organizer requests. Generation does not submit or reveal the session. Evidence summaries are saved in browser storage for the same session, included in the local first-pass snapshot, and rebuilt when comments or conversation change; old author-only caches are invalidated when this workflow upgrades. These personal exercise counts are excluded from metadata exports and AI context. Before reveal, the summary and code markers stay hidden; explicitly requested hints retain their existing stages. The review card has no scores, and shortcuts do not automatically reveal anything or send hints to AI. Chat renders common Markdown (headings, lists, emphasis, links, tables, quotes, inline code, and fenced code blocks), with basic lexical highlighting for TypeScript, JavaScript, and JSON. Raw HTML stays inert and remote images are not loaded. Each saved comment has a “Quote in chat” action that appends its displayed code and comment to the composer without sending or replacing an existing draft. Comments and multi-line selection ranges are saved in browser local storage for the session URL, without storing code or answers. Reopening the same session in the same browser restores them, including after the server is resumed. Existing tab-scoped comments migrate on their next page reload; browser storage clearing removes the saved copy. The comment editor contains only the comment and selection actions. Double-click a word or drag across lines to open the selection editor; “Add to Chat” quotes the selected lines directly without requiring a comment. After reveal, quotations use the captured clean candidate.

Usage & outcomes saves anonymous session metadata locally and exports it only on request. It reports completion, author-assessed real issues with recorded evidence, real-issue test handoffs, unresolved questions, and optional usefulness feedback. It excludes source, comments, chat, answers, hint usage, and behavioral trails. See [metadata export and internal aggregation](./docs/minesweeper-metadata.md).

See the [skill workflow and isolation limits](./docs/minesweeper-skills.md). Independent generation is experimental and does not execute tests or prove reference correctness.

## Local development

Use Node.js 22 (the current baseline is 22.22.2), its bundled npm, and Git. The `.nvmrc` file pins the development version; with nvm, run `nvm install` and `nvm use` first.

```sh
npm install
npm run dev -- --help
npm run dev -- doctor
```

`doctor` checks Node.js, Git, and the current working directory without changing Git configuration or workspace files.

Before committing, run:

```sh
npm run check
npm run build
npm test
npm start -- doctor
```

`check` checks types and formatting, `build` compiles TypeScript, and `start` runs the compiled CLI.

## Minesweeper boundaries

- Deliberate bugs exist only in the review view. Never write them into the target repository or workspace.
- Keep mutation patches, answers, and random seeds separate from the reader's view until the appropriate reveal stage.
- Prioritize real findings. Completion depends on addressing findings and handing over unresolved questions, without pass scores, hit-rate thresholds, leaderboards, or performance ratings.
- Missing a deliberate bug does not prove inattention or lack of ability. Finding them all does not prove that the code is correct or fully reviewed.
- Do not retain click trails, dwell times, or similar behavioral data by default. Sending comments, messages, or review summaries requires explicit user authorization.

See [AGENTS.md](./AGENTS.md) for development rules and the full Minesweeper constraints.

## Try Minesweeper

```sh
npm run build
node examples/minesweeper/create-example.mjs
```

The example prints paths to a separate temporary repository, snapshot, and private exercise. Use those paths with:

```sh
npm start -- minesweeper validate --snapshot <snapshot-json> --exercise <exercise-json> --preview
npm start -- minesweeper review --repo <repository> --exercise <exercise-json>
```

Open the printed loopback URL; Ctrl-C closes the server and preserves its private local checkpoint. The command prints a session ID and a resume command. Run `npm start -- minesweeper resume --session <id>` to reopen that session at its original URL. Export the handoff before resuming normal fixes and tests. Only the author chooses whether to share it.

Session recovery files live under `~/.local/state/antislope/sessions/<id>/`, outside the reviewed repository, with owner-only directory/file permissions. They include captured source, the private exercise, successful chat turns and request IDs, and review state. Treat them as private runtime data: never read them in the facilitating conversation or upload/commit them. Atomic checkpoints are saved before successful action responses. In-flight failed chat turns are not saved. Recovery validates the original snapshot/exercise and review transitions, preserves the reader ID and stage, and does not regenerate an exercise. The original port must be free; recovery fails instead of choosing another origin and losing browser-local comments/ranges or workflow history. Curator previews remain temporary. Existing servers started before recovery was implemented have no checkpoint and cannot be resumed with this command.

The next product experiment is a few curated author reviews. An executable disposable fork would need a separate isolation design and an environment unable to push to a remote.

If an old exercise is lost before a checkpoint can be created, a recovered reader archive can preserve available displayed code, annotations and discussion. It is explicitly read-only: the original references and hint level are unavailable, AI turns and exercise actions are disabled, and no reconstructed answers or handoff certification are supplied. This fallback does not count as a complete migration.
