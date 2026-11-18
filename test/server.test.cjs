const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const pluginRoot = path.join(root, "plugins", "native-mcp-plugin-sample");
const launcher = path.join(pluginRoot, "launch.cjs");

function exchange(messages, entrypoint = launcher) {
  return spawnSync(process.execPath, [entrypoint], {
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

test("marketplace entry resolves to the tested plugin and MCP launcher", () => {
  const marketplace = JSON.parse(fs.readFileSync(
    path.join(root, ".github", "plugin", "marketplace.json"), "utf8",
  ));
  const entry = marketplace.plugins.find((plugin) => plugin.name === "native-mcp-plugin-sample");
  assert.ok(entry, "marketplace must list the sample plugin");
  assert.equal(path.resolve(root, entry.source), pluginRoot);

  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
  assert.equal(entry.name, manifest.name);
  assert.equal(entry.version, manifest.version);

  const mcp = JSON.parse(fs.readFileSync(path.join(pluginRoot, "mcp.json"), "utf8"));
  const server = mcp.mcpServers["native-platform-demo"];
  assert.equal(server.command, "node");
  assert.equal(path.resolve(server.args[0].replace("${PLUGIN_ROOT}", pluginRoot)), launcher);
});

test("launcher completes an MCP exchange from a different working directory", () => {
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

test("server negotiates a supported version instead of the batching-required version", () => {
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

test("server reports malformed requests and tool errors without corrupting stdout", () => {
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

test("launcher reports missing binaries on stderr with a failing exit code", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "native mcp sample "));
  try {
    const isolatedLauncher = path.join(temporary, "launch.cjs");
    fs.copyFileSync(launcher, isolatedLauncher);
    const result = exchange([request(1, "ping")], isolatedLauncher);
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Failed to start .*ENOENT/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
