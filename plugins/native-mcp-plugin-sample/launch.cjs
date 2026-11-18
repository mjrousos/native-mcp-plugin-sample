const path = require("node:path");
const { spawn } = require("node:child_process");

const binaries = {
  "win32-x64": ["win32-x64", "server.exe"],
  "darwin-arm64": ["darwin-arm64", "server"],
  "darwin-x64": ["darwin-x64", "server"],
};

const platform = `${process.platform}-${process.arch}`;
const binary = binaries[platform];

if (!binary) {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

const executable = path.join(__dirname, "bin", ...binary);
const child = spawn(executable, process.argv.slice(2), {
  stdio: "inherit",
  shell: false,
});

child.once("error", (error) => {
  console.error(`Failed to start ${executable}: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Native MCP server terminated by ${signal}`);
  }
  process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.kill(signal)) {
      console.error(`Could not forward ${signal} to the native MCP server`);
      process.exitCode = 1;
    }
  });
}
