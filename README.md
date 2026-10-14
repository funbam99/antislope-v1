# Anti-Slope

### Careful human review of AI-generated work.

Read the code, question its behavior, and keep the evidence before asking someone else to review it.

[Quick start](#quick-start) · [How Minesweeper works](#how-minesweeper-works) · [What you can review](#what-you-can-review) · [FAQ](#faq) · [Documentation](#documentation)

---

**Minesweeper** is Anti-Slope's first product: code on the left, AI discussion on the right. Leave inline comments, explore counterexamples together, and turn the conversation into a review handoff.

An independent curator or AI context prepares an exercise with zero or one deliberate error, visible only in the review view. The collaborating AI receives the displayed code and your discussion, without the private mutation metadata or reference answers. Reveal is your decision; the original code can have problems too.

This is the **v0.1.0 research prototype**. Start with the bundled example, then review a TypeScript change from your own repository. The [repository](https://github.com/funbam99/antislope-v1) is public; clone it to try the prototype.

## Quick start

You need Node.js **22.22.2** ([.nvmrc](./.nvmrc)), npm **10+**, Git, and a modern browser. AI features also require an authenticated Codex CLI on an unmanaged macOS or Linux machine, using Codex's default provider. Native Windows, managed/MDM hosts, and custom provider/model configurations are unsupported in v1.

### Install the runtime

```sh
git clone https://github.com/funbam99/antislope-v1.git
cd antislope-v1
npm ci
npm run build
npm start -- doctor
```

If you use nvm, run `nvm install` and `nvm use` before `npm ci`. `doctor` checks Node.js, Git, and the current directory without changing anything; it does not check Codex login. `npm start` alone prints help.

### Connect AI

The tested Codex CLI version is **0.162.0-alpha.17.2**. For a reproducible first trial:

```sh
npm install -g @openai/codex@0.162.0-alpha.17.2
codex --version
codex -c 'cli_auth_credentials_store="file"' login
codex -c 'cli_auth_credentials_store="file"' login status
```

Complete the browser login with your own Codex-enabled account. Skip these setup steps if the compatible CLI and file-backed login are already configured. See the official [CLI](https://learn.chatgpt.com/docs/codex/cli) and [authentication](https://learn.chatgpt.com/docs/auth) guides.

Chat and counterexample workers copy existing file-backed credentials from `CODEX_HOME/auth.json` (normally `~/.codex/auth.json`) into a temporary private home. Keyring-only login is insufficient; keep that file private and never commit or share it. Incompatible CLI builds fail rather than weakening isolation.

Manual review works without Codex. AI chat, counterexamples, and independent generation require it and send selected code and explicitly shared discussion through the default provider.

### Try the example

```sh
node examples/minesweeper/create-example.mjs
```

The command creates a separate temporary repository and prints `root`, `repo`, `snapshot`, and `exercise` paths. Use the printed **repo** and **exercise** values:

```sh
npm start -- minesweeper review \
  --repo "<printed repo path>" \
  --exercise "<printed exercise path>"
```

Open the **Author review** URL printed in the terminal. Keep the terminal running and save its printed resume command. The server chooses the port; use its address rather than a fixed localhost URL.

Use the exercise path without opening its JSON: it contains private answers. Curator `validate --preview` is unnecessary for an author trying the example. This small demo illustrates the workflow; it is not a blinded research trial.

### Review your own change

Keep the target repository separate from this runtime checkout. Write its intended behavior in a requirements file outside the target repository, without reference answers or mutation suggestions. Select changed code and relevant supporting files:

```sh
node antislope/scripts/session.mjs run \
  --repo "/absolute/path/to/your-repository" \
  --base main \
  --file src/changed.ts \
  --file src/supporting.ts \
  --requirements-file "/outside/your-repository/requirements.txt"
```

Replace the paths and comparison branch; repeat `--file` for context. The helper prepares the exercise in an independent Codex context and prints preparation status followed by a reader URL. Open it and keep the terminal running. Keep selected files unchanged during preparation; remove the temporary requirements file afterward when appropriate.

For an assistant-led workflow, ask your coding assistant to load [antislope/SKILL.md](./antislope/SKILL.md) from this checkout. It routes code review to [Minesweeper](./antislope/minesweeper/SKILL.md). Cloning does not install a global skill.

## How Minesweeper works

Read a captured change, discuss what it does, then compare your findings with the exercise explanation. Target files stay untouched throughout.

1. **Read and comment.** Select code or double-click a word to leave an inline comment. Multi-line ranges are saved. Use **Add to Chat** or **Quote in chat** to bring code and comments into the composer. Enter sends; Shift+Enter adds a newline.
2. **Explore the doubt.** A saved comment automatically asks AI to derive a concrete counterexample and updates the review card in the conversation, including before reveal. AI reasoning is labeled **not executed**. Unclear or unsupported observations remain questions.
3. **Save the first pass.** Choose **Next Step → Submit first pass** after active AI work finishes. The existing comments and chat become the record; there is no extra form. **Hint** then becomes available. Runtime hints are displayed separately and excluded from AI context.
4. **Reveal when ready.** Use **Next Step** and the explicit reveal action. The left pane switches to captured clean code; exercise counts, locations, and initial references become available. Before reveal, review cards contain none of those details.
5. **Confirm and export.** Review the card, discuss the clean-code follow-up, then choose **Confirm review card → Export handoff**. No duplicate assessment fields are needed. Confirmation approves the record, not proof that a test ran. Changed comments or chat require reconfirmation; normal tests and fixes use clean code.

Replies stream, follow new output, and preserve your position when you scroll up. Drag the divider to resize the panes. Appearance, requirements/context, and **Usage & outcomes** are in the top-right menu.

## What you can review

| Input or feature   | V1 behavior                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript changes | 1–12 existing tracked UTF-8 `.ts` files, each up to 128 KiB and 2,000 lines; at least one selected file must differ from baseline. Added, deleted, and renamed files are unsupported. |
| Surrounding code   | Changes, Full file, and Baseline views for selected files. Unselected dependencies can be recorded as questions.                                                                      |
| Version changes    | `--base` fixes the merge-base and captured content. Later edits preserve a historical review; committing unchanged content does not invalidate it.                                    |
| Session recovery   | Server checkpoints retain the exercise, successful chat, and review stage. Browser storage retains comments, ranges, hints, counterexamples, and review messages.                     |
| Outcomes           | Local anonymous metadata and manual export/aggregation of completion, recorded issues, test handoffs, and unresolved questions. No personal scoring.                                  |

Mutations change displayed line contents only. V1 does not execute target code or offer an executable fork. AI counterexamples alone cannot become verified issues in clean code; unclear requirements and disputed references remain valid outcomes. Finding every deliberate error does not prove the change safe. Nothing is automatically posted to GitHub or sent to another person.

## FAQ

### Can I continue after closing the tab or restarting the service?

Yes. Stop the server with Ctrl-C, then run from this checkout:

```sh
npm start -- minesweeper resume --session "<SESSION_ID>"
```

Use the startup command's ID, or the 48-character path segment in the reader URL. Resume retains the original URL and port, which must be free. Reopen it in the **same browser profile** to reconnect browser-local records. Another profile has separate storage; clearing browser storage deletes its local copy. Failed or unfinished AI replies are not committed.

Private recovery files live under `~/.local/state/antislope/sessions/`. They contain captured code and answers: do not read them into a facilitating AI conversation, commit them, or upload them. Resume restores the existing exercise; sessions created before recovery support have no recoverable checkpoint.

### Why does doctor pass when AI is unavailable?

It checks the runtime environment, not Codex or provider access. Check `codex --version`, the file-backed login status command above, Codex on `PATH`, and account/network availability. Do not remove isolation flags to work around a failure. See [generation and isolation](./docs/minesweeper-skills.md).

### What if the exercise does not match my code?

Keep selected files frozen until the reader starts, or ask the curator/generator to prepare a fresh exercise. Author startup errors deliberately omit private locations. Do not inspect answers to diagnose them; curators have a separate [validation and preview workflow](./docs/minesweeper-exercises.md).

### Can we measure whether the pilot is useful?

Use **Usage & outcomes** to inspect and manually export local metadata. Records describe completion and reported outcomes, not individual ability or causal improvement. Use consistent anonymous participant IDs for aggregation; see the [metadata guide](./docs/minesweeper-metadata.md). Hint use, source code, comment text, chat, and exercise outcomes are excluded from these exports.

## Documentation

- [Project skill](./antislope/SKILL.md) — assistant entrypoint and routing.
- [Minesweeper skill](./antislope/minesweeper/SKILL.md) — code review workflow.
- [Generation and isolation](./docs/minesweeper-skills.md) — Codex workers, discussion context, streaming, and recovery.
- [Curated exercises](./docs/minesweeper-exercises.md) — snapshots, human preparation, validation, and preview.
- [Metadata](./docs/minesweeper-metadata.md) — local exports and internal aggregation.
- [Development rules](./AGENTS.md) — project boundaries and validation requirements.

For development, run `npm run check`, `npm run build`, and `npm test`. Private local working files and runtime artifacts are ignored by Git and unnecessary for installation or use.
