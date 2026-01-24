/**
 * Parallel UI Service
 *
 * Manages parallel execution of multiple AI agents for UI drawing.
 * Each agent handles a specific UI component/section independently.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, buildApiHandler } from "../../api"
import { FIGMA_WRITE_TOOLS } from "./FigmaWriteService"
import { ProviderSettings } from "@roo-code/types"
import type { McpHub } from "../mcp/McpHub"

export interface UITaskDefinition {
	/** Unique identifier for this task */
	id: string
	/** Description of what UI element/section to draw */
	description: string
	/** Target frame or container name in Figma */
	targetFrame?: string
	/** Position offset for this task's elements */
	position?: { x: number; y: number }
	/** Specific design requirements */
	designSpec?: {
		width?: number
		height?: number
		style?: string
		/** Colors array: [0] = background, [1] = text/accent */
		colors?: string[]
		/** Corner radius for rounded elements */
		cornerRadius?: number
		/** Font size for text */
		fontSize?: number
		/** Text content to display */
		text?: string
	}
}

export interface UITaskResult {
	taskId: string
	success: boolean
	nodeIds: string[]
	error?: string
	duration: number
}

export interface ParallelUIResult {
	success: boolean
	results: UITaskResult[]
	totalDuration: number
	summary: string
}

// System prompt for UI drawing agents
const UI_AGENT_SYSTEM_PROMPT = `You are a UI designer agent. You create UI buttons in Figma.

## MANDATORY FIRST STEP - CREATE RECTANGLE
Your FIRST tool call MUST be create_rectangle. No exceptions.
If you skip this step, the button will have no background - THIS IS A FAILURE.

## CORRECT TOOL SEQUENCE (FOLLOW EXACTLY)
Step 1: create_rectangle (MANDATORY - creates button background with color)
Step 2: add_text (adds CENTERED button label)
Step 3: set_text_color (MUST use WHITE #FFFFFF for dark backgrounds)

## TOOL PARAMETER NAMES (CRITICAL)
- create_rectangle: width, height, x, y, cornerRadius, hex (for color)
- add_text: text (NOT "content"), x, y, fontSize
- set_text_color: nodeId, hex (NOT "color")

## TEXT CENTERING (VERY IMPORTANT)
To center text on a button:
- For width=90, height=60, fontSize=24:
  - Text x = (90 - fontSize) / 2 = ~33
  - Text y = (60 - fontSize) / 2 = ~18
- General formula: x = (width - charWidth) / 2, y = (height - fontSize) / 2
- For single character (like "7"), charWidth ≈ fontSize * 0.6
- For multi-char text, charWidth ≈ fontSize * 0.6 * numChars

## TEXT COLOR RULES (MANDATORY)
- Dark backgrounds (#333333, #1E1E1E, etc) → WHITE text (#FFFFFF)
- Orange backgrounds (#FF9500, #FF6600) → WHITE text (#FFFFFF)
- Light gray backgrounds (#D4D4D4, #E0E0E0) → DARK text (#333333)
- ALWAYS call set_text_color! Never skip this step!

## EXAMPLE FOR BUTTON "7" (width=90, height=60)
Tool call 1: create_rectangle(width=90, height=60, x=0, y=0, cornerRadius=8, hex="#333333")
Tool call 2: add_text(text="7", x=35, y=18, fontSize=24)  // CENTERED!
Tool call 3: set_text_color(nodeId=<from step 2>, hex="#FFFFFF")  // WHITE on dark!

## EXAMPLE FOR OPERATOR "+" (width=90, height=60, orange)
Tool call 1: create_rectangle(width=90, height=60, x=0, y=0, cornerRadius=8, hex="#FF9500")
Tool call 2: add_text(text="+", x=35, y=18, fontSize=24)  // CENTERED!
Tool call 3: set_text_color(nodeId=<from step 2>, hex="#FFFFFF")  // WHITE on orange!

## FAILURE CONDITIONS
- NO rectangle created = FAILED
- Text not centered = UGLY (calculate position!)
- Wrong text color = UNREADABLE (use WHITE on dark!)

Always start with create_rectangle, CENTER the text, use CORRECT text color!`

export class ParallelUIService {
	private static instance: ParallelUIService | null = null
	private apiConfiguration: ProviderSettings | null = null
	private extensionPath: string = ""
	private mcpHub: McpHub | null = null

	private constructor() {}

	static getInstance(): ParallelUIService {
		if (!ParallelUIService.instance) {
			ParallelUIService.instance = new ParallelUIService()
		}
		return ParallelUIService.instance
	}

	/**
	 * Configure the service with API settings and McpHub
	 */
	configure(apiConfiguration: ProviderSettings, extensionPath: string, mcpHub?: McpHub): void {
		this.apiConfiguration = apiConfiguration
		this.extensionPath = extensionPath
		if (mcpHub) {
			this.mcpHub = mcpHub
		}
		// Debug logging
		console.log(`[ParallelUI] Configured with:`, {
			provider: apiConfiguration?.apiProvider,
			modelId: apiConfiguration?.apiModelId,
			baseUrl: apiConfiguration?.openAiBaseUrl,
			hasConfig: !!apiConfiguration,
		})
	}

	/**
	 * Execute multiple UI tasks in parallel
	 */
	async executeParallelTasks(
		tasks: UITaskDefinition[],
		onProgress?: (taskId: string, status: string) => void
	): Promise<ParallelUIResult> {
		const startTime = Date.now()

		if (!this.apiConfiguration) {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "Service not configured. Call configure() first.",
			}
		}

		// Check if the provider supports tool use
		// Parallel UI requires models that support function/tool calling
		const provider = this.apiConfiguration.apiProvider
		const modelId = this.apiConfiguration.apiModelId || ""
		const supportedProviders = ["anthropic", "openrouter", "bedrock", "vertex"]

		// Log provider info for debugging
		const baseUrl = this.apiConfiguration.openAiBaseUrl?.toLowerCase() || ""
		console.log(`[ParallelUI] Provider: ${provider}, Model: ${modelId}, BaseUrl: ${baseUrl || "(not set)"}`)

		// Only block native Ollama/LMStudio providers (they use different API formats)
		// OpenAI-compatible providers (including local ones like Qwen, Llama) should be allowed
		// because they support the OpenAI tool calling format
		const isNativeLocalProvider = provider === "ollama" || provider === "lmstudio"

		if (isNativeLocalProvider) {
			console.warn(`[ParallelUI] Native local provider "${provider}" does not support OpenAI tool format`)
			return {
				success: false,
				results: [],
				totalDuration: Date.now() - startTime,
				summary: `並行 UI 任務需要使用 OpenAI 兼容的 API 格式。\n` +
					`當前 Provider "${provider}" 不支援此格式。\n\n` +
					`建議：\n` +
					`1. 使用 OpenAI-compatible provider 設定來連接本地模型\n` +
					`2. 或使用單一 Figma 工具 (use_mcp_tool) 逐個創建 UI 元件`,
			}
		}

		if (!provider || !supportedProviders.includes(provider)) {
			console.warn(`[ParallelUI] Provider "${provider}" may not fully support parallel UI tasks with tool use`)
		}

		// Check if McpHub has figma-write server available
		if (!this.mcpHub) {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "McpHub not available. Figma Write requires McpHub connection.",
			}
		}

		// Check if figma-write server is connected via McpHub
		const figmaWriteServer = this.mcpHub.getServers().find(s =>
			s.name === "figma-write" || s.name.includes("figma")
		)
		if (!figmaWriteServer || figmaWriteServer.status !== "connected") {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "Figma Write server not connected. Please ensure the Figma plugin is running and connected via McpHub.",
			}
		}

		console.log(`[ParallelUI] Starting ${tasks.length} parallel UI tasks using McpHub`)

		// Execute all tasks in parallel
		const taskPromises = tasks.map((task) =>
			this.executeSingleTask(task, onProgress)
		)

		const results = await Promise.all(taskPromises)

		const totalDuration = Date.now() - startTime
		const successCount = results.filter((r) => r.success).length
		const allNodeIds = results.flatMap((r) => r.nodeIds)

		return {
			success: successCount === tasks.length,
			results,
			totalDuration,
			summary: `Completed ${successCount}/${tasks.length} UI tasks in ${totalDuration}ms. Created ${allNodeIds.length} nodes.`,
		}
	}

	/**
	 * Execute a single UI task using an AI agent
	 */
	private async executeSingleTask(
		task: UITaskDefinition,
		onProgress?: (taskId: string, status: string) => void
	): Promise<UITaskResult> {
		const startTime = Date.now()
		const nodeIds: string[] = []

		try {
			onProgress?.(task.id, "starting")

			// Build the prompt for this specific task
			const taskPrompt = this.buildTaskPrompt(task)

			// Create API handler for this task
			const api = buildApiHandler(this.apiConfiguration!)

			// Make the API call
			await this.callAIForUITask(api, taskPrompt, task, nodeIds, onProgress)

			// Check if any nodes were actually created
			if (nodeIds.length === 0) {
				console.warn(`[ParallelUI] Task ${task.id} completed but created 0 nodes - model may not support tool calling`)
				onProgress?.(task.id, "no nodes created")
				return {
					taskId: task.id,
					success: false,
					nodeIds,
					error: "模型未生成工具調用 - 請確認使用支援 tool use 的模型 (如 Claude)",
					duration: Date.now() - startTime,
				}
			}

			onProgress?.(task.id, "completed")

			return {
				taskId: task.id,
				success: true,
				nodeIds,
				duration: Date.now() - startTime,
			}
		} catch (error) {
			onProgress?.(task.id, "failed")
			return {
				taskId: task.id,
				success: false,
				nodeIds,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			}
		}
	}

	/**
	 * Build the prompt for a specific UI task
	 * NOTE: All positions should be RELATIVE (starting at 0,0)
	 * The actual absolute position is added automatically in callAIForUITask
	 */
	private buildTaskPrompt(task: UITaskDefinition): string {
		const width = task.designSpec?.width || 90
		const height = task.designSpec?.height || 60

		// Extract design specs with defaults
		const bgColor = task.designSpec?.colors?.[0] || "#333333"
		const textColor = task.designSpec?.colors?.[1] || "#FFFFFF"
		const cornerRadius = task.designSpec?.cornerRadius || 8
		const fontSize = task.designSpec?.fontSize || 24
		const textContent = task.designSpec?.text || "?"

		// Calculate text centering more accurately
		// Approximate character width: fontSize * 0.6 per character
		const textLength = textContent.length
		const estimatedTextWidth = fontSize * 0.6 * textLength
		const textX = Math.floor((width - estimatedTextWidth) / 2)
		const textY = Math.floor((height - fontSize) / 2)

		console.log(`[ParallelUI] Task ${task.id}: text="${textContent}", size=${width}x${height}, textPos=(${textX}, ${textY})`)

		// Simple, direct prompt with exact tool calls
		let prompt = `Create a button with label "${textContent}"\n\n`
		prompt += `EXECUTE THESE 3 TOOL CALLS IN ORDER:\n\n`
		prompt += `1. create_rectangle with: width=${width}, height=${height}, x=0, y=0, cornerRadius=${cornerRadius}, hex="${bgColor}"\n\n`
		prompt += `2. add_text with: text="${textContent}", x=${textX}, y=${textY}, fontSize=${fontSize}\n\n`
		prompt += `3. set_text_color with: nodeId=<ID from step 2>, hex="${textColor}"\n\n`
		prompt += `IMPORTANT: Text color MUST be "${textColor}" - do NOT use any other color!\n`
		prompt += `START NOW with create_rectangle.`

		return prompt
	}

	/**
	 * Call AI to create UI and execute Figma commands
	 */
	private async callAIForUITask(
		api: ApiHandler,
		prompt: string,
		task: UITaskDefinition,
		nodeIds: string[],
		onProgress?: (taskId: string, status: string) => void
	): Promise<void> {
		// Build tools list for the AI in OpenAI format
		const tools = FIGMA_WRITE_TOOLS.map((tool) => ({
			type: "function" as const,
			function: {
				name: `figma_${tool.name}`,
				description: tool.description,
				parameters: this.getToolSchema(tool.name),
			},
		}))

		console.log(`[ParallelUI] Task ${task.id} - Tools configured: ${tools.map(t => t.function.name).join(", ")}`)

		// Make the API call with tool use
		const messages: Anthropic.MessageParam[] = [
			{
				role: "user",
				content: prompt,
			},
		]

		let continueLoop = true
		let iterations = 0
		const maxIterations = 10 // Prevent infinite loops

		while (continueLoop && iterations < maxIterations) {
			iterations++
			onProgress?.(task.id, `iteration ${iterations}`)

			try {
				// DEBUG: Log the request being sent
				console.log(`\n========== [ParallelUI] Task ${task.id} - REQUEST ==========`)
				console.log(`[ParallelUI] System Prompt: ${UI_AGENT_SYSTEM_PROMPT.substring(0, 200)}...`)
				console.log(`[ParallelUI] Messages count: ${messages.length}`)
				console.log(`[ParallelUI] Last message role: ${messages[messages.length - 1]?.role}`)
				console.log(`[ParallelUI] Tools count: ${tools.length}`)
				console.log(`[ParallelUI] Tools: ${JSON.stringify(tools.map(t => t.function.name))}`)
				console.log(`[ParallelUI] Full request metadata:`, JSON.stringify({
					taskId: `parallel-ui-${task.id}`,
					tools: tools,
					tool_choice: "auto",
					parallelToolCalls: true,
				}, null, 2))
				console.log(`==========================================================\n`)

				// Pass tools in metadata for OpenAI-compatible providers
				// Use "required" to force tool usage on first iteration, then "auto" for subsequent
				const toolChoiceValue = iterations === 1 ? "required" : "auto"
				console.log(`[ParallelUI] Task ${task.id} - Using tool_choice: ${toolChoiceValue}`)

				const stream = api.createMessage(UI_AGENT_SYSTEM_PROMPT, messages, {
					taskId: `parallel-ui-${task.id}`,
					tools: tools,
					tool_choice: toolChoiceValue,
					parallelToolCalls: true,
				})

				let assistantContent: Anthropic.ContentBlock[] = []
				let textContent = ""
				// Track tool calls by index (OpenAI uses index-based streaming)
				const toolCallsByIndex: Map<number, { id: string; name: string; arguments: string }> = new Map()
				const toolCalls: Map<string, { id: string; name: string; arguments: string }> = new Map()

				console.log(`\n========== [ParallelUI] Task ${task.id} - RESPONSE CHUNKS ==========`)
				let chunkCount = 0
				for await (const chunk of stream) {
					chunkCount++
					// DEBUG: Log every chunk received
					console.log(`[ParallelUI] Chunk #${chunkCount} type: ${chunk.type}`, JSON.stringify(chunk).substring(0, 300))

					if (chunk.type === "text") {
						textContent += chunk.text
					} else if (chunk.type === "tool_call") {
						// Complete tool call (Anthropic format)
						toolCalls.set(chunk.id, {
							id: chunk.id,
							name: chunk.name,
							arguments: chunk.arguments,
						})
					} else if (chunk.type === "tool_call_start") {
						// Start of a streamed tool call (Anthropic format)
						toolCalls.set(chunk.id, {
							id: chunk.id,
							name: chunk.name,
							arguments: "",
						})
					} else if (chunk.type === "tool_call_delta") {
						// Delta for a streamed tool call (Anthropic format)
						const existing = toolCalls.get(chunk.id)
						if (existing) {
							existing.arguments += chunk.delta
						}
					} else if (chunk.type === "tool_call_partial") {
						// OpenAI format: partial tool call with index
						const partialChunk = chunk as { type: "tool_call_partial"; index: number; id?: string; name?: string; arguments?: string }
						let existing = toolCallsByIndex.get(partialChunk.index)
						if (!existing) {
							existing = { id: partialChunk.id || `tool-${partialChunk.index}`, name: "", arguments: "" }
							toolCallsByIndex.set(partialChunk.index, existing)
						}
						if (partialChunk.id) existing.id = partialChunk.id
						if (partialChunk.name) existing.name = partialChunk.name
						if (partialChunk.arguments) existing.arguments += partialChunk.arguments
					} else if (chunk.type === "tool_call_end") {
						// Tool call completed - move from index-based to id-based map
						const endChunk = chunk as { type: "tool_call_end"; id: string }
						for (const [, tc] of toolCallsByIndex) {
							if (tc.id === endChunk.id && tc.name) {
								toolCalls.set(tc.id, tc)
							}
						}
					}
				}

				// Also add any remaining partial tool calls that didn't get an end event
				for (const [, tc] of toolCallsByIndex) {
					if (tc.id && tc.name && !toolCalls.has(tc.id)) {
						toolCalls.set(tc.id, tc)
					}
				}

				// DEBUG: Summary of what was received
				console.log(`\n========== [ParallelUI] Task ${task.id} - RESPONSE SUMMARY ==========`)
				console.log(`[ParallelUI] Total chunks received: ${chunkCount}`)
				console.log(`[ParallelUI] Text content length: ${textContent.length}`)
				console.log(`[ParallelUI] Tool calls by index: ${toolCallsByIndex.size}`)
				console.log(`[ParallelUI] Tool calls collected: ${toolCalls.size}`)
				if (toolCallsByIndex.size > 0) {
					console.log(`[ParallelUI] Tool calls by index details:`)
					for (const [idx, tc] of toolCallsByIndex) {
						console.log(`  [${idx}] id=${tc.id}, name=${tc.name}, args=${tc.arguments.substring(0, 100)}...`)
					}
				}
				if (toolCalls.size > 0) {
					console.log(`[ParallelUI] Final tool calls:`)
					for (const [id, tc] of toolCalls) {
						console.log(`  [${id}] name=${tc.name}, args=${tc.arguments.substring(0, 100)}...`)
					}
				}
				console.log(`==========================================================\n`)

				// Add text content if any
				if (textContent) {
					assistantContent.push({ type: "text", text: textContent } as Anthropic.ContentBlock)
					console.log(`[ParallelUI] Task ${task.id} - AI responded with text: ${textContent.substring(0, 200)}...`)
				}

				// Convert tool calls to ContentBlocks
				console.log(`[ParallelUI] Task ${task.id} - Tool calls received: ${toolCalls.size}`)
				for (const [, toolCall] of toolCalls) {
					try {
						console.log(`[ParallelUI] Task ${task.id} - Tool call: ${toolCall.name}(${toolCall.arguments.substring(0, 100)}...)`)
						assistantContent.push({
							type: "tool_use",
							id: toolCall.id,
							name: toolCall.name,
							input: JSON.parse(toolCall.arguments || "{}"),
						})
					} catch {
						console.warn(`[ParallelUI] Failed to parse tool arguments: ${toolCall.arguments}`)
					}
				}

				// Process tool calls
				const toolUseBlocks = assistantContent.filter(
					(block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
				)

				if (toolUseBlocks.length === 0) {
					// No tool calls - this often means the model doesn't support tool use
					console.warn(`[ParallelUI] Task ${task.id} - No tool calls generated on iteration ${iterations}. Model may not support tool use.`)
					console.warn(`[ParallelUI] Task ${task.id} - Text response was: ${textContent.substring(0, 500)}`)

					// If this is the first iteration and no tool calls, the model likely doesn't support tool use
					if (iterations === 1) {
						console.error(`[ParallelUI] Task ${task.id} - CRITICAL: First iteration produced no tool calls. Model "${this.apiConfiguration?.apiModelId}" likely does not support native tool calling.`)
						throw new Error(
							`模型 "${this.apiConfiguration?.apiModelId}" 未生成任何工具調用。\n` +
							`並行 UI 功能需要支援原生 tool use 的模型 (如 Claude Sonnet/Opus)。\n` +
							`請切換到 Anthropic Claude 或其他支援工具調用的模型。`
						)
					}
					continueLoop = false
					break
				}

				// Execute tool calls in parallel using McpHub
				const toolResults = await Promise.all(
					toolUseBlocks.map(async (toolUse) => {
						const toolName = toolUse.name.replace("figma_", "")
						const args = toolUse.input as Record<string, unknown>

						// Add position offset for positioning tools
						const positioningTools = ["create_rectangle", "add_text", "create_frame", "set_position"]
						if (task.position && positioningTools.includes(toolName)) {
							// Default to 0 if not specified, then add offset
							const currentX = typeof args.x === "number" ? args.x : 0
							const currentY = typeof args.y === "number" ? args.y : 0
							args.x = currentX + task.position.x
							args.y = currentY + task.position.y
							console.log(`[ParallelUI] Task ${task.id} - Adjusted position for ${toolName}: (${currentX}, ${currentY}) -> (${args.x}, ${args.y})`)
						}

						onProgress?.(task.id, `calling ${toolName}`)

						try {
							// Use McpHub to execute the tool call
							const mcpResult = await this.mcpHub!.callTool(
								"figma-write",
								toolName,
								args
							)

							// Parse the result
							let resultData: any = {}
							if (mcpResult.content && mcpResult.content.length > 0) {
								const textContentBlock = mcpResult.content.find((c) => c.type === "text")
								if (textContentBlock && textContentBlock.type === "text") {
									try {
										resultData = JSON.parse(textContentBlock.text)
									} catch {
										resultData = { raw: textContentBlock.text }
									}
								}
							}

							if (resultData.nodeId || resultData.id) {
								nodeIds.push(resultData.nodeId || resultData.id)
							}

							return {
								type: "tool_result" as const,
								tool_use_id: toolUse.id,
								content: JSON.stringify({ success: true, nodeId: resultData.nodeId || resultData.id, data: resultData }),
							}
						} catch (error) {
							return {
								type: "tool_result" as const,
								tool_use_id: toolUse.id,
								content: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
							}
						}
					})
				)

				// Add assistant message and tool results to messages
				messages.push({
					role: "assistant",
					content: assistantContent,
				})

				messages.push({
					role: "user",
					content: toolResults,
				})

				// Check if we should continue (no tool calls means we're done)
				if (toolCalls.size === 0) {
					continueLoop = false
				}
			} catch (error) {
				console.error(`[ParallelUI] Error in task ${task.id}:`, error)
				throw error
			}
		}
	}

	/**
	 * Get the input schema for a Figma tool
	 * NOTE: Parameter names must match the Figma Write Bridge exactly!
	 */
	private getToolSchema(toolName: string): Anthropic.Tool["input_schema"] {
		const schemas: Record<string, Anthropic.Tool["input_schema"]> = {
			create_frame: {
				type: "object",
				properties: {
					name: { type: "string", description: "Frame name" },
					width: { type: "number", description: "Frame width in pixels" },
					height: { type: "number", description: "Frame height in pixels" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
				},
				required: ["width", "height"],
			},
			add_text: {
				type: "object",
				properties: {
					text: { type: "string", description: "Text content to display" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
					fontSize: { type: "number", description: "Font size in pixels" },
					fontFamily: { type: "string", description: "Font family (default: Inter)" },
				},
				required: ["text"],
			},
			create_rectangle: {
				type: "object",
				properties: {
					width: { type: "number", description: "Rectangle width in pixels" },
					height: { type: "number", description: "Rectangle height in pixels" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
					cornerRadius: { type: "number", description: "Corner radius for rounded corners" },
					hex: { type: "string", description: "Fill color as hex (e.g. #007AFF)" },
				},
				required: ["width", "height"],
			},
			set_fill: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "Node ID to apply fill to" },
					hex: { type: "string", description: "Color as hex (e.g. #FF0000)" },
					opacity: { type: "number", description: "Opacity 0-1" },
				},
				required: ["nodeId", "hex"],
			},
			set_position: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "Node ID to move" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
				},
				required: ["nodeId", "x", "y"],
			},
			group_nodes: {
				type: "object",
				properties: {
					nodeIds: {
						type: "array",
						items: { type: "string" },
						description: "Array of node IDs to group",
					},
					name: { type: "string", description: "Group name" },
				},
				required: ["nodeIds"],
			},
			set_text_color: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "Text node ID" },
					hex: { type: "string", description: "Color as hex (e.g. #FFFFFF)" },
					opacity: { type: "number", description: "Opacity 0-1" },
				},
				required: ["nodeId", "hex"],
			},
			find_nodes: {
				type: "object",
				properties: {
					type: { type: "string", description: "Node type filter (e.g. TEXT, FRAME, RECTANGLE)" },
					nameContains: { type: "string", description: "Filter by name containing this string" },
					within: { type: "string", description: "Search within this node ID" },
				},
				required: [],
			},
			delete_node: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "ID of the node to delete" },
				},
				required: ["nodeId"],
			},
		}

		return schemas[toolName] || { type: "object", properties: {} }
	}
}

// Export singleton getter
export function getParallelUIService(): ParallelUIService {
	return ParallelUIService.getInstance()
}
