# Anti-Slope Development Rules

## Project and current scope

Read `README.md` first. Anti-Slope is the project exploring tools and workflows for careful human review of AI-generated work, including code and design documents. Minesweeper is its first product, not another name for the project.

Use English for repository documentation, code comments, CLI text, commit messages, and other project-facing content. `brainstorm.md` is a private, local-only working document: never commit, upload, or publish it, and do not make repository documentation or development depend on its presence.

Minesweeper's primary use case is an author voluntarily reviewing AI-generated code before asking someone else to review it. Product proposals are not implemented features; documentation and CLI help must describe the actual state accurately.

The current implementation is the **v0.1.0 research prototype**, using Node.js 22.22.2, npm 10 or later, and TypeScript ESM with a local browser UI. The CLI supports `--help`, read-only `doctor`, and `minesweeper snapshot`, `validate` (including curator `--preview`), `review`, and `resume`. See README for installation and supported Codex prerequisites; `doctor` does not check AI authentication.

V1 reviews 1–12 existing tracked UTF-8 `.ts` files, each up to 128 KiB and 2,000 lines, with at least one selected file changed from baseline. Added, deleted, and renamed files are unsupported. Preparation fixes the merge-base and selected content. Later edits preserve the captured review as a historical snapshot; committing unchanged content does not invalidate it. Exercises contain zero or one virtual mutation.

The two-column UI provides diff/full-file/baseline reading, persistent inline comments and multi-line ranges, streaming Markdown AI discussion, and review steps/cards inside the conversation. Saved comments can trigger AI counterexample reasoning before reveal. Existing comments and chat supply the first pass, assessment, follow-up context, and handoff without duplicate forms. Submission, hints, reveal, card confirmation, and export remain author actions. AI reasoning is unexecuted; unsupported observations remain questions, and confirming a card does not verify its claims.

Repository skill entrypoints route through a bundled helper for independent, experimental Codex exercise generation. Collaborative AI receives the displayed code and permitted discussion, without private generator material or runtime hints/reference answers. Private local checkpoints restore the exercise, successful AI chat, and review stage at the original URL; browser storage retains comments, ranges, hints, and review messages in the same browser profile. Local anonymous metadata supports manual export and aggregation of recorded outcomes, without source/chat text, hint usage, or exercise results.

Executable forks, target-code execution, design-document review, personal scoring, and automatic sharing are not implemented. Do not introduce frameworks or create unrelated skills as incidental setup work.

## Required Minesweeper boundaries

- **Virtual mutations:** Replace line contents only in the review view, without adding or removing lines. Preserve mappings to the clean version's line numbers. Never modify the target repository or workspace to plant deliberate bugs, and never rely on users to restore files manually.
- **Answer isolation:** Mutation patches, reference answers, and random seeds belong to the exercise generator. Do not embed them in reader-accessible pages or data responses before their reveal stage. Provide reveal data only at the appropriate stage. Private exercises, generator output, and recovery checkpoints must not be read or dumped into the facilitating conversation or collaborative AI context; use the runtime's filtered endpoints and recovery commands. Never use the mutated version as the basis for subsequent fixes or code generation.
- **Execution isolation:** Before supporting execution of mutated code, design a disposable isolated environment. Never execute or retain mutations in the target workspace. The execution environment must have no ability to push to a remote.
- **Real findings first:** Only verified issues, tests, fixes, and questions flow back into the original change. Never merge exercise mutations. Record a disposition for each real issue and explicitly hand over unresolved matters.
- **No scoring product:** Do not add pass scores, hit-rate thresholds, personal leaderboards, or performance ratings. Missing a deliberate bug does not establish poor attention, carelessness, or lack of ability. Finding every deliberate bug does not prove that review is complete or that the code is safe.
- **Room for disagreement:** Allow no findings, problems in the original code, incorrect reference answers, and unclear requirements. Every deliberate bug needs verifiable triggering conditions and a basis for judging correctness. The original output is not automatically the correct answer.
- **Restraint in collection and sharing:** Do not retain dwell times, click trails, or similar behavioral records by default. Hint usage and exercise results are for the individual user only. Do not automatically send PR comments, messages, or review summaries without explicit user authorization.

## Changes and validation

- Keep changes small and reviewable. Do only what the current task needs; avoid premature abstractions and dependencies.
- Preserve existing files, uncommitted changes, and product decisions. Do not overwrite, revert, or clean up unrelated work. Surface conflicting product directions before proceeding.
- Use npm to manage dependencies and the lockfile; do not mix package managers. Confirm that existing capabilities are insufficient before adding a dependency.
- Keep `doctor` read-only. Diagnostics must not automatically install tools, change Git configuration, write to the target repository, or start external services.
- After code or configuration changes, run `npm run check` and `npm run build`. When CLI behavior changes, also run the relevant commands to verify help, diagnostics, and exit statuses.
- Validate actual behavior and risks. Do not write tests that merely repeat the implementation for low-impact, reversible changes. Add behavior tests when implementing mutations, version binding, path handling, or answer isolation.
- At handoff, state what changed, how it was verified, and what remains unimplemented or unverified. Never report an unrun check as passed.
