/**
 * Parallel UI Tasks Tool
 *
 * Enables multiple AI agents to draw UI elements in Figma simultaneously.
 * Each task is assigned to a separate AI agent that works independently.
 */

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	ParallelUIService,
	getParallelUIService,
	UITaskDefinition,
	ParallelUIResult,
} from "../../services/figma/ParallelUIService"

interface ParallelUITasksParams {
	tasks: string // JSON array of UITaskDefinition objects
}

interface ParsedTask {
	id: string
	description: string
	targetFrame?: string
	position?: { x: number; y: number }
	designSpec?: {
		width?: number
		height?: number
		style?: string
		/** Colors: [0] = background, [1] = text */
		colors?: string[]
		/** Corner radius for rounded elements */
		cornerRadius?: number
		/** Font size for text */
		fontSize?: number
		/** Explicit text content to display */
		text?: string
	}
}

export class ParallelUITasksTool extends BaseTool<"parallel_ui_tasks"> {
	readonly name = "parallel_ui_tasks" as const

	parseLegacy(params: Partial<Record<string, string>>): ParallelUITasksParams {
		return {
			tasks: params.tasks || "[]",
		}
	}

	async execute(params: ParallelUITasksParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Validate tasks parameter
			if (!params.tasks) {
				task.consecutiveMistakeCount++
				task.recordToolError("parallel_ui_tasks")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("parallel_ui_tasks", "tasks"))
				return
			}

			// Parse tasks JSON
			let parsedTasks: ParsedTask[]
			try {
				parsedTasks = typeof params.tasks === "string" ? JSON.parse(params.tasks) : params.tasks
			} catch (error) {
				task.consecutiveMistakeCount++
				task.recordToolError("parallel_ui_tasks")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						"Invalid tasks format. Expected a JSON array of task definitions.\n\n" +
							"Each task should have:\n" +
							"- id: string (unique identifier, e.g. 'btn-1')\n" +
							"- description: string (what UI to create, e.g. 'Calculator button 7')\n" +
							"- position: { x: number, y: number } (optional, auto-assigned if not provided)\n" +
							"- designSpec: (optional) {\n" +
							"    width: number (default 350px),\n" +
							"    height: number (default 250px),\n" +
							"    colors: [background, text] (e.g. ['#3498db', '#FFFFFF']),\n" +
							"    cornerRadius: number (default 8),\n" +
							"    fontSize: number (default 16),\n" +
							"    text: string (explicit text to display)\n" +
							"  }\n\n" +
							"Example for 9 calculator buttons:\n" +
							"[\n" +
							'  { "id": "btn-7", "description": "Button 7", "designSpec": { "text": "7", "colors": ["#333333", "#FFFFFF"] } },\n' +
							'  { "id": "btn-8", "description": "Button 8", "designSpec": { "text": "8", "colors": ["#333333", "#FFFFFF"] } },\n' +
							"  ...\n" +
							"]"
					)
				)
				return
			}

			// Validate tasks array
			if (!Array.isArray(parsedTasks) || parsedTasks.length === 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("parallel_ui_tasks")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError("Tasks must be a non-empty array"))
				return
			}

			// Validate each task
			for (const t of parsedTasks) {
				if (!t.id || !t.description) {
					task.consecutiveMistakeCount++
					task.recordToolError("parallel_ui_tasks")
					task.didToolFailInCurrentTurn = true
					pushToolResult(
						formatResponse.toolError(`Each task must have 'id' and 'description'. Invalid task: ${JSON.stringify(t)}`)
					)
					return
				}
			}

			task.consecutiveMistakeCount = 0

			// Calculate grid layout dynamically based on number of tasks
			// For buttons/small elements, use smaller cells
			const taskCount = parsedTasks.length
			const isSmallElements = parsedTasks.some(t =>
				t.description.toLowerCase().includes("button") ||
				t.description.toLowerCase().includes("按鈕") ||
				(t.designSpec?.width && t.designSpec.width <= 150)
			)

			// Dynamic grid: calculate optimal columns based on task count
			// For small elements (buttons): use 3-4 columns
			// For larger elements: use 2 columns
			const GRID_COLUMNS = isSmallElements
				? Math.min(Math.ceil(Math.sqrt(taskCount)), 4) // 3x3 for 9, 4x4 for 16, etc.
				: Math.min(Math.ceil(Math.sqrt(taskCount)), 3)

			// Dynamic cell size based on element type
			const CELL_WIDTH = isSmallElements ? 120 : 400
			const CELL_HEIGHT = isSmallElements ? 80 : 300
			const START_X = 100
			const START_Y = 100

			console.log(`[ParallelUI] Grid layout: ${GRID_COLUMNS} columns, ${CELL_WIDTH}x${CELL_HEIGHT}px cells, ${taskCount} tasks`)

			// Show approval message with position and color info
			const taskSummary = parsedTasks
				.map((t, i) => {
					const pos = t.position || {
						x: START_X + (i % GRID_COLUMNS) * CELL_WIDTH,
						y: START_Y + Math.floor(i / GRID_COLUMNS) * CELL_HEIGHT,
					}
					const colorInfo = t.designSpec?.colors?.[0]
						? ` 🎨 ${t.designSpec.colors[0]}`
						: ""
					const textInfo = t.designSpec?.text ? ` "${t.designSpec.text}"` : ""
					return `${i + 1}. [${t.id}] ${t.description}${textInfo}${colorInfo} @ (${pos.x}, ${pos.y})`
				})
				.join("\n")

			const toolMessage = JSON.stringify({
				tool: "parallelUITasks",
				taskCount: parsedTasks.length,
				tasks: taskSummary,
			})

			await task.say("text", `🎨 Starting ${parsedTasks.length} parallel UI drawing tasks:\n${taskSummary}\n\n📍 Grid layout: ${GRID_COLUMNS} columns, ${CELL_WIDTH}x${CELL_HEIGHT}px cells`)

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			// Get the parallel UI service
			const service = getParallelUIService()

			// Configure the service with current API settings
			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const state = await provider.getState()
			if (!state) {
				pushToolResult(formatResponse.toolError("Could not get provider state"))
				return
			}

			// Get McpHub for Figma tool calls
			const mcpHub = provider.getMcpHub?.()

			service.configure(state.apiConfiguration, provider.context?.extensionPath || "", mcpHub)

			// Separate display/container tasks from button tasks
			const displayTasks = parsedTasks.filter(t =>
				t.description.toLowerCase().includes("display") ||
				t.description.toLowerCase().includes("顯示") ||
				t.description.toLowerCase().includes("container") ||
				t.description.toLowerCase().includes("背景") ||
				t.description.toLowerCase().includes("框架")
			)
			const buttonTasks = parsedTasks.filter(t => !displayTasks.includes(t))

			// Calculate container dimensions
			const buttonRows = Math.ceil(buttonTasks.length / GRID_COLUMNS)
			const containerWidth = GRID_COLUMNS * CELL_WIDTH + 40  // +40 for padding
			const containerHeight = buttonRows * CELL_HEIGHT + 120  // +120 for display area and padding
			const containerX = START_X - 20
			const containerY = START_Y - 100  // Space for display area

			// Step 0: Create the main container frame (background)
			if (mcpHub) {
				await task.say("text", `📦 Creating container frame using create_frame (${containerWidth}x${containerHeight}px)...`)
				try {
					// Use create_frame for proper Figma frame container
					const frameResult = await mcpHub.callTool("figma-write", "create_frame", {
						name: "Calculator Container",
						width: containerWidth,
						height: containerHeight,
						x: containerX,
						y: containerY,
					})

					// Get the frame's nodeId to set its fill color
					let frameNodeId: string | undefined
					if (frameResult.content && frameResult.content.length > 0) {
						const textContent = frameResult.content.find((c) => c.type === "text")
						if (textContent && textContent.type === "text") {
							try {
								const data = JSON.parse(textContent.text)
								frameNodeId = data.nodeId || data.id
								console.log(`[ParallelUI] Container frame created with nodeId: ${frameNodeId}`)
							} catch {
								console.warn(`[ParallelUI] Could not parse frame result`)
							}
						}
					}

					// Set the frame's background color using set_fill
					if (frameNodeId) {
						await mcpHub.callTool("figma-write", "set_fill", {
							nodeId: frameNodeId,
							hex: "#1E1E1E",  // Dark background
						})
						await task.say("text", `✅ Container frame created with dark background`)
					} else {
						await task.say("text", `⚠️ Container frame created but could not set background color`)
					}
				} catch (error) {
					console.warn(`[ParallelUI] Failed to create container frame:`, error)
					await task.say("text", `⚠️ Failed to create container frame: ${error}`)
				}
			}

			// Step 1: Create display/container elements (sequential)
			if (displayTasks.length > 0) {
				await task.say("text", `📺 Creating ${displayTasks.length} display element(s)...`)

				for (const displayTask of displayTasks) {
					try {
						if (mcpHub) {
							const width = displayTask.designSpec?.width || (containerWidth - 40)
							const height = displayTask.designSpec?.height || 60
							const bgColor = displayTask.designSpec?.colors?.[0] || "#2D2D2D"
							const textColor = displayTask.designSpec?.colors?.[1] || "#FFFFFF"
							const cornerRadius = displayTask.designSpec?.cornerRadius || 8

							// Create display rectangle inside container
							await mcpHub.callTool("figma-write", "create_rectangle", {
								width,
								height,
								x: START_X,
								y: containerY + 20,  // Inside container, at top
								cornerRadius,
								hex: bgColor,
							})

							// Add display text if specified
							if (displayTask.designSpec?.text) {
								const textResult = await mcpHub.callTool("figma-write", "add_text", {
									text: displayTask.designSpec.text,
									x: START_X + width - 60,  // Right-align
									y: containerY + 30,
									fontSize: displayTask.designSpec?.fontSize || 32,
								})

								// Set text color
								if (textResult.content && textResult.content.length > 0) {
									const textContent = textResult.content.find((c) => c.type === "text")
									if (textContent && textContent.type === "text") {
										try {
											const data = JSON.parse(textContent.text)
											const textNodeId = data.nodeId || data.id
											if (textNodeId) {
												await mcpHub.callTool("figma-write", "set_text_color", {
													nodeId: textNodeId,
													hex: textColor,
												})
											}
										} catch {}
									}
								}
							}

							await task.say("text", `✅ Created: ${displayTask.description}`)
						}
					} catch (error) {
						console.warn(`[ParallelUI] Failed to create display task ${displayTask.id}:`, error)
					}
				}
			}

			// Step 2: Convert button tasks to UITaskDefinition format with auto-assigned positions
			// Uses the same GRID_COLUMNS, CELL_WIDTH, etc. defined above
			if (buttonTasks.length === 0) {
				pushToolResult(formatResponse.toolResult("All tasks were display/container elements. No button tasks to parallelize."))
				return
			}

			const uiTasks: UITaskDefinition[] = buttonTasks.map((t, index) => {
				// Auto-assign position if not specified
				const autoPosition = {
					x: START_X + (index % GRID_COLUMNS) * CELL_WIDTH,
					y: START_Y + Math.floor(index / GRID_COLUMNS) * CELL_HEIGHT,
				}

				const position = t.position || autoPosition
				const designSpec = t.designSpec || {}

				// Log task details
				const colorInfo = designSpec.colors?.length
					? `colors: [${designSpec.colors.join(", ")}]`
					: "default colors"
				console.log(`[ParallelUI] Task "${t.id}" @ (${position.x}, ${position.y}) - ${colorInfo}`)

				return {
					id: t.id,
					description: t.description,
					targetFrame: t.targetFrame,
					position,
					designSpec: {
						width: designSpec.width || CELL_WIDTH - 30,
						height: designSpec.height || CELL_HEIGHT - 20,
						style: designSpec.style,
						colors: designSpec.colors || ["#3498db", "#FFFFFF"],
						cornerRadius: designSpec.cornerRadius || 8,
						fontSize: designSpec.fontSize || 24,
						text: designSpec.text,
					},
				}
			})

			// Execute parallel tasks with progress updates
			await task.say("text", `🚀 Launching ${buttonTasks.length} parallel AI agents for buttons...`)

			const result = await service.executeParallelTasks(uiTasks, (taskId, status) => {
				// Log progress (could be enhanced to show in UI)
				console.log(`[ParallelUI] Task ${taskId}: ${status}`)
			})

			// Report results
			const displayInfo = displayTasks.length > 0 ? `\n- Display/container elements: ${displayTasks.length} (created sequentially)` : ""

			if (result.success) {
				await task.say(
					"text",
					`✅ All ${buttonTasks.length} parallel button tasks completed successfully!\n\n` +
						`📊 Summary:\n` +
						`- Total duration: ${result.totalDuration}ms\n` +
						`- Button nodes created: ${result.results.reduce((sum, r) => sum + r.nodeIds.length, 0)}` +
						displayInfo + `\n\n` +
						`📝 Task Results:\n` +
						result.results
							.map(
								(r) =>
									`  • [${r.taskId}] ${r.success ? "✓" : "✗"} - ${r.nodeIds.length} nodes (${r.duration}ms)`
							)
							.join("\n")
				)
			} else {
				const failed = result.results.filter((r) => !r.success)
				await task.say(
					"text",
					`⚠️ Parallel UI tasks partially completed.\n\n` +
						`📊 Summary: ${result.results.filter((r) => r.success).length}/${buttonTasks.length} buttons succeeded` +
						displayInfo + `\n\n` +
						`❌ Failed tasks:\n` +
						failed.map((r) => `  • [${r.taskId}]: ${r.error}`).join("\n")
				)
			}

			pushToolResult(
				formatResponse.toolResult(
					`Parallel UI drawing completed.\n\n${result.summary}\n\n` +
						`Detailed results:\n${JSON.stringify(result.results, null, 2)}`
				)
			)
		} catch (error) {
			await handleError("executing parallel UI tasks", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"parallel_ui_tasks">): Promise<void> {
		const nativeArgs = block.nativeArgs as { tasks?: string } | undefined
		const tasks = nativeArgs?.tasks

		const partialMessage = JSON.stringify({
			tool: "parallelUITasks",
			tasks: tasks || "(streaming...)",
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const parallelUITasksTool = new ParallelUITasksTool()
