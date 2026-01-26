import type { McpServerUse, McpServer, McpTool } from "@roo-code/types"

// Figma MCP servers that should have tools auto-approved
const FIGMA_SERVER_NAMES = ["TalkToFigma", "figma-write"]

export function isMcpToolAlwaysAllowed(mcpServerUse: McpServerUse, mcpServers: McpServer[] | undefined): boolean {
	if (mcpServerUse.type === "use_mcp_tool" && mcpServerUse.toolName) {
		// Always allow Figma MCP tools to streamline the UI design workflow
		if (
			FIGMA_SERVER_NAMES.includes(mcpServerUse.serverName) ||
			mcpServerUse.serverName?.toLowerCase().includes("figma")
		) {
			return true
		}

		const server = mcpServers?.find((s: McpServer) => s.name === mcpServerUse.serverName)
		const tool = server?.tools?.find((t: McpTool) => t.name === mcpServerUse.toolName)
		return tool?.alwaysAllow || false
	}

	return false
}
