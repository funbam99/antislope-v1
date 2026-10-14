import { captureSnapshot } from "./snapshot.js";
import { generateExercise } from "./generator.js";
import { ReviewSession } from "./session.js";
import { startServer } from "./server.js";

export async function startSkillSession(input: {
  repo: string;
  base: string;
  files: string[];
  requirements: string;
  executable?: string;
  signal?: AbortSignal;
}): Promise<{ url: string; close(): Promise<void> }> {
  const snapshot = captureSnapshot(input.repo, input.base, input.files);
  const options = {
    ...(input.executable ? { executable: input.executable } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
  const exercise = await generateExercise(snapshot, input.requirements, options);
  if (input.signal?.aborted) throw new Error("Session cancelled.");
  return startServer(new ReviewSession(snapshot, exercise, input.repo), {
    ...options,
    persistent: true,
  });
}
