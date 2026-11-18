# Native MCP server in a cross-platform Copilot plugin

This sample packages three native executables in one plugin. A small JavaScript
launcher chooses the executable using `process.platform` and `process.arch`, then
connects its standard input/output directly to Copilot's MCP transport.

The dummy server is written in Go to make native cross-compilation easy, with no
external dependencies or platform-specific compiler toolchains. You can replace
its executables with any native stdio MCP server, regardless of implementation
language. End users do not need Go.

## The problem this solves

Native MCP servers often ship separate executables for different operating
systems and CPU architectures. This sample bundles Windows x64, macOS Apple
Silicon, and macOS Intel builds so users can install one plugin rather than
choose a different plugin for each platform.

An MCP server configuration specifies a command to launch; it does not select
between OS-specific commands for you. This sample makes that one command
`node launch.cjs`. The launcher selects the native executable at runtime. All
three binaries are shipped together, but only the selected one runs.

The reusable technique is **a platform-neutral entry point in front of
platform-specific executables**. Your MCP implementation stays native: there is
no need to rewrite it in JavaScript, wrap each of its tools, or run an HTTP
service. This example specifically assumes your server supports MCP over stdio.

## How the pieces connect

```text
Marketplace catalog selects plugins\native-mcp-plugin-sample
    |
    v
Copilot reads plugin.json and mcp.json
    |
    | starts node with the installed plugin's launch.cjs
    v
JavaScript launcher reads OS + architecture
    |
    | starts exactly one executable with inherited stdio
    v
Native MCP server handles initialize, tools/list, and tools/call
```

1. The marketplace catalog points to the plugin directory, where `plugin.json`
   identifies an Agent Plugins 1.0 plugin and `mcp.json` supplies its MCP server
   configuration.
2. The MCP configuration names `node` as the executable and passes
   `${PLUGIN_ROOT}/launch.cjs` as its first argument. Copilot resolves
   `${PLUGIN_ROOT}` to this plugin's installed location, so users do not need to
   edit absolute paths after installation.
3. `launch.cjs` looks up a binary using Node's OS and architecture identifiers.
   It builds the executable path with `path.join(__dirname, ...)`, so path
   separators and spaces are handled without shell quoting. The binary path is
   independent of whichever project directory the user opened.
4. `spawn(..., { stdio: "inherit", shell: false })` connects the native
   process to the same input/output streams Copilot gave the launcher.
   MCP JSON-RPC messages pass directly between Copilot and the native server.
   The launcher does not parse, translate, or proxy those messages in JavaScript.
5. The launcher stays alive while its child runs, reports launch failures on
   stderr, and propagates the child's exit code. The native server owns tool
   discovery and execution.

In the dummy server, `native_platform` takes no arguments and returns the OS and
architecture compiled into the running Go executable. That response demonstrates
that a native binary, rather than the JavaScript launcher, handled the tool call.
The Go implementation is a small protocol demonstration, not a production MCP
framework; use your existing MCP implementation or SDK for a real server.

The dummy server supports protocol versions `2024-11-05`, `2025-06-18`, and
`2025-11-25`. For other requested versions it proposes `2025-11-25`; the client
must support that version to continue. It deliberately does not negotiate
`2025-03-26`, which requires JSON-RPC batching that this sample does not implement.

## Important: Node.js is required on PATH

**Install Node.js 22 or later separately before using this sample.** Its
`mcp.json` explicitly launches `"command": "node"`. That command must be
discoverable on the PATH inherited by the Copilot process.

Copilot CLI's standalone executable can contain its own JavaScript runtime
without exposing a general-purpose `node` command. Installing Copilot CLI or
Copilot App therefore does not guarantee this prerequisite is satisfied.
Restart the terminal or app after installing Node or changing PATH.

This is an MCP plugin, **not a Copilot JavaScript extension**. CLI extensions
are launched through Copilot's managed runtime; that mechanism does not apply
to this plugin's MCP `command`. No `npm install` is needed for this sample.

## Contents

```text
.github\
  plugin\
    marketplace.json
plugins\
  native-mcp-plugin-sample\
    plugin.json
    mcp.json
    launch.cjs
    bin\
      win32-x64\server.exe
      darwin-arm64\server
      darwin-x64\server
    native\
      go.mod
      main.go
    build.cjs
package.json
test\
  server.test.cjs
```

| File or directory | Responsibility |
| --- | --- |
| `.github\plugin\marketplace.json` | Lists the plugin and its repository-relative source. |
| `plugins\native-mcp-plugin-sample\plugin.json` | Plugin identity, version, and format declaration. |
| `plugins\native-mcp-plugin-sample\mcp.json` | Registers the stdio server and launches the JavaScript entry point. |
| `plugins\native-mcp-plugin-sample\launch.cjs` | Selects and starts a bundled executable; required at runtime. |
| `plugins\native-mcp-plugin-sample\bin` | Prebuilt native executables; required at runtime. |
| `plugins\native-mcp-plugin-sample\native` | Dummy Go server source; needed only to rebuild the sample binaries. |
| `plugins\native-mcp-plugin-sample\build.cjs` | Cross-compiles the dummy server for the three configured targets. |
| `package.json` | Repository-root build/test commands; no third-party JS dependencies. |
| `test\server.test.cjs` | Checks the marketplace entry and exercises the real launcher and host-platform binary. |

The executable paths below are relative to `plugins\native-mcp-plugin-sample`.

| Launcher platform | Native executable |
| --- | --- |
| Windows x64 (`win32-x64`) | `bin\win32-x64\server.exe` |
| macOS Apple Silicon (`darwin-arm64`) | `bin\darwin-arm64\server` |
| macOS Intel (`darwin-x64`) | `bin\darwin-x64\server` |

Other platforms, including Linux and Windows ARM64 Node processes, fail with an
explicit diagnostic. Architecture follows the Node process: an x64 Node running
under Rosetta on Apple Silicon selects the Intel binary.

## Try it in Copilot CLI

Confirm `node --version` works in the environment that starts Copilot. If you
previously installed the plugin directly, first uninstall that copy with
`copilot plugin uninstall native-mcp-plugin-sample`.

Register the GitHub marketplace and install the plugin:

```powershell
copilot plugin marketplace add mjrousos/native-mcp-plugin-sample
copilot plugin install native-mcp-plugin-sample@native-mcp-samples
```

Then start a new session. To load local edits for just one CLI session instead,
run this from the plugin directory `plugins\native-mcp-plugin-sample`:

```powershell
copilot --plugin-dir .
```

Use `/mcp` to confirm `native-platform-demo` connected. Ask:

> Call the native_platform tool and tell me which OS and architecture it reports.

The Windows x64 binary returns:

```text
Hello from a native MCP server! OS=windows ARCH=amd64
```

The macOS binaries report `OS=darwin` and either `ARCH=arm64` or `ARCH=amd64`.
All binaries are real native executables; the JavaScript launcher does not
implement the MCP server itself.

Plugin configuration uses Agent Plugins 1.0. `${PLUGIN_ROOT}` resolves the
installed plugin's location, and the launcher resolves binaries relative to
itself, not the user's working directory. Copilot manages the server process;
this is not an install hook or a background daemon.

## macOS distribution

When copying from Windows, preserve or restore executable permissions for
**both** macOS binaries. In a macOS terminal, from the repository root:

```bash
cd plugins/native-mcp-plugin-sample
chmod +x bin/darwin-arm64/server bin/darwin-x64/server
```

For Git distribution, record their executable bits in the Git index. For archive
distribution, create an archive that preserves Unix permissions. These locally
built sample binaries are not Developer ID signed or notarized; production
distribution must account for your normal macOS signing and Gatekeeper workflow.

## Rebuild and test

Rebuilding requires Go 1.22 or later and Node.js 22 or later. Run from the
repository root:

```powershell
npm run build
npm test
```

The build produces Windows x64, macOS ARM64, and macOS x64 binaries using Go's
cross-compiler with CGO disabled. No platform SDKs or downloaded modules are
needed. Each binary is self-contained.

The tests verify that the marketplace points to the plugin and its MCP launcher.
They also launch the actual server through `launch.cjs`, exercise initialization,
protocol-version negotiation, tool discovery, a tool call, ping, malformed input,
and error handling, and check the missing-binary diagnostic. They execute the
binary for the current host; cross-compiling a macOS binary on Windows does not
prove it runs on macOS.

Build metadata can be inspected with `go version -m` followed by a binary's path.

### Validation performed

- `npm run build`: passed in an isolated copy; produced all three native binaries.
- `npm test`: passed five tests on Windows x64, including a marketplace
  configuration check and a regression test for `2025-03-26` negotiation.
- `go vet .` from `plugins\native-mcp-plugin-sample\native`: passed.
- `go version -m` for each binary: confirmed Windows AMD64, macOS ARM64, and
  macOS AMD64 target metadata, all with CGO disabled.
- Copilot CLI discovery via `--plugin-dir` and
  `mcp get native-platform-demo --json`: passed; Copilot discovered the enabled
  plugin MCP configuration.
- Copilot CLI marketplace registration and installation passed from local and
  Git-backed test marketplaces; a tool call through the installed plugin passed.

The protocol tests run locally without model requests or authentication.
The macOS binaries were cross-compiled, not executed on this Windows machine.
Copilot App was not tested.

## Apply this technique to your own native MCP server

The paths in these steps are relative to the plugin directory,
`plugins\native-mcp-plugin-sample`.

1. **Build your native releases.** Produce one executable for each OS and CPU
   architecture you support, using your implementation's build system and
   toolchains.
   The Go cross-compilation script is only a convenience for this dummy server;
   replace it with the build process appropriate for your server.
2. **Copy the releases into `bin`.** Replace the existing files, or change the
   `binaries` mapping in `launch.cjs` to match your directory and executable
   names. Include any required DLLs, shared libraries, and resource files using
   the layout your application expects. This sample's Go binaries do not need
   those dependencies, but that is not necessarily true of other native binaries.
3. **Keep the launcher and MCP configuration.** Retain `type: "stdio"`,
   `command: "node"`, and the plugin-root-relative launcher argument. Change
   `plugin.json`'s name, version, and description for your package, and rename
   the `native-platform-demo` entry in `mcp.json` as appropriate. That entry is
   the server's configuration name; tool names still come from your server's
   `tools/list` response.
4. **Supply your server's startup options.** Put extra arguments after the
   launcher path in `mcp.json`; the launcher forwards them unchanged. Use the
   server entry's `env` for configuration variables and `cwd` if your server
   requires a particular working directory. Do not assume the user's project
   directory is the plugin directory.
5. **Replace the sample-only build and tests.** Do not run `npm run build`
   after copying your own binaries: it overwrites them with the Go dummy server.
   Update or remove `build.cjs`, the `native` sources, and the build command.
   Adapt the protocol tests to your server's actual tools and expected results.
6. **Test and distribute the whole plugin.** Exercise initialization, discovery,
   and a tool call on every supported OS/architecture. Preserve executable
   permissions, handle signing and native dependencies, and document the Node
   prerequisite. Update the marketplace catalog to point to your plugin
   directory and include its binaries; consumers should not need your compiler.

For example, if your server accepts `--transport stdio`, replace its server entry
in `mcp.json` with the following. These flags are illustrative: the dummy server
does not need them, and your server may use different options.

```json
{
  "type": "stdio",
  "command": "node",
  "args": ["${PLUGIN_ROOT}/launch.cjs", "--transport", "stdio"],
  "cwd": "${PLUGIN_ROOT}"
}
```

To add another platform, add both a native executable and a launcher mapping.
For example, a Linux x64 build in `bin\linux-x64\server` needs this entry in
`binaries`:

```javascript
"linux-x64": ["linux-x64", "server"],
```

If you are still using the Go sample, also extend the build script's `targets`
array with `goos: "linux"` and `goarch: "amd64"`. Node calls the architecture
`x64`, whereas Go calls that same target `amd64`. Simply adding a mapping does
not produce the binary or make it compatible with every Linux distribution.

The launcher passes additional arguments through, inherits the environment, and
does not invoke a shell. Keep diagnostic messages on stderr: stdout is reserved
for newline-delimited MCP JSON-RPC messages. On EOF the dummy server exits, and
the launcher propagates its exit code.

Signal forwarding is platform-dependent. The launcher registers SIGINT and
SIGTERM handlers and attempts to forward signals that Node can deliver to those
handlers. On Windows, programmatic SIGTERM terminates the launcher without
running its handler. Forcibly terminating the wrapper does not guarantee that its
native child terminates, especially if the child's stdin remains open. EOF
shutdown works for this dummy server, but any replacement server must implement
its own appropriate shutdown behavior. Guaranteed process-tree cleanup would
require additional platform-specific supervision, which is outside this sample.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Copilot cannot find `node` | Install Node and confirm it is on the PATH inherited by the Copilot process, not just another terminal. |
| `Unsupported platform` | Check the Node process's OS/architecture and add a matching executable and launcher mapping. |
| `Failed to start ... ENOENT` | Confirm the selected binary and any required runtime loader are present in the installed copy. |
| Permission denied on macOS | Restore executable permissions and check the platform's signing/quarantine diagnostics. |
| Server starts but MCP fails | Keep stdout protocol-only, use stdio mode, and inspect stderr for native dependency or startup errors. |
| Local edits are not reflected | Use `--plugin-dir` from the plugin directory in a new session, or publish changes and update the marketplace plugin. |

This example verifies the technique with Copilot CLI. It does not establish
Copilot App compatibility; confirm the target client's plugin-format and stdio
MCP support before distributing it there.

## References

- [Creating a Copilot CLI plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating and sharing a plugin marketplace](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/create-and-share-plugin-marketplaces)
- [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
