/**
 * Parallel UI Service
 *
 * Manages parallel execution of multiple AI agents for UI drawing.
 * Each agent handles a specific UI component/section independently.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, buildApiHandler } from "../../api"
import { FigmaWriteService, getFigmaWriteService, FIGMA_WRITE_TOOLS } from "./FigmaWriteService"
import { ProviderSettings } from "@roo-code/types"

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
		colors?: string[]
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
const UI_AGENT_SYSTEM_PROMPT = `You are a UI designer agent specialized in creating UI elements in Figma.
Your task is to create specific UI components using the Figma Write tools available to you.

IMPORTANT GUIDELINES:
1. Create clean, professional UI elements
2. Use appropriate spacing and alignment
3. Follow the design specifications provided
4. Use the position offsets to avoid overlapping with other agents' work
5. Return structured results about what you created

Available Figma Write Tools:
- create_frame: Create a container frame
- add_text: Add text elements
- rectangle: Create rectangles/buttons
- set_fill: Apply colors
- set_position: Position elements
- group_nodes: Group related elements

When done, respond with a JSON summary of created elements:
{
  "nodeIds": ["id1", "id2", ...],
  "description": "What was created"
}`

export class ParallelUIService {
	private static instance: ParallelUIService | null = null
	private apiConfiguration: ProviderSettings | null = null
	private extensionPath: string = ""

	private constructor() {}

	static getInstance(): ParallelUIService {
		if (!ParallelUIService.instance) {
			ParallelUIService.instance = new ParallelUIService()
		}
		return ParallelUIService.instance
	}

	/**
	 * Configure the service with API settings
	 */
	configure(apiConfiguration: ProviderSettings, extensionPath: string): void {
		this.apiConfiguration = apiConfiguration
		this.extensionPath = extensionPath
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

		// Ensure Figma Write Service is available
		let figmaService = getFigmaWriteService()
		if (!figmaService && this.extensionPath) {
			figmaService = FigmaWriteService.initialize(this.extensionPath)
		}

		if (!figmaService) {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "Figma Write Service not available",
			}
		}

		const isAvailable = await figmaService.isAvailable()
		if (!isAvailable) {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "Figma Write Bridge not connected. Please ensure the Figma plugin is running.",
			}
		}

		console.log(`[ParallelUI] Starting ${tasks.length} parallel UI tasks`)

		// Execute all tasks in parallel
		const taskPromises = tasks.map((task) =>
			this.executeSingleTask(task, figmaService!, onProgress)
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
		figmaService: FigmaWriteService,
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
			const response = await this.callAIForUITask(api, taskPrompt, figmaService, task, nodeIds, onProgress)

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
	 */
	private buildTaskPrompt(task: UITaskDefinition): string {
		let prompt = `Create the following UI element in Figma:\n\n`
		prompt += `Task: ${task.description}\n`

		if (task.targetFrame) {
			prompt += `Target Frame: ${task.targetFrame}\n`
		}

		if (task.position) {
			prompt += `Position: Start at x=${task.position.x}, y=${task.position.y}\n`
		}

		if (task.designSpec) {
			prompt += `Design Specifications:\n`
			if (task.designSpec.width) prompt += `  - Width: ${task.designSpec.width}px\n`
			if (task.designSpec.height) prompt += `  - Height: ${task.designSpec.height}px\n`
			if (task.designSpec.style) prompt += `  - Style: ${task.designSpec.style}\n`
			if (task.designSpec.colors?.length) {
				prompt += `  - Colors: ${task.designSpec.colors.join(", ")}\n`
			}
		}

		prompt += `\nPlease create this UI element now using the available Figma tools.`

		return prompt
	}

	/**
	 * Call AI to create UI and execute Figma commands
	 */
	private async callAIForUITask(
		api: ApiHandler,
		prompt: string,
		figmaService: FigmaWriteService,
		task: UITaskDefinition,
		nodeIds: string[],
		onProgress?: (taskId: string, status: string) => void
	): Promise<void> {
		// Build tools list for the AI
		const tools: Anthropic.Tool[] = FIGMA_WRITE_TOOLS.map((tool) => ({
			name: `figma_${tool.name}`,
			description: tool.description,
			input_schema: this.getToolSchema(tool.name),
		}))

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
				const stream = api.createMessage(UI_AGENT_SYSTEM_PROMPT, messages)

				let assistantContent: Anthropic.ContentBlock[] = []
				let stopReason: string | null = null

				for await (const chunk of stream) {
					if (chunk.type === "content_block_delta") {
						// Handle streaming content
					} else if (chunk.type === "message_stop" || chunk.type === "message_delta") {
						if ("delta" in chunk && chunk.delta && "stop_reason" in chunk.delta) {
							stopReason = chunk.delta.stop_reason
						}
					} else if (chunk.type === "content_block_start") {
						if (chunk.content_block) {
							assistantContent.push(chunk.content_block as Anthropic.ContentBlock)
						}
					}
				}

				// Process tool calls
				const toolUseBlocks = assistantContent.filter(
					(block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
				)

				if (toolUseBlocks.length === 0) {
					// No more tool calls, we're done
					continueLoop = false
					break
				}

				// Execute tool calls in parallel
				const toolResults = await Promise.all(
					toolUseBlocks.map(async (toolUse) => {
						const toolName = toolUse.name.replace("figma_", "")
						const args = toolUse.input as Record<string, unknown>

						// Add position offset if specified
						if (task.position && (args.x !== undefined || args.y !== undefined)) {
							if (typeof args.x === "number") args.x += task.position.x
							if (typeof args.y === "number") args.y += task.position.y
						}

						onProgress?.(task.id, `calling ${toolName}`)

						const result = await figmaService.callTool(toolName, args)

						if (result.success && result.nodeId) {
							nodeIds.push(result.nodeId)
						}

						return {
							type: "tool_result" as const,
							tool_use_id: toolUse.id,
							content: result.success
								? JSON.stringify({ success: true, nodeId: result.nodeId, data: result.data })
								: JSON.stringify({ success: false, error: result.error }),
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

				// Check if we should continue
				if (stopReason === "end_turn") {
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
	 */
	private getToolSchema(toolName: string): Anthropic.Tool["input_schema"] {
		const schemas: Record<string, Anthropic.Tool["input_schema"]> = {
			create_frame: {
				type: "object",
				properties: {
					name: { type: "string", description: "Frame name" },
					width: { type: "number", description: "Frame width" },
					height: { type: "number", description: "Frame height" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
				},
				required: ["width", "height"],
			},
			add_text: {
				type: "object",
				properties: {
					content: { type: "string", description: "Text content" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
					fontSize: { type: "number", description: "Font size" },
				},
				required: ["content"],
			},
			rectangle: {
				type: "object",
				properties: {
					width: { type: "number", description: "Rectangle width" },
					height: { type: "number", description: "Rectangle height" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
					cornerRadius: { type: "number", description: "Corner radius" },
				},
				required: ["width", "height"],
			},
			set_fill: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "Node ID to fill" },
					color: { type: "string", description: "Hex color code" },
				},
				required: ["nodeId", "color"],
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
						description: "Node IDs to group",
					},
					name: { type: "string", description: "Group name" },
				},
				required: ["nodeIds"],
			},
		}

		return schemas[toolName] || { type: "object", properties: {} }
	}
}

// Export singleton getter
export function getParallelUIService(): ParallelUIService {
	return ParallelUIService.getInstance()
}
