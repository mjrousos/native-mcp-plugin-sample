package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
)

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

func failure(id json.RawMessage, code int, message string) response {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	return response{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: message}}
}

func handle(call request) response {
	result := response{JSONRPC: "2.0", ID: call.ID}
	switch call.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		if err := json.Unmarshal(call.Params, &params); err != nil {
			return failure(call.ID, -32602, "Invalid initialize parameters")
		}
		version := params.ProtocolVersion
		switch version {
		case "2024-11-05", "2025-06-18", "2025-11-25":
		default:
			version = "2025-11-25"
		}
		result.Result = map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo": map[string]string{
				"name": "native-platform-demo", "version": "1.0.0",
			},
		}
	case "ping":
		result.Result = map[string]any{}
	case "tools/list":
		result.Result = map[string]any{
			"tools": []any{map[string]any{
				"name":        "native_platform",
				"description": "Report the OS and architecture of this native MCP server binary.",
				"inputSchema": map[string]any{
					"type": "object", "properties": map[string]any{}, "additionalProperties": false,
				},
			}},
		}
	case "tools/call":
		var params struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(call.Params, &params); err != nil {
			return failure(call.ID, -32602, "Invalid tool call parameters")
		}
		if params.Name != "native_platform" {
			return failure(call.ID, -32602, "Unknown tool: "+params.Name)
		}
		if len(params.Arguments) != 0 {
			return failure(call.ID, -32602, "native_platform takes no arguments")
		}
		result.Result = map[string]any{
			"content": []any{map[string]string{
				"type": "text",
				"text": fmt.Sprintf("Hello from a native MCP server! OS=%s ARCH=%s", runtime.GOOS, runtime.GOARCH),
			}},
			"isError": false,
		}
	default:
		return failure(call.ID, -32601, "Method not found: "+call.Method)
	}
	return result
}

func serve(input io.Reader, output io.Writer) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	encoder := json.NewEncoder(output)
	for scanner.Scan() {
		var call request
		var reply response
		if err := json.Unmarshal(scanner.Bytes(), &call); err != nil {
			reply = failure(nil, -32700, "Parse error")
		} else if call.JSONRPC != "2.0" || call.Method == "" {
			reply = failure(call.ID, -32600, "Invalid request")
		} else if len(call.ID) == 0 {
			// MCP notifications, including notifications/initialized, have no response.
			continue
		} else {
			reply = handle(call)
		}
		if err := encoder.Encode(reply); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func main() {
	if err := serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
