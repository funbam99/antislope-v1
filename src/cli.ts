#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { runMinesweeper } from "./minesweeper/commands.js";

const help = `Anti-Slope — Minesweeper curated review prototype

Usage:
  npm run dev -- --help
  npm run dev -- doctor
  npm run dev -- minesweeper snapshot --repo <dir> --base <ref> --file <path> [--file <path> ...]
  npm run dev -- minesweeper validate --snapshot <json> --exercise <json> [--preview]
  npm run dev -- minesweeper review --repo <dir> --exercise <json>
  npm run dev -- minesweeper resume --session <id>

Commands:
  doctor      Check Node.js, Git, and the current directory (read-only)
  minesweeper Prepare or review a curated TypeScript exercise locally
  --help, -h  Show this help

Minesweeper is Anti-Slope's first product, focused on author self-review.
Snapshot exports contain source code. Curator validation shows private diagnostics.
Author review keeps mutations virtual and answers private until reveal.
Review sessions are saved in private local storage; resume reuses the original URL.
The author browser starts displayed-code AI discussion through the installed Codex CLI.
No target-code execution, scoring, or automatic review posting is provided.
See README.md for the project overview and development status.
`;

function doctor(): number {
  let healthy = true;
  const report = (ok: boolean, message: string): void => {
    console.log(`[${ok ? "ok" : "error"}] ${message}`);
    healthy &&= ok;
  };

  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  const supportedNode = major === 22 && (minor > 22 || (minor === 22 && patch >= 2));
  report(supportedNode, `Node.js ${process.versions.node} (required: >=22.22.2 <23)`);

  const git = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 5000 });
  report(git.status === 0, git.status === 0 ? git.stdout.trim() : "Git is unavailable");

  try {
    const directory = process.cwd();
    accessSync(directory, constants.R_OK);
    report(statSync(directory).isDirectory(), `Working directory: ${directory}`);
  } catch {
    report(false, "The current working directory cannot be read");
  }

  if (git.status === 0) {
    const repository = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5000,
    });
    console.log(
      repository.status === 0
        ? `[info] Git repository: ${repository.stdout.trim()}`
        : "[info] This directory is not inside a Git repository",
    );
  }

  console.log("No files or Git settings were changed.");
  return healthy ? 0 : 1;
}

const args = process.argv.slice(2);
const command = args[0];

if (args.length === 0 || (args.length === 1 && (command === "--help" || command === "-h"))) {
  console.log(help);
} else if (args.length === 1 && command === "doctor") {
  process.exitCode = doctor();
} else if (command === "minesweeper") {
  process.exitCode = await runMinesweeper(args.slice(1));
} else {
  console.error("Unsupported command or arguments. Run with --help for available commands.");
  process.exitCode = 2;
}
