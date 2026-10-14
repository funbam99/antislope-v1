import { readFile } from "node:fs/promises";
import { summarizeMetadata } from "../dist/minesweeper/metadata.js";
const files = process.argv.slice(2);
if (!files.length || files.includes("--help")) {
  console.log(
    "Usage: npm run metadata:summary -- <metadata.json> [more-files.json ...]\nRead local exports, deduplicate session revisions, and print aggregate JSON. No uploads.",
  );
  if (!files.length) process.exitCode = 2;
} else {
  try {
    const inputs = await Promise.all(
      files.map(async (file) => {
        const bytes = await readFile(file);
        if (bytes.length > 8 * 1024 * 1024) throw new Error("Too large");
        return JSON.parse(bytes.toString("utf8"));
      }),
    );
    console.log(JSON.stringify(summarizeMetadata(inputs), null, 2));
  } catch {
    console.error(
      "Metadata could not be summarized. Check export schema, file size, and conflicting revisions.",
    );
    process.exitCode = 1;
  }
}
