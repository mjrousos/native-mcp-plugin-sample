const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const pluginRoot = path.join(root, "plugins", "native-mcp-plugin-sample");
const extensionPath = ["com.github.copilot", "extensions", "native-mcp", "extension.mjs"];
const extension = path.join(pluginRoot, ...extensionPath);
const binaries = {
  "win32-x64": ["win32-x64", "server.exe"],
  "darwin-arm64": ["darwin-arm64", "server"],
  "darwin-x64": ["darwin-x64", "server"],
};
const hostPlatform = `${process.platform}-${process.arch}`;
const hostBinary = binaries[hostPlatform] && path.join(pluginRoot, "bin", ...binaries[hostPlatform]);
const hostOnly = { skip: hostBinary ? false : `No native binary bundled for ${hostPlatform}` };

function exchange(messages) {
  return spawnSync(hostBinary, [], {
    cwd: os.tmpdir(),
    input: messages.map((message) => typeof message === "string" ? message : JSON.stringify(message)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 15000,
  });
}

function request(id, method, params) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

function responses(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

test("marketplace entry resolves to the plugin with a Copilot extension", () => {
  const marketplace = JSON.parse(fs.readFileSync(
    path.join(root, ".github", "plugin", "marketplace.json"), "utf8",
  ));
  const entry = marketplace.plugins.find((plugin) => plugin.name === "native-mcp-plugin-sample");
  assert.ok(entry, "marketplace must list the sample plugin");
  assert.equal(path.resolve(root, entry.source), pluginRoot);

  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
  assert.equal(entry.name, manifest.name);
  assert.equal(entry.version, manifest.version);
  assert.ok(fs.existsSync(extension), "plugin must include the extension");
  assert.equal(fs.existsSync(path.join(pluginRoot, "mcp.json")), false);
});

test("extension registers the matching native binary and rejects unsupported platforms", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "native mcp sample "));
  try {
    const installedRoot = path.join(temporary, "installed plugin");
    const installedExtension = path.join(installedRoot, ...extensionPath);
    fs.mkdirSync(path.dirname(installedExtension), { recursive: true });
    fs.copyFileSync(extension, installedExtension);

    // Replace only the SDK connection, so the real extension runs unchanged.
    const sdk = path.join(installedRoot, "node_modules", "@microsoft", "copilot-sdk");
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, "package.json"), JSON.stringify({
      type: "module",
      exports: { "./extension": "./extension.mjs" },
    }));
    fs.writeFileSync(path.join(sdk, "extension.mjs"), `
      export async function joinSession(options) {
        console.log(JSON.stringify(options));
      }
    `);

    const runExtension = (platform, arch) => spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `
        import { pathToFileURL } from "node:url";
        await import("node:path");
        Object.defineProperty(process, "platform", { value: process.argv[1] });
        Object.defineProperty(process, "arch", { value: process.argv[2] });
        await import(pathToFileURL(process.argv[3]).href);
      `,
      platform,
      arch,
      installedExtension,
    ], { cwd: os.tmpdir(), encoding: "utf8", timeout: 15000 });

    for (const [platform, binary] of Object.entries(binaries)) {
      const [osName, arch] = platform.split("-");
      const result = runExtension(osName, arch);
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), {
        mcp: {
          servers: {
            "native-platform-demo": {
              type: "stdio",
              command: path.join(installedRoot, "bin", ...binary),
              tools: ["*"],
            },
          },
        },
      });
      assert.ok(fs.existsSync(path.join(pluginRoot, "bin", ...binary)), `${platform} binary is missing`);
    }

    for (const [platform, arch] of [["linux", "x64"], ["win32", "arm64"]]) {
      const result = runExtension(platform, arch);
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(`Unsupported platform: ${platform}-${arch}`));
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("native server completes an MCP exchange from a different working directory", hostOnly, () => {
  const replies = responses(exchange([
    request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "sample-test", version: "1.0.0" },
    }),
    { jsonrpc: "2.0", method: "notifications/initialized" },
    request(2, "tools/list"),
    request(3, "tools/call", { name: "native_platform", arguments: {} }),
    request(4, "ping"),
  ]));
  assert.deepEqual(replies.map((reply) => reply.id), [1, 2, 3, 4]);
  assert.equal(replies[0].result.protocolVersion, "2025-06-18");
  assert.deepEqual(replies[0].result.capabilities, { tools: {} });
  assert.equal(replies[1].result.tools[0].name, "native_platform");
  const goOS = process.platform === "win32" ? "windows" : process.platform;
  const goArch = process.arch === "x64" ? "amd64" : process.arch;
  assert.equal(
    replies[2].result.content[0].text,
    `Hello from a native MCP server! OS=${goOS} ARCH=${goArch}`,
  );
  assert.equal(replies[2].result.isError, false);
  assert.deepEqual(replies[3].result, {});
});

test("server negotiates a supported version instead of the batching-required version", hostOnly, () => {
  const replies = responses(exchange([
    request(1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "sample-test", version: "1.0.0" },
    }),
  ]));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 1);
  assert.equal(replies[0].result.protocolVersion, "2025-11-25");
});

test("server reports malformed requests and tool errors without corrupting stdout", hostOnly, () => {
  const replies = responses(exchange([
    "{",
    request(1, "missing-method"),
    request(2, "tools/call", { name: "missing-tool" }),
    request(3, "tools/call", { name: "native_platform", arguments: { unexpected: true } }),
    request(4, "ping"),
  ]));
  assert.deepEqual(replies.slice(0, 4).map((reply) => reply.error.code), [
    -32700, -32601, -32602, -32602,
  ]);
  assert.equal(replies[0].id, null);
  assert.deepEqual(replies[4].result, {});
});
