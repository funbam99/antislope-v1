# Anti-Slope skill integration plan

> Execute inline using Superpowers executing-plans and TDD. The user's request authorizes both skill entrypoints and integration with the existing runtime/UI.

## Goal and architecture

Create `antislope/SKILL.md` and `antislope/minesweeper/SKILL.md`. The top-level skill routes code review to the nested skill. A bundled Node helper captures clean inputs, starts a fresh non-interactive Codex generation process, intercepts all its output, validates its structured result privately, and starts the existing loopback UI. The primary conversation receives only status and the reader URL until author reveal.

The generator receives the selected immutable snapshot, requirements, and its own reference instructions. It receives no conversation history. Its final JSON, stdout, stderr, errors, and tool progress never flow directly into the primary context. Disable generator execution/integration capabilities, use the read-only sandbox and ephemeral mode, and retain existing CLI authentication but ignore user configuration and shared daemons. No new runtime dependency or target-code execution is introduced.

The privacy guarantee applies to the bridge's outputs and stage-gated API. This is context and protocol isolation, not an operating-system barrier against the same account deliberately inspecting private memory/files or bypassing the skill. Skills must not direct the primary context to read private generator material or perform author submission/reveal actions.

## Task 1: Private generation and agent status API

Files: `src/minesweeper/generator.ts`, `src/minesweeper/generator-schema.ts`, `src/minesweeper/skill-session.ts`, `src/minesweeper/session.ts`, `src/minesweeper/server.ts`, `test/generator.test.mjs`.

- [x] Write and run failing behavior tests using a separate real worker process that intentionally prints private material on stdout and stderr. Assert no worker material enters bridge stdout/stderr, including failure and malformed-result paths.
- [x] Add a strict generation schema; bind its content to authoritative snapshot metadata and requirements rather than accepting generated version identifiers or contracts.
- [x] Launch a fresh `codex exec` via argument-array spawning, private temporary directory outside the target, bounded intercepted streams, timeout/cancellation, and private schema/final-output files. Remove these files before serving the UI and on failure.
- [x] Add `ReviewSession.agentView()` and read-only `GET agent`: before reveal only phase/freshness/opaque reader ID; afterward captured clean code, submitted findings, and only the references already released by author actions. Never expose replacement text through this route.
- [x] Run all tests/check/build; assert target bytes/index/config remain unchanged and private generation files are cleaned up.

## Task 2: Bundled skill helper and Minesweeper entrypoint

Files: `antislope/scripts/session.mjs`, `antislope/minesweeper/SKILL.md`, `antislope/minesweeper/references/generator.md`, `test/skill-session.test.mjs`.

- [x] Test missing skill/bridge baseline with an independent evaluator before writing the skills. Control result: existing manual-curator commands cannot suppress free-text generator completions; skill files are absent.
- [x] Add `run --repo --base --file ... --requirements-file ... [--codex <installed-executable>]` and read-only `status --url <local-session-url>`. Run emits answer-free JSON progress, then the existing UI URL; it lives until Ctrl-C. Status never triggers author transitions.
- [x] Resolve the trusted Anti-Slope runtime relative to the helper, with explicit `ANTISLOPE_RUNTIME_ROOT` support for relocated skill folders. Fail clearly without installing dependencies or starting a generator when the runtime is unavailable.
- [x] Write the nested skill's input selection, helper invocation, UI handoff, stage-aware discussion, historical-code handling, and failure/cleanup workflow. Include a private generator reference loaded by the worker process, not by the primary conversation.
- [x] Run end-to-end helper tests and independent forward-testing with the skill; validate its frontmatter.

## Task 3: Top-level router and delivery

Files: `antislope/SKILL.md`, `README.md`, `AGENTS.md`, `docs/minesweeper-exercises.md`.

- [x] Write the short router after the nested workflow is verified; route by explicitly reading `minesweeper/SKILL.md`. Do not claim support for non-code workflows.
- [x] Forward-test routing and missing-runtime/no-generator cases without generating answers in the primary context; validate both skill files.
- [x] Document default-provider Codex CLI/auth prerequisites, source transmission through that provider, ephemeral output handling, skill-root relocation, and the limits of context isolation. Do not install skills globally or publish anything.
- [x] Run a real fresh-process generation smoke test using only a synthetic temporary example. Report any unavailable native generation check.
- [x] Run `npm test`, `npm run check`, `npm run build`, help/doctor and helper usage/exit checks. Request one read-only final review, fix important findings, and commit the result.

## Review focus

- Generator stdout/stderr can contain answers even with structured output; intercept both.
- Main status must not expose guesses or digests that reveal a control or substitution.
- Generated JSON cannot redefine requirements, paths, hashes, or line eligibility.
- Temp paths and relocated skill roots must not execute code from the reviewed target.
- A stale snapshot and generator failure must not trigger fallback answer generation in the primary context.

## Verification record

The missing-workflow baseline and independent skill/router forward tests were completed. A read-only review found inherited MCP configuration was not cleared by an empty table; the bridge now ignores user configuration/rules and shared daemons. It supports unmanaged macOS/Linux hosts only and rejects known system/MDM configuration paths. Custom providers/models and managed hosts remain unsupported.

Type/format checks, build, all 39 behavior tests, help, doctor, helper exit/status checks, and fresh native generation through the installed Codex CLI passed. Native generation used only a synthetic temporary repository and exposed safe status to the primary context. Target source/index/config immutability and worker cleanup are covered by tests.

The skill-creator Python validator could not run because PyYAML is unavailable in both local Python runtimes. Both simple YAML frontmatters, required fields, names/descriptions, file references, and missing placeholders were checked separately with Node assertions and independent forward testing. No dependency was installed.
