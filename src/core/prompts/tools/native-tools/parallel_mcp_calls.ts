import type OpenAI from "openai"

const PARALLEL_MCP_CALLS_DESCRIPTION = `Execute multiple MCP tool calls in parallel for faster batch operations. This tool is useful for batch element creation, position adjustments, color changes, or any repeated MCP operations that can run simultaneously.`

const SERVER_PARAMETER_DESCRIPTION = `The MCP server name to use (e.g., "figma-write", "UIDesignCanvas").`

const CALLS_PARAMETER_DESCRIPTION = `A JSON array of MCP tool calls. Each call should have:
- tool: (required) The MCP tool name
- args: (required) Object containing the tool arguments

Example for UIDesignCanvas (RECOMMENDED - use convenience tools for modern UI!):
[
  { "tool": "create_button", "args": { "label": "確認", "variant": "primary", "size": "lg", "parentId": "frame-123", "x": 16, "y": 100, "width": 358 } },
  { "tool": "create_card", "args": { "title": "功能區塊", "variant": "elevated", "parentId": "frame-123", "x": 16, "y": 200, "width": 358, "height": 120 } },
  { "tool": "create_input", "args": { "label": "用戶名", "placeholder": "請輸入...", "parentId": "frame-123", "x": 16, "y": 350, "width": 358 } }
]

Example for Figma:
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
