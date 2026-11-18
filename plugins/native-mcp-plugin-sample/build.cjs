const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const targets = [
  { goos: "windows", goarch: "amd64", directory: "win32-x64", file: "server.exe" },
  { goos: "darwin", goarch: "arm64", directory: "darwin-arm64", file: "server" },
  { goos: "darwin", goarch: "amd64", directory: "darwin-x64", file: "server" },
];

for (const target of targets) {
  const output = path.join(__dirname, "bin", target.directory, target.file);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync("go", ["build", "-trimpath", "-o", output, "."], {
    cwd: path.join(__dirname, "native"),
    env: {
      ...process.env,
      CGO_ENABLED: "0",
      GOOS: target.goos,
      GOARCH: target.goarch,
    },
    stdio: "inherit",
  });
  if (process.platform !== "win32" && target.goos !== "windows") {
    fs.chmodSync(output, 0o755);
  }
  console.log(`Built ${target.goos}/${target.goarch}: ${output}`);
}
