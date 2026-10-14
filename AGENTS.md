# Anti-Slope Development Rules

## Project and current scope

Read `README.md` first. Anti-Slope is the project exploring tools and workflows for careful human review of AI-generated work, including code and design documents. Minesweeper is its first product, not another name for the project.

Use English for repository documentation, code comments, CLI text, commit messages, and other project-facing content. `brainstorm.md` is a private, local-only working document: never commit, upload, or publish it, and do not make repository documentation or development depend on its presence.

Minesweeper's primary use case is an author voluntarily reviewing AI-generated code before asking someone else to review it. Product proposals are not implemented features; documentation and CLI help must describe the actual state accurately.

The current implementation is a Node.js 22, npm, and TypeScript ESM research prototype. The CLI supports `--help`, the read-only `doctor` command, and Minesweeper snapshot, curator validate/preview, and local browser review commands. The two-column code/chat view uses a blind, private AI conversation with local session recovery, virtual injection, staged answer disclosure, historical snapshots, annotations, and explicit handoff export. Repository skill entrypoints route through a bundled helper that runs independent, experimental Codex exercise generation and the existing UI. Executable forks and target-code execution are not implemented. Do not introduce frameworks or create unrelated skills as incidental setup work.

## Required Minesweeper boundaries

- **Virtual mutations:** Replace line contents only in the review view, without adding or removing lines. Preserve mappings to the clean version's line numbers. Never modify the target repository or workspace to plant deliberate bugs, and never rely on users to restore files manually.
- **Answer isolation:** Mutation patches, reference answers, and random seeds belong to the exercise generator. Do not embed them in reader-accessible pages or data responses before their reveal stage. Provide reveal data only at the appropriate stage. Never use the mutated version as the basis for subsequent fixes or code generation.
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
