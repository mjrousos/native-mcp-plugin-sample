# Native MCP server in a cross-platform Copilot plugin

This sample packages three native executables in one Copilot plugin. A small
JavaScript **extension** selects the executable for the current OS and
architecture, then registers it as an MCP server for the session. Copilot runs
the extension using its managed JavaScript runtime, so plugin users do **not**
need to install Node.js or put `node` on PATH.

The dummy server is written in Go to make native cross-compilation easy, with no
external dependencies or platform-specific compiler toolchains. You can replace
its executables with any native MCP server that communicates over stdio.
End users do not need Go.

## How it works

```text
Marketplace selects plugins\native-mcp-plugin-sample
    |
    v
Copilot loads the plugin's extension for the session
    |
    | extension selects a bundled binary and registers it with joinSession()
    v
Copilot starts and manages the native stdio MCP server
    |
    v
The server provides native_platform through MCP tools/list and tools/call
```

1. The marketplace catalog points to the plugin directory. Its `plugin.json`
   identifies an Agent Plugins 1.0 plugin.
2. Copilot discovers
   `com.github.copilot\extensions\native-mcp\extension.mjs` in the plugin and
   runs it with Copilot's JavaScript runtime. Copilot also supplies the
   `@microsoft/copilot-sdk` import; the plugin does not install that package.
3. The extension resolves the installed plugin root from its own file URL, then
   selects an absolute binary path using `process.platform` and `process.arch`.
   The path does not depend on the user's current project directory.
4. The extension passes that path to `joinSession({ mcp: { servers: ... } })`.
   There is no direct plugin `mcp.json` and no separate JavaScript launcher.
5. Registration is enough: the extension does not spawn the binary or call
   `startServer`. Copilot manages the server process and its MCP stdio
   connection. It may start the server during discovery, before a tool is called.

The extension has no `extension.json` sidecar, so it starts eagerly and
registers the server when each session loads the enabled plugin. It reloads
when the foreground session is replaced, such as with `/clear`. The extension's
own stdout is used by its SDK connection; the native server gets its own stdio
connection to Copilot.

The server's `native_platform` tool returns the OS and architecture compiled
into the running Go executable. The Go implementation is a small protocol
demonstration, not a production MCP framework; use your existing MCP
implementation or SDK for a real server.

**Experimental:** Copilot CLI extensions and the SDK registration API are
experimental and may change. The plugin and extension must be enabled, and
experimental features must be on. This sample has been tested with Copilot CLI
on Windows x64; this exact technique has not been verified in Copilot App or
on macOS.

## Contents

```text
.github\
  plugin\
    marketplace.json
plugins\
  native-mcp-plugin-sample\
    plugin.json
    com.github.copilot\
      extensions\
        native-mcp\
          extension.mjs
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
| `plugins\native-mcp-plugin-sample\com.github.copilot\extensions\native-mcp\extension.mjs` | Selects a binary and registers the MCP server with the session. |
| `plugins\native-mcp-plugin-sample\bin` | Prebuilt native executables required at runtime. |
| `plugins\native-mcp-plugin-sample\native` | Dummy Go server source, needed only to rebuild the binaries. |
| `plugins\native-mcp-plugin-sample\build.cjs` | Cross-compiles the dummy server for the three configured targets. |
| `package.json` | Repository-root build and test commands; no third-party JS dependencies. |
| `test\server.test.cjs` | Tests marketplace linkage, extension registration, and the host-platform server. |

The executable paths below are relative to the plugin root.

| Extension process platform | Native executable |
| --- | --- |
| Windows x64 (`win32-x64`) | `bin\win32-x64\server.exe` |
| macOS Apple Silicon (`darwin-arm64`) | `bin\darwin-arm64\server` |
| macOS Intel (`darwin-x64`) | `bin\darwin-x64\server` |

Other platforms, including Linux and Windows ARM64 extension processes, fail
with an explicit diagnostic. Selection follows the architecture of Copilot's
extension process, not necessarily the physical machine: an x64 process
running under Rosetta on Apple Silicon selects the Intel binary.

## Install and try it in Copilot CLI

If you previously installed the plugin directly rather than from the
marketplace, uninstall that copy first with
`copilot plugin uninstall native-mcp-plugin-sample`.

Register the GitHub marketplace and install the plugin:

```powershell
copilot plugin marketplace add mjrousos/native-mcp-plugin-sample
copilot plugin install native-mcp-plugin-sample@native-mcp-samples
```

If you already installed the marketplace plugin, update it to get the extension:

```powershell
copilot plugin marketplace update native-mcp-samples
copilot plugin update native-mcp-plugin-sample@native-mcp-samples
```

Start a new session with experimental features enabled:

```powershell
copilot --experimental
```

Alternatively, run `/settings experimental on` in Copilot CLI and restart.
Make sure the plugin is enabled and `/extensions` reports an extension mode
other than `disabled`; `/extensions manage` shows individual extension status.

In the session, use `/mcp list` to check `native-platform-demo`, then ask:

> Call the native_platform tool and tell me which OS and architecture it reports.

The Windows x64 binary returns:

```text
Hello from a native MCP server! OS=windows ARCH=amd64
```

The macOS binaries report `OS=darwin` and either `ARCH=arm64` or `ARCH=amd64`.
All binaries are native executables; the extension does not implement the MCP
server. Because the extension registers the server at session runtime, inspect
it with `/mcp list` inside the session rather than relying on the shell command
`copilot mcp list`, which shows configuration.

To try local edits instead of the marketplace copy, first disable the installed
copy so the same server is not registered twice:

```powershell
copilot plugin disable native-mcp-plugin-sample@native-mcp-samples
```

Then run from `plugins\native-mcp-plugin-sample`:

```powershell
copilot --experimental --plugin-dir .
```

Afterward, restore the marketplace plugin with
`copilot plugin enable native-mcp-plugin-sample@native-mcp-samples`.

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

These are **developer** prerequisites, not plugin-user prerequisites: tests
require Node.js 22 or later; rebuilding also requires Go 1.22 or later. Run from
the repository root:

```powershell
npm run build
npm test
```

The build produces Windows x64, macOS ARM64, and macOS x64 binaries using Go's
cross-compiler with CGO disabled. No platform SDKs or downloaded modules are
needed. Each binary is self-contained.

The tests replace only the SDK connection with a test stub to check all three
extension mappings, paths containing spaces, and unsupported platforms. They
also run the host-platform native binary from a different working directory and
exercise initialization, tool discovery and invocation, ping, malformed input,
and error handling. On a host without a bundled binary, the native protocol
tests are explicitly skipped.

The server supports protocol versions `2024-11-05`, `2025-06-18`, and
`2025-11-25`. For other requested versions it proposes `2025-11-25`; the client
must support that version to continue. It deliberately does not negotiate
`2025-03-26`, which requires JSON-RPC batching that this sample does not implement.

The automated tests do not require authentication or model requests. With
Copilot CLI 1.0.115-3 on Windows x64, a local marketplace installation and a
relocated plugin both registered and called the native server with `node` absent
from Copilot's PATH. The macOS binaries can be cross-compiled on Windows, but
must also be tested on macOS.

## Apply this technique to your own native MCP server

The paths in these steps are relative to the plugin directory,
`plugins\native-mcp-plugin-sample`.

1. **Build your native releases.** Produce one executable for each OS and CPU
   architecture you support using your server's build system and toolchains.
2. **Copy the releases into `bin`.** Replace the existing files or update the
   `binaries` mapping in `extension.mjs`. Include any required DLLs, shared
   libraries, and resource files. The sample's Go binaries are self-contained,
   but that is not necessarily true of other native binaries.
3. **Keep the extension and register your server.** Change the
   `native-platform-demo` key in the `joinSession` call to your server's name;
   tool names still come from your server's `tools/list` response. Keep
   `type: "stdio"` and set `command` to the selected absolute binary path.
   Update the plugin name, version, and description in both `plugin.json` and
   the marketplace catalog.
4. **Supply startup options if needed.** The server configuration can include
   `args`, `env`, and `workingDirectory`. For example, the following properties
   could be added alongside `type` and `command` if your server needs them:

   ```javascript
   args: ["--transport", "stdio"],
   workingDirectory: pluginRoot,
   env: { EXAMPLE_SETTING: "value" },
   ```

   These options are illustrative; the dummy server does not need them.
5. **Replace the sample-only build and tests.** `npm run build` overwrites the
   binaries with the Go dummy server. Update or remove `build.cjs`, the `native`
   sources, and the build command, and adapt the tests to your server.
6. **Test and distribute the whole plugin.** Exercise registration, discovery,
   and a tool call on every supported OS and architecture. Preserve executable
   permissions, handle signing and native dependencies, and include the
   extension and binaries in the marketplace plugin.

To add another platform, include its native executable and add a mapping to
`binaries`. For example, a Linux x64 build in `bin\linux-x64\server` needs:

```javascript
"linux-x64": ["linux-x64", "server"],
```

If you are still using the Go sample, also extend the build script's `targets`
array with `goos: "linux"` and `goarch: "amd64"`. Node calls the architecture
`x64`, whereas Go calls that target `amd64`. A mapping alone does not produce
the binary or make it compatible with every Linux distribution.

Keep native server diagnostics on stderr: its stdout is reserved for MCP
JSON-RPC messages. Copilot owns the server process, so do not spawn the server
from the extension or connect it to the extension's stdio.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Extension or server is missing | Start a new session with experimental features enabled; check that the plugin and extension are enabled in `/plugin` and `/extensions manage`. |
| `Unsupported platform` | Check the Copilot extension process's OS/architecture and add a matching executable and mapping. |
| Server fails to start | Confirm the selected binary and any required runtime loader are present in the installed plugin. Inspect `/mcp list` for the failure. |
| Permission denied on macOS | Restore executable permissions and check the platform's signing/quarantine diagnostics. |
| Server starts but MCP fails | Keep stdout protocol-only, use stdio mode, and inspect stderr for native dependency or startup errors. |
| Local edits are not reflected | Use `--plugin-dir` from the plugin directory in a new session, or publish changes and update the marketplace plugin. |

## References

- [Creating a Copilot CLI extension](https://docs.github.com/en/copilot/tutorials/create-an-extension)
- [Creating a Copilot CLI plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating and sharing a plugin marketplace](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/create-and-share-plugin-marketplaces)
- [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
