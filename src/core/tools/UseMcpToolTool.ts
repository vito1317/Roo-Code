import type { ClineAskUseMcpServer, McpExecutionStatus } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import type { ToolUse } from "../../shared/tools"
import { getFigmaService, extractFileKey, extractNodeIds, formatForLLM } from "../../services/figma"
import { FigmaWriteService, FIGMA_WRITE_TOOLS, getFigmaWriteService } from "../../services/figma/FigmaWriteService"

import { BaseTool, ToolCallbacks } from "./BaseTool"

// Internal Figma server tool definitions
const FIGMA_TOOLS = [
	{ name: "get_file", description: "Get complete Figma file structure" },
	{ name: "get_nodes", description: "Get specific nodes from a Figma file" },
	{ name: "get_images", description: "Export nodes as images" },
	{ name: "get_simplified_structure", description: "Get simplified structure for AI consumption" },
]

interface UseMcpToolParams {
	server_name: string
	tool_name: string
	arguments?: Record<string, unknown>
}

type ValidationResult =
	| { isValid: false }
	| {
			isValid: true
			serverName: string
			toolName: string
			parsedArguments?: Record<string, unknown>
	  }

export class UseMcpToolTool extends BaseTool<"use_mcp_tool"> {
	readonly name = "use_mcp_tool" as const

	async execute(params: UseMcpToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Validate parameters
			const validation = await this.validateParams(task, params, pushToolResult)
			if (!validation.isValid) {
				return
			}

			const { serverName, toolName, parsedArguments } = validation

			// Validate that the tool exists on the server
			const toolValidation = await this.validateToolExists(task, serverName, toolName, pushToolResult)
			if (!toolValidation.isValid) {
				return
			}

			// Reset mistake count on successful validation
			task.consecutiveMistakeCount = 0

			const executionId = task.lastMessageTs?.toString() ?? Date.now().toString()

			// Handle common LLM mistake: trying to use "browser" as MCP server
			// Instead, browser_action is a BUILT-IN tool, not an MCP server
			if (serverName.toLowerCase() === "browser") {
				task.recordToolError("use_mcp_tool")
				pushToolResult(
					`❌ ERROR: "browser" is NOT an MCP server!\n\n` +
					`browser_action is a BUILT-IN tool. Use this format instead:\n\n` +
					`\`\`\`xml\n` +
					`<browser_action>\n` +
					`<action>launch</action>\n` +
					`<url>http://localhost:3000</url>\n` +
					`</browser_action>\n` +
					`\`\`\`\n\n` +
					`Available actions: launch, click, type, scroll_down, scroll_up, dom_extract, close`
				)
				return
			}

			// For internal Figma servers, skip MCP-style approval (treat as built-in tool)
			// Match any variation: figma, figma-write, fig, figma-read, etc.
			const isFigmaServer = serverName.toLowerCase().startsWith("fig")
			if (isFigmaServer) {
				// Execute directly without MCP approval dialog
				await this.executeToolAndProcessResult(
					task,
					serverName,
					toolName,
					parsedArguments,
					executionId,
					pushToolResult,
				)
				return
			}

			// Get user approval for external MCP servers
			const completeMessage = JSON.stringify({
				type: "use_mcp_tool",
				serverName,
				toolName,
				arguments: params.arguments ? JSON.stringify(params.arguments) : undefined,
			} satisfies ClineAskUseMcpServer)

			const didApprove = await askApproval("use_mcp_server", completeMessage)

			if (!didApprove) {
				return
			}

			// Execute the tool and process results
			await this.executeToolAndProcessResult(
				task,
				serverName,
				toolName,
				parsedArguments,
				executionId,
				pushToolResult,
			)
		} catch (error) {
			await handleError("executing MCP tool", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"use_mcp_tool">): Promise<void> {
		const nativeArgs = block.nativeArgs as { server_name?: string; tool_name?: string; arguments?: Record<string, unknown> } | undefined
		const serverName = nativeArgs?.server_name

		// Skip if no server name yet (still streaming)
		if (!serverName || serverName.trim() === "") {
			return
		}

		// Skip partial for "browser" - LLM is making a mistake, will get error in execute
		if (serverName.toLowerCase() === "browser") {
			return
		}

		// Skip MCP-style partial message for internal Figma servers
		// Match any variation: figma, figma-write, fig, etc.
		if (serverName.toLowerCase().startsWith("fig")) {
			return
		}

		const partialMessage = JSON.stringify({
			type: "use_mcp_tool",
			serverName: nativeArgs?.server_name ?? "",
			toolName: nativeArgs?.tool_name ?? "",
			arguments: nativeArgs?.arguments ? JSON.stringify(nativeArgs.arguments) : undefined,
		} satisfies ClineAskUseMcpServer)

		await task.ask("use_mcp_server", partialMessage, true).catch(() => {})
	}

	private async validateParams(
		task: Task,
		params: UseMcpToolParams,
		pushToolResult: (content: string) => void,
	): Promise<ValidationResult> {
		if (!params.server_name) {
			task.consecutiveMistakeCount++
			task.recordToolError("use_mcp_tool")
			pushToolResult(await task.sayAndCreateMissingParamError("use_mcp_tool", "server_name"))
			return { isValid: false }
		}

		if (!params.tool_name) {
			task.consecutiveMistakeCount++
			task.recordToolError("use_mcp_tool")
			pushToolResult(await task.sayAndCreateMissingParamError("use_mcp_tool", "tool_name"))
			return { isValid: false }
		}

		// Native-only: arguments are already a structured object.
		let parsedArguments: Record<string, unknown> | undefined
		if (params.arguments !== undefined) {
			if (typeof params.arguments !== "object" || params.arguments === null || Array.isArray(params.arguments)) {
				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say("error", t("mcp:errors.invalidJsonArgument", { toolName: params.tool_name }))
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						formatResponse.invalidMcpToolArgumentError(params.server_name, params.tool_name),
					),
				)
				return { isValid: false }
			}
			parsedArguments = params.arguments
		}

		return {
			isValid: true,
			serverName: params.server_name,
			toolName: params.tool_name,
			parsedArguments,
		}
	}

	private async validateToolExists(
		task: Task,
		serverName: string,
		toolName: string,
		pushToolResult: (content: string) => void,
	): Promise<{ isValid: boolean; availableTools?: string[] }> {
		try {
			// Get the MCP hub to access server information
			const provider = task.providerRef.deref()
			const mcpHub = provider?.getMcpHub()

			if (!mcpHub) {
				// If we can't get the MCP hub, check if this is an internal figma server
				// Match any variation: figma, figma-write, fig, etc.
				const isFigmaServer = serverName.toLowerCase().startsWith("fig")
				if (isFigmaServer) {
					const isFigmaWrite = serverName.toLowerCase().includes("write") || serverName === "fig"
					if (isFigmaWrite) {
						return this.validateFigmaWriteToolExists(toolName, pushToolResult, task)
					}
					return this.validateFigmaToolExists(toolName, pushToolResult, task)
				}
				return { isValid: true }
			}

			// Get all servers to find the specific one
			const servers = mcpHub.getAllServers()
			const server = servers.find((s) => s.name === serverName)

			// Check for internal figma servers (any variation)
			const isFigmaServer = serverName.toLowerCase().startsWith("fig")
			if (!server && isFigmaServer) {
				const isFigmaWrite = serverName.toLowerCase().includes("write") || serverName === "fig"
				if (isFigmaWrite) {
					return this.validateFigmaWriteToolExists(toolName, pushToolResult, task)
				}
				return this.validateFigmaToolExists(toolName, pushToolResult, task)
			}

			if (!server) {
				// Fail fast when server is unknown
				const availableServersArray = servers.map((s) => s.name)
				const availableServers =
					availableServersArray.length > 0 ? availableServersArray.join(", ") : "No servers available"

				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say("error", t("mcp:errors.serverNotFound", { serverName, availableServers }))
				task.didToolFailInCurrentTurn = true

				pushToolResult(formatResponse.unknownMcpServerError(serverName, availableServersArray))
				return { isValid: false, availableTools: [] }
			}

			// Check if the server has tools defined
			if (!server.tools || server.tools.length === 0) {
				// No tools available on this server
				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say(
					"error",
					t("mcp:errors.toolNotFound", {
						toolName,
						serverName,
						availableTools: "No tools available",
					}),
				)
				task.didToolFailInCurrentTurn = true

				pushToolResult(formatResponse.unknownMcpToolError(serverName, toolName, []))
				return { isValid: false, availableTools: [] }
			}

			// Check if the requested tool exists
			const tool = server.tools.find((tool) => tool.name === toolName)

			if (!tool) {
				// Tool not found - provide list of available tools
				const availableToolNames = server.tools.map((tool) => tool.name)

				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say(
					"error",
					t("mcp:errors.toolNotFound", {
						toolName,
						serverName,
						availableTools: availableToolNames.join(", "),
					}),
				)
				task.didToolFailInCurrentTurn = true

				pushToolResult(formatResponse.unknownMcpToolError(serverName, toolName, availableToolNames))
				return { isValid: false, availableTools: availableToolNames }
			}

			// Check if the tool is disabled (enabledForPrompt is false)
			if (tool.enabledForPrompt === false) {
				// Tool is disabled - only show enabled tools
				const enabledTools = server.tools.filter((t) => t.enabledForPrompt !== false)
				const enabledToolNames = enabledTools.map((t) => t.name)

				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say(
					"error",
					t("mcp:errors.toolDisabled", {
						toolName,
						serverName,
						availableTools:
							enabledToolNames.length > 0 ? enabledToolNames.join(", ") : "No enabled tools available",
					}),
				)
				task.didToolFailInCurrentTurn = true

				pushToolResult(formatResponse.unknownMcpToolError(serverName, toolName, enabledToolNames))
				return { isValid: false, availableTools: enabledToolNames }
			}

			// Tool exists and is enabled
			return { isValid: true, availableTools: server.tools.map((tool) => tool.name) }
		} catch (error) {
			// If there's an error during validation, log it but don't block the tool execution
			// The actual tool call might still fail with a proper error
			console.error("Error validating MCP tool existence:", error)
			return { isValid: true }
		}
	}

	private async sendExecutionStatus(task: Task, status: McpExecutionStatus): Promise<void> {
		const clineProvider = await task.providerRef.deref()
		clineProvider?.postMessageToWebview({
			type: "mcpExecutionStatus",
			text: JSON.stringify(status),
		})
	}

	private processToolContent(toolResult: any): string {
		if (!toolResult?.content || toolResult.content.length === 0) {
			return ""
		}

		return toolResult.content
			.map((item: any) => {
				if (item.type === "text") {
					return item.text
				}
				if (item.type === "resource") {
					const { blob: _, ...rest } = item.resource
					return JSON.stringify(rest, null, 2)
				}
				return ""
			})
			.filter(Boolean)
			.join("\n\n")
	}

	private async executeToolAndProcessResult(
		task: Task,
		serverName: string,
		toolName: string,
		parsedArguments: Record<string, unknown> | undefined,
		executionId: string,
		pushToolResult: (content: string | Array<any>) => void,
	): Promise<void> {
		// Route to internal Figma server if applicable (treat as built-in tool)
		let toolResult: any
		// Match any figma variation: figma, figma-write, fig, etc.
		const isFigmaServer = serverName.toLowerCase().startsWith("fig")
		const isFigmaWrite = serverName.toLowerCase().includes("write") || serverName === "fig"
		
		if (isFigmaServer && !isFigmaWrite) {
			// For Figma Read, use "text" say type instead of MCP style
			await task.say("text", `🎨 Calling Figma API: \`${toolName}\``)
			toolResult = await this.executeFigmaTool(toolName, parsedArguments)
		} else if (isFigmaServer) {
			// For Figma Write, use standard MCP flow but with custom message
			await task.say("text", `🎨 Creating in Figma: \`${toolName}\``)
			// Use the standard MCP callTool - figma-write is registered as built-in server in McpHub
			toolResult = await task.providerRef.deref()?.getMcpHub()?.callTool(serverName, toolName, parsedArguments)
		} else {
			// Standard MCP tool handling
			await task.say("mcp_server_request_started")
			// Send started status
			await this.sendExecutionStatus(task, {
				executionId,
				status: "started",
				serverName,
				toolName,
			})
			toolResult = await task.providerRef.deref()?.getMcpHub()?.callTool(serverName, toolName, parsedArguments)
		}

		let toolResultPretty = "(No response)"

		if (toolResult) {
			const outputText = this.processToolContent(toolResult)

			if (outputText) {
				// Only send execution status for non-Figma servers (to avoid UI clutter)
				if (!isFigmaServer) {
					await this.sendExecutionStatus(task, {
						executionId,
						status: "output",
						response: outputText,
					})
				}

				toolResultPretty = (toolResult.isError ? "Error:\n" : "") + outputText
			}

			// Send completion status only for non-Figma servers
			if (!isFigmaServer) {
				await this.sendExecutionStatus(task, {
					executionId,
					status: toolResult.isError ? "error" : "completed",
					response: toolResultPretty,
					error: toolResult.isError ? "Error executing MCP tool" : undefined,
				})
			}
		} else {
			// Send error status if no result
			await this.sendExecutionStatus(task, {
				executionId,
				status: "error",
				error: "No response from MCP server",
			})
		}

		// For Figma servers, show simplified result instead of full JSON
		if (isFigmaServer) {
			// For figma-write, extract just the success/node info
			const simplifiedResult = toolResult?.isError
				? `❌ Figma Error: ${toolResultPretty}`
				: `✅ Figma: ${toolName} completed`
			await task.say("text", simplifiedResult)
		} else {
			await task.say("mcp_server_response", toolResultPretty)
		}
		
		// Still push full result to LLM context (just not displayed verbosely in UI)
		pushToolResult(formatResponse.toolResult(toolResultPretty))
	}

	/**
	 * Validate that a Figma tool exists (internal server)
	 */
	private async validateFigmaToolExists(
		toolName: string,
		pushToolResult: (content: string) => void,
		task: Task,
	): Promise<{ isValid: boolean; availableTools?: string[] }> {
		const tool = FIGMA_TOOLS.find((t) => t.name === toolName)
		if (!tool) {
			const availableToolNames = FIGMA_TOOLS.map((t) => t.name)
			task.consecutiveMistakeCount++
			task.recordToolError("use_mcp_tool")
			await task.say(
				"error",
				t("mcp:errors.toolNotFound", {
					toolName,
					serverName: "figma",
					availableTools: availableToolNames.join(", "),
				}),
			)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.unknownMcpToolError("figma", toolName, availableToolNames))
			return { isValid: false, availableTools: availableToolNames }
		}
		return { isValid: true, availableTools: FIGMA_TOOLS.map((t) => t.name) }
	}

	/**
	 * Validate that a Figma Write tool exists (internal server)
	 */
	private async validateFigmaWriteToolExists(
		toolName: string,
		pushToolResult: (content: string) => void,
		task: Task,
	): Promise<{ isValid: boolean; availableTools?: string[] }> {
		const tool = FIGMA_WRITE_TOOLS.find((t) => t.name === toolName)
		if (!tool) {
			const availableToolNames = FIGMA_WRITE_TOOLS.map((t) => t.name)
			task.consecutiveMistakeCount++
			task.recordToolError("use_mcp_tool")
			await task.say(
				"error",
				t("mcp:errors.toolNotFound", {
					toolName,
					serverName: "figma-write",
					availableTools: availableToolNames.join(", "),
				}),
			)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.unknownMcpToolError("figma-write", toolName, availableToolNames))
			return { isValid: false, availableTools: availableToolNames }
		}
		return { isValid: true, availableTools: FIGMA_WRITE_TOOLS.map((t) => t.name) }
	}

	/**
	 * Execute a Figma tool (internal server)
	 */
	private async executeFigmaTool(
		toolName: string,
		args: Record<string, unknown> | undefined,
	): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
		const figmaService = await getFigmaService()
		if (!figmaService) {
			return {
				content: [{ type: "text", text: "Error: Figma API token not configured. Please set it in Settings → Figma Integration." }],
				isError: true,
			}
		}

		try {
			let result: string

			switch (toolName) {
				case "get_file": {
					const fileKeyOrUrl = args?.file_key as string || args?.url as string
					if (!fileKeyOrUrl) {
						return {
							content: [{ type: "text", text: "Error: file_key or url is required" }],
							isError: true,
						}
					}
					const fileKey = extractFileKey(fileKeyOrUrl) || fileKeyOrUrl
					const depth = (args?.depth as number) || 2
					const file = await figmaService.getFile(fileKey, { depth })
					result = `# Figma File: ${file.name}\n\nLast Modified: ${file.lastModified}\nVersion: ${file.version}\n\n## Document Structure:\n${JSON.stringify(file.document, null, 2).substring(0, 10000)}...`
					break
				}

				case "get_nodes": {
					const fileKeyOrUrl = args?.file_key as string || args?.url as string
					const nodeIds = args?.node_ids as string[] || (args?.url ? extractNodeIds(args.url as string) : [])
					if (!fileKeyOrUrl) {
						return {
							content: [{ type: "text", text: "Error: file_key or url is required" }],
							isError: true,
						}
					}
					const fileKey = extractFileKey(fileKeyOrUrl) || fileKeyOrUrl
					const nodes = await figmaService.getNodes(fileKey, nodeIds)
					result = `# Figma Nodes\n\n${JSON.stringify(nodes, null, 2)}`
					break
				}

				case "get_images": {
					const fileKeyOrUrl = args?.file_key as string || args?.url as string
					const nodeIds = args?.node_ids as string[] || []
					const format = (args?.format as "png" | "jpg" | "svg") || "png"
					const scale = (args?.scale as number) || 2
					if (!fileKeyOrUrl || nodeIds.length === 0) {
						return {
							content: [{ type: "text", text: "Error: file_key and node_ids are required" }],
							isError: true,
						}
					}
					const fileKey = extractFileKey(fileKeyOrUrl) || fileKeyOrUrl
					const images = await figmaService.getImages(fileKey, nodeIds, { format, scale })
					result = `# Figma Image URLs\n\n${Object.entries(images.images).map(([id, url]) => `- ${id}: ${url}`).join("\n")}`
					break
				}

				case "get_simplified_structure": {
					const fileKeyOrUrl = args?.file_key as string || args?.url as string
					if (!fileKeyOrUrl) {
						return {
							content: [{ type: "text", text: "Error: file_key or url is required" }],
							isError: true,
						}
					}
					const fileKey = extractFileKey(fileKeyOrUrl) || fileKeyOrUrl
					const maxDepth = (args?.max_depth as number) || 3
					const structure = await figmaService.getSimplifiedStructure(fileKey, { maxDepth })
					result = `# ${structure.name}\n\n## Component Hierarchy:\n${formatForLLM(structure.structure)}`
					break
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown Figma tool: ${toolName}` }],
						isError: true,
					}
			}

			return { content: [{ type: "text", text: result }], isError: false }
		} catch (error) {
			return {
				content: [{ type: "text", text: `Figma API Error: ${error instanceof Error ? error.message : String(error)}` }],
				isError: true,
			}
		}
	}

	/**
	 * Execute a Figma Write tool (internal server)
	 */
	private async executeFigmaWriteTool(
		toolName: string,
		args: Record<string, unknown> | undefined,
		task: Task,
	): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
		// Initialize Figma Write Service if needed
		let figmaWriteService = getFigmaWriteService()
		if (!figmaWriteService) {
			// Get extension path from provider
			const provider = task.providerRef.deref()
			const extensionPath = provider?.context?.extensionPath || ""
			figmaWriteService = FigmaWriteService.initialize(extensionPath)
		}

		// Check if the service is available
		const isAvailable = await figmaWriteService.isAvailable()
		if (!isAvailable) {
			return {
				content: [{
					type: "text",
					text: "Error: Figma Write Bridge not available.\n\n" +
						"Please ensure the Figma plugin is running:\n" +
						"1. Open Figma\n" +
						"2. Go to Plugins → Development → MCP Figma Write Bridge\n\n" +
						"Falling back to ASCII design mode..."
				}],
				isError: true,
			}
		}

		// Call the tool
		const result = await figmaWriteService.callTool(toolName, args || {})

		if (!result.success) {
			return {
				content: [{ type: "text", text: `Figma Write Error: ${result.error}` }],
				isError: true,
			}
		}

		const responseText = result.nodeId
			? `✅ Created in Figma: ${result.nodeId}\n${JSON.stringify(result.data, null, 2)}`
			: JSON.stringify(result.data, null, 2)

		return {
			content: [{ type: "text", text: responseText }],
			isError: false,
		}
	}
}

export const useMcpToolTool = new UseMcpToolTool()
