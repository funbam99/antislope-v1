# Minesweeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver the curated research prototype, including preparation, safe local reading, disclosure, and a useful handoff.

**Architecture:** Keep immutable Git snapshots and private exercises on the server. Serve explicit stage projections through a loopback HTTP server and a dependency-free browser reader. Repository operations are read-only; mutations exist only in memory.

**Tech Stack:** Node.js 22, npm, TypeScript ESM, built-in HTTP/crypto/fs, Node test runner, existing tsx and Prettier.

**Spec:** `docs/superpowers/specs/2026-10-11-minesweeper-design.md`

## Global Constraints

- English project text; never commit or depend on private working notes.
- No runtime dependency, target-code execution, executable fork, repository mutations, telemetry, scores, or automatic sharing.
- Three context lines; zero or one line substitution; all reader data must obey disclosure stages.
- Preserve deleted-baseline, candidate-line, file, and change anchors.
- HEAD is informational; fixed merge-base and selected content define the captured version.
- Author exercise errors use the spec's fixed generic message; detailed diagnostics belong to curator validation.

## Review Focus

- CRLF and missing final newline: byte hashes and line numbers must round-trip (Task 1).
- Git pathspec syntax, symlink components, and invalid UTF-8: selection cannot escape its literal scope (Task 1).
- Malformed or oversized nested JSON: validation must not leak secrets or exhaust memory (Tasks 2–3).
- Edits before reveal and unchanged-content commits: retain answers without misrepresenting current code (Tasks 1–3).
- Deleted checks and unchanged helpers: preserve usable anchors and captured full-file context (Tasks 2–4).

## Task 1: Immutable snapshots and deterministic diffs

**Files:** `src/minesweeper/snapshot.ts`, `src/minesweeper/diff.ts`, `src/minesweeper/types.ts`, `test/helpers.mjs`, `test/snapshot.test.mjs`, `package.json`.

**Interfaces:** `captureSnapshot(repo: string, base: string, files: string[]): Snapshot`; `captureBoundSnapshot(repo: string, exercise: Exercise): Snapshot`; `validateSnapshot(input: unknown): Snapshot`; `freshness(repo: string, snapshot: Snapshot): "current" | "historical" | "unknown"`; `diffRows(baseline: string, candidate: string): DiffRow[]`.

- [x] Write tests using real temporary Git repositories: fixed merge-base, staged/unstaged source, unchanged supporting file, unchanged-content commit, branch advancement, CRLF, missing final newline, traversal, symlinks, unsupported file types, and tampered snapshots.
- [x] Run `node --import tsx --test test/snapshot.test.mjs`; expect missing implementation failures.
- [x] Implement bounded literal Git reads, exact UTF-8 source hashes, snapshot digest excluding informational fields, and deterministic line diffs with baseline pairing.
- [x] Run the same tests; expect all passing.
- [x] Run `npm run check` and `npm run build`; commit Task 1.

## Task 2: Exercise validation and session disclosure

**Files:** `src/minesweeper/exercise.ts`, `src/minesweeper/session.ts`, `src/minesweeper/handoff.ts`, `test/session.test.mjs`.

**Interfaces:** `validateExercise(input: unknown, snapshot: Snapshot): Exercise`; `new ReviewSession(snapshot: Snapshot, exercise: Exercise, repo?: string, preview?: boolean)`; `session.view(): ReaderView`; `session.transition(action: string, input: unknown): unknown`; `session.export(): string`.

- [x] Write tests for zero/one mutation, invalid replacement, paired-baseline rejection, hidden answers in diff and full-file data, four anchor kinds, submission/hint/reveal gates, predictions, dispositions, disputes, historical exports, and private-data exclusion.
- [x] Run `node --import tsx --test test/session.test.mjs`; expect missing implementation failures.
- [x] Implement strict bounded schema validation, projections, in-memory state transitions, and Markdown handoff escaping. Curator validation records evidence without executing it.
- [x] Run the full `npm test`; expect all passing.
- [x] Run checks/build; commit Task 2.

## Task 3: Safe HTTP server and CLI

**Files:** `src/minesweeper/server.ts`, `src/minesweeper/commands.ts`, `src/cli.ts`, `test/server.test.mjs`, `test/cli.test.mjs`.

**Interfaces:** `startServer(session: ReviewSession): Promise<{ url: string; close(): Promise<void> }>`; `runMinesweeper(args: string[]): Promise<number>`.

- [x] Write integration tests for capability paths, Host/Origin/header checks, body limits, no-store/CSP headers, invalid transitions, preview immutability, generic author errors, relative exercise paths, and unchanged repository bytes/index/config.
- [x] Run the new tests; expect missing behavior failures.
- [x] Implement snapshot/validate/preview/review commands, bounded JSON reads, loopback server, safe error responses, and Ctrl-C teardown. Keep doctor read-only.
- [x] Run all tests plus help, doctor, invalid commands and exit statuses; expect passing.
- [x] Run checks/build; commit Task 3.

## Task 4: Browser reader, examples, and delivery

**Files:** `src/minesweeper/page.ts`, `src/minesweeper/client.ts`, `src/minesweeper/style.ts`, `docs/minesweeper-exercises.md`, `examples/minesweeper/*`, `README.md`, `AGENTS.md`, `.github/workflows/ci.yml`.

- [x] Extend integration tests to fetch real HTML/assets and exercise the complete API flow for all anchor kinds, full-file projection, download completion/retry, and hostile display strings.
- [x] Run the tests and observe missing reader/asset behavior.
- [x] Implement DOM text-only rendering, diff/full-file switches, annotations, predictions, optional hints, reveal, disposition forms, historical warnings, and download retry. Browser assets are TypeScript-exported strings so the existing build packages them.
- [x] Provide a runnable example setup script that creates only a separate temporary repository and curator materials; document evidence, formatter review, tiny-diff limits, and CLI contracts.
- [x] Run tests/check/build and browser walkthrough; record any unavailable verification honestly.
- [x] Request one fresh-context whole-branch review, resolve important findings with regression tests, then commit the delivery.

## Execution record

The user's direct `implement` instruction authorizes execution of the reviewed spec. Implementation proceeds inline on `feat/minesweeper`; no new worktree or external publication is needed. Progress is recorded in the ignored `.anti-slope/implementation-progress.md` file. Each task's tests gate its completion.
