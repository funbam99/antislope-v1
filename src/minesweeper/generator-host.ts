import { lstat } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";

export async function assertNoKnownManagedConfig(paths?: string[]): Promise<void> {
  const locations = paths ?? [
    "/etc/codex/config.toml",
    "/etc/codex/managed_config.toml",
    "/etc/codex/requirements.toml",
    ...(process.platform === "darwin"
      ? [
          "/Library/Managed Preferences/com.openai.codex.plist",
          join("/Library/Managed Preferences", userInfo().username, "com.openai.codex.plist"),
        ]
      : []),
  ];
  if (!paths && process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("Unsupported generator host");
  for (const location of locations) {
    try {
      await lstat(location);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        continue;
      throw new Error("Generator host configuration unavailable");
    }
    throw new Error("Managed generator hosts are unsupported");
  }
}
