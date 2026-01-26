/**
 * Parallel MCP Calls Tool
 *
 * Executes multiple MCP tool calls in parallel for faster operations.
 * Useful for batch position adjustments, color changes, etc.
 */

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

// Maximum number of MCP calls per batch to prevent model timeouts
const MAX_BATCH_SIZE = 15

interface McpCall {
	tool: string
	args: Record<string, unknown>
}

interface ParallelMcpCallsParams {
	server: string  // MCP server name (e.g., "figma-write")
	calls: string   // JSON array of McpCall objects
}

export class ParallelMcpCallsTool extends BaseTool<"parallel_mcp_calls"> {
	readonly name = "parallel_mcp_calls" as const

	parseLegacy(params: Partial<Record<string, string>>): ParallelMcpCallsParams {
		return {
			server: params.server || "figma-write",
			calls: params.calls || "[]",
		}
	}

	async execute(params: ParallelMcpCallsParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Validate parameters
			if (!params.calls) {
				task.consecutiveMistakeCount++
				task.recordToolError("parallel_mcp_calls")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("parallel_mcp_calls", "calls"))
				return
			}

			// Parse calls JSON with fallback for malformed JSON
			let parsedCalls: McpCall[]
			try {
				const callsData = typeof params.calls === "string" ? params.calls : JSON.stringify(params.calls)
				// Try standard JSON parse first
				try {
					parsedCalls = JSON.parse(callsData)
				} catch {
					// Try to fix common JSON issues:
					// 1. Double }} at the end of objects
					// 2. Missing commas
					let fixedJson = callsData
						.replace(/\}\}/g, "}")  // Fix double }}
						.replace(/\}\s*\{/g, "},{")  // Fix missing commas between objects

					// If still fails, try removing the last incomplete entry
					try {
						parsedCalls = JSON.parse(fixedJson)
					} catch {
						// Try to find the last valid array element
						const lastBracket = fixedJson.lastIndexOf("]")
						if (lastBracket > 0) {
							const trimmed = fixedJson.substring(0, lastBracket + 1)
							parsedCalls = JSON.parse(trimmed)
						} else {
							throw new Error("Could not parse calls JSON")
						}
					}
				}
			} catch (error) {
				task.consecutiveMistakeCount++
				task.recordToolError("parallel_mcp_calls")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						"Invalid calls format. Expected a JSON array of MCP calls.\n\n" +
							"Each call should have:\n" +
							"- tool: string (e.g. 'set_position', 'set_fill')\n" +
							"- args: object (tool arguments)\n\n" +
							"Example:\n" +
							"[\n" +
							'  { "tool": "set_position", "args": { "nodeId": "123", "x": 100, "y": 200 } },\n' +
							'  { "tool": "set_position", "args": { "nodeId": "456", "x": 200, "y": 200 } }\n' +
							"]\n\n" +
							`Parse error: ${error instanceof Error ? error.message : String(error)}`
					)
				)
				return
			}

			// Validate calls array
			if (!Array.isArray(parsedCalls) || parsedCalls.length === 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("parallel_mcp_calls")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError("Calls must be a non-empty array"))
				return
			}

			// Enforce maximum batch size to prevent model timeouts
			if (parsedCalls.length > MAX_BATCH_SIZE) {
				await task.say(
					"text",
					`⚠️ 收到 ${parsedCalls.length} 個調用，將自動分批處理（每批最多 ${MAX_BATCH_SIZE} 個）`
				)
			}

			// Normalize calls: handle missing 'args' wrapper
			// Some models generate { "tool": "set_position", "nodeId": "123", "x": 100 }
			// instead of { "tool": "set_position", "args": { "nodeId": "123", "x": 100 } }
			parsedCalls = parsedCalls.map((call) => {
				if (call.tool && !call.args) {
					// Extract everything except 'tool' as args
					const callObj = call as unknown as Record<string, unknown>
					const { tool, ...rest } = callObj
					return { tool: tool as string, args: rest }
				}
				return call
			})

			// Validate each call after normalization
			for (const call of parsedCalls) {
				if (!call.tool) {
					task.consecutiveMistakeCount++
					task.recordToolError("parallel_mcp_calls")
					task.didToolFailInCurrentTurn = true
					pushToolResult(
						formatResponse.toolError(`Each call must have 'tool'. Invalid call: ${JSON.stringify(call)}`)
					)
					return
				}
				// args can be empty object for some tools
				if (!call.args) {
					call.args = {}
				}
			}

			task.consecutiveMistakeCount = 0

			// Get McpHub early so we can determine actual server
			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const mcpHub = provider.getMcpHub?.()
			if (!mcpHub) {
				pushToolResult(formatResponse.toolError("McpHub not available"))
				return
			}

			// Determine actual server to use based on settings (for Figma servers)
			let actualServer = params.server
			const isFigmaServer = params.server === "figma-write" || params.server === "TalkToFigma" || params.server?.toLowerCase().includes("figma")

			if (isFigmaServer) {
				// Get user settings to determine preferred Figma server
				const state = await provider.getState()
				const talkToFigmaEnabled = state.talkToFigmaEnabled ?? true  // Default true
				const figmaWriteEnabled = state.figmaWriteEnabled ?? false   // Default false

				const servers = mcpHub.getServers()
				const talkToFigmaConnected = servers.some((s) => s.name === "TalkToFigma" && s.status === "connected")
				const figmaWriteConnected = servers.some((s) => s.name === "figma-write" && s.status === "connected")

				// Use settings to determine preferred server
				if (talkToFigmaEnabled && talkToFigmaConnected) {
					actualServer = "TalkToFigma"
				} else if (figmaWriteEnabled && figmaWriteConnected) {
					actualServer = "figma-write"
				} else if (talkToFigmaConnected) {
					// Fallback: use TalkToFigma if connected
					actualServer = "TalkToFigma"
				} else if (figmaWriteConnected) {
					// Fallback: use figma-write if connected
					actualServer = "figma-write"
				}

				if (actualServer !== params.server) {
					console.log(`[ParallelMcpCalls] Using ${actualServer} instead of requested ${params.server} (based on settings)`)
				}
			}

			// Tool name mapping between figma-write and TalkToFigma
			// Based on TalkToFigma MCP documentation
			const figmaWriteToTalkToFigma: Record<string, string> = {
				// Position/Movement
				set_position: "move_node",
				// Colors
				set_fill: "set_fill_color",
				set_text_color: "set_fill_color", // TalkToFigma uses set_fill_color for text color too
				// Text creation
				add_text: "create_text",
				// Document info
				get_file_url: "get_document_info",
				// Node scanning
				find_nodes: "scan_nodes_by_types",
			}
			const talkToFigmaToFigmaWrite: Record<string, string> = {
				// Position/Movement
				move_node: "set_position",
				// Colors
				set_fill_color: "set_fill",
				// Text creation
				create_text: "add_text",
				// Document info
				get_document_info: "get_file_url",
				// Node scanning
				scan_nodes_by_types: "find_nodes",
			}

			// Map tool name based on actual server
			const mapToolName = (toolName: string): string => {
				if (actualServer === "TalkToFigma" && figmaWriteToTalkToFigma[toolName]) {
					return figmaWriteToTalkToFigma[toolName]
				}
				if (actualServer === "figma-write" && talkToFigmaToFigmaWrite[toolName]) {
					return talkToFigmaToFigmaWrite[toolName]
				}
				return toolName
			}

			// Show approval message
			const callSummary = parsedCalls
				.map((c, i) => `${i + 1}. ${mapToolName(c.tool)}(${JSON.stringify(c.args).substring(0, 50)}...)`)
				.join("\n")

			const toolMessage = JSON.stringify({
				tool: "parallelMcpCalls",
				server: actualServer,
				callCount: parsedCalls.length,
				calls: callSummary,
			})

			await task.say("text", `🔄 Executing ${parsedCalls.length} MCP calls in parallel on "${actualServer}":\n${callSummary}`)

			const didApprove = await askApproval("tool", toolMessage)
			if (!didApprove) {
				return
			}

			// Execute calls in batches to prevent overload
			const startTime = Date.now()
			const allResults: Array<{
				index: number
				tool: string
				success: boolean
				result?: unknown
				error?: string
			}> = []

			// Process in batches
			for (let batchStart = 0; batchStart < parsedCalls.length; batchStart += MAX_BATCH_SIZE) {
				const batch = parsedCalls.slice(batchStart, batchStart + MAX_BATCH_SIZE)
				const batchNum = Math.floor(batchStart / MAX_BATCH_SIZE) + 1
				const totalBatches = Math.ceil(parsedCalls.length / MAX_BATCH_SIZE)

				if (totalBatches > 1) {
					await task.say("text", `🔄 處理批次 ${batchNum}/${totalBatches}...`)
				}

				const batchResults = await Promise.all(
					batch.map(async (call, localIndex) => {
						const globalIndex = batchStart + localIndex
						const mappedToolName = mapToolName(call.tool)
						try {
							const result = await mcpHub.callTool(actualServer, mappedToolName, call.args)
							return {
								index: globalIndex,
								tool: mappedToolName,
								success: true,
								result,
							}
						} catch (error) {
							return {
								index: globalIndex,
								tool: mappedToolName,
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}
						}
					})
				)

				allResults.push(...batchResults)
			}

			const duration = Date.now() - startTime
			const successCount = allResults.filter((r) => r.success).length
			const failedCount = allResults.filter((r) => !r.success).length

			// Report results
			if (failedCount === 0) {
				await task.say(
					"text",
					`✅ All ${parsedCalls.length} MCP calls completed successfully in ${duration}ms!`
				)
			} else {
				const failedResults = allResults.filter((r) => !r.success)
				await task.say(
					"text",
					`⚠️ ${successCount}/${parsedCalls.length} calls succeeded, ${failedCount} failed.\n\n` +
						`Failed calls:\n` +
						failedResults.map((r) => `  • [${r.index}] ${r.tool}: ${r.error}`).join("\n")
				)
			}

			pushToolResult(
				formatResponse.toolResult(
					`Parallel MCP calls completed.\n` +
						`- Success: ${successCount}\n` +
						`- Failed: ${failedCount}\n` +
						`- Duration: ${duration}ms`
				)
			)
		} catch (error) {
			await handleError("executing parallel MCP calls", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"parallel_mcp_calls">): Promise<void> {
		const nativeArgs = block.nativeArgs as { server?: string; calls?: string } | undefined
		const partialMessage = JSON.stringify({
			tool: "parallelMcpCalls",
			server: nativeArgs?.server || "(streaming...)",
			calls: nativeArgs?.calls || "(streaming...)",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const parallelMcpCallsTool = new ParallelMcpCallsTool()
