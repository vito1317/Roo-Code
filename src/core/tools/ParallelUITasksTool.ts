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
		colors?: string[]
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
							"- id: string (unique identifier)\n" +
							"- description: string (what UI to create)\n" +
							"- position: { x: number, y: number } (optional, position offset)\n" +
							"- designSpec: { width, height, style, colors } (optional)"
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

			// Show approval message
			const taskSummary = parsedTasks
				.map((t, i) => `${i + 1}. [${t.id}] ${t.description}`)
				.join("\n")

			const toolMessage = JSON.stringify({
				tool: "parallelUITasks",
				taskCount: parsedTasks.length,
				tasks: taskSummary,
			})

			await task.say("text", `🎨 Starting ${parsedTasks.length} parallel UI drawing tasks:\n${taskSummary}`)

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

			service.configure(state.apiConfiguration, provider.context?.extensionPath || "")

			// Convert to UITaskDefinition format
			const uiTasks: UITaskDefinition[] = parsedTasks.map((t) => ({
				id: t.id,
				description: t.description,
				targetFrame: t.targetFrame,
				position: t.position,
				designSpec: t.designSpec,
			}))

			// Execute parallel tasks with progress updates
			await task.say("text", "🚀 Launching parallel AI agents...")

			const result = await service.executeParallelTasks(uiTasks, (taskId, status) => {
				// Log progress (could be enhanced to show in UI)
				console.log(`[ParallelUI] Task ${taskId}: ${status}`)
			})

			// Report results
			if (result.success) {
				await task.say(
					"text",
					`✅ All ${parsedTasks.length} parallel UI tasks completed successfully!\n\n` +
						`📊 Summary:\n` +
						`- Total duration: ${result.totalDuration}ms\n` +
						`- Total nodes created: ${result.results.reduce((sum, r) => sum + r.nodeIds.length, 0)}\n\n` +
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
						`📊 Summary: ${result.results.filter((r) => r.success).length}/${parsedTasks.length} succeeded\n\n` +
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
