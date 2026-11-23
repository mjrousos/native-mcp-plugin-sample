import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@microsoft/copilot-sdk/extension";

// This file is three directories below the installed plugin root. Resolving
// from its URL keeps the binary path independent of the user's project.
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// These identifiers describe Copilot's extension process, not necessarily the
// physical machine (for example, an x64 process may run under Rosetta).
const binaries = {
  "win32-x64": ["win32-x64", "server.exe"],
  "darwin-arm64": ["darwin-arm64", "server"],
  "darwin-x64": ["darwin-x64", "server"],
};
const platform = `${process.platform}-${process.arch}`;
const binary = binaries[platform];
if (!binary) {
  throw new Error(`Unsupported platform: ${platform}`);
}

// Register the executable; do not spawn it here. Copilot starts the server
// when needed and manages its MCP stdio connection and process lifecycle.
await joinSession({
  mcp: {
    servers: {
      "native-platform-demo": {
        type: "stdio",
        command: join(pluginRoot, "bin", ...binary),
        tools: ["*"],
      },
    },
  },
});
