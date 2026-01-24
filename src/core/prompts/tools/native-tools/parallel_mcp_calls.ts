import type OpenAI from "openai"

const PARALLEL_MCP_CALLS_DESCRIPTION = `Execute multiple MCP tool calls in parallel for faster batch operations. This tool is useful for batch position adjustments, color changes, or any repeated MCP operations that can run simultaneously.`

const SERVER_PARAMETER_DESCRIPTION = `The MCP server name to use (e.g., "figma-write").`

const CALLS_PARAMETER_DESCRIPTION = `A JSON array of MCP tool calls. Each call should have:
- tool: (required) The MCP tool name (e.g., "set_position", "set_fill")
- args: (required) Object containing the tool arguments

Example:
[
  { "tool": "set_position", "args": { "nodeId": "123:456", "x": 100, "y": 200 } },
  { "tool": "set_position", "args": { "nodeId": "123:789", "x": 200, "y": 200 } }
]`

export default {
	type: "function",
	function: {
		name: "parallel_mcp_calls",
		description: PARALLEL_MCP_CALLS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				server: {
					type: "string",
					description: SERVER_PARAMETER_DESCRIPTION,
				},
				calls: {
					type: "string",
					description: CALLS_PARAMETER_DESCRIPTION,
				},
			},
			required: ["server", "calls"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
