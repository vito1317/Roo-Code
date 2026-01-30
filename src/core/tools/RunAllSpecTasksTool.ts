/**
 * Run All Spec Tasks Tool - Kiro-style One-Click Task Scheduling
 *
 * Executes all tasks from tasks.md in sequence with a single command.
 * Each task becomes a subtask that runs sequentially.
 */

import * as vscode from "vscode"

import { Task } from "../task/Task"
import { getModeBySlug } from "../../shared/modes"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { SpecsManager, TaskExecutor, TaskItem } from "../specs"

interface RunAllSpecTasksParams {
	/** Pause between tasks in milliseconds (default: 0) */
	pauseMs?: number
	/** Stop on first failure (default: true) */
	stopOnFailure?: boolean
	/** Target mode for all tasks (default: code) */
	mode?: string
}

export class RunAllSpecTasksTool extends BaseTool<"run_all_spec_tasks"> {
	readonly name = "run_all_spec_tasks" as const

	async execute(params: RunAllSpecTasksParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const { pauseMs = 0, stopOnFailure = true, mode = "code" } = params

		try {
			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (!workspacePath) {
				pushToolResult("❌ No workspace folder found. Cannot access specs files.")
				return
			}

			const specsManager = new SpecsManager(workspacePath)
			const taskExecutor = new TaskExecutor(specsManager)

			// Check if specs exist
			if (!(await specsManager.specsExists())) {
				pushToolResult(
					"❌ No `.specs/` directory found.\n\n" +
					"Create specs first using SpecsManager or ask the Architect to generate them."
				)
				return
			}

			// Load and sync tasks
			await taskExecutor.syncFromSpecs()
			const allTasks = await taskExecutor.loadTasks()

			if (allTasks.length === 0) {
				pushToolResult("❌ No tasks found in `.specs/tasks.md`")
				return
			}

			// Filter out completed tasks
			const pendingTasks = allTasks.filter((t) => t.status !== "done")

			if (pendingTasks.length === 0) {
				pushToolResult("✅ **All tasks already completed!**")
				return
			}

			// Show approval message with task list
			const taskList = pendingTasks
				.slice(0, 10) // Show first 10
				.map((t, i) => `${i + 1}. **${t.id}**: ${t.title}`)
				.join("\n")

			const moreCount = pendingTasks.length > 10 ? `\n... and ${pendingTasks.length - 10} more` : ""

			const toolMessage = JSON.stringify({
				tool: "runAllSpecTasks",
				taskCount: pendingTasks.length,
				mode,
				tasks: taskList + moreCount,
			})

			const didApprove = await askApproval("tool", toolMessage)
			if (!didApprove) {
				return
			}

			// Get provider and state
			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const state = await provider.getState()

			// Validate mode
			const modeConfig = getModeBySlug(mode, state?.customModes)
			if (!modeConfig) {
				pushToolResult(`❌ Invalid mode: ${mode}`)
				return
			}

			// Execute tasks sequentially
			let completedCount = 0
			let failedCount = 0
			const results: Array<{ taskId: string; success: boolean }> = []

			for (const specTask of pendingTasks) {
				// Check dependencies
				if (specTask.dependencies && specTask.dependencies.length > 0) {
					const allDepsComplete = specTask.dependencies.every((depId) =>
						results.some((r) => r.taskId === depId && r.success)
					)
					if (!allDepsComplete) {
						results.push({ taskId: specTask.id, success: false })
						failedCount++
						if (stopOnFailure) {
							pushToolResult(
								`⚠️ **Stopped at ${specTask.id}** - Dependencies not met\n\n` +
								`Completed: ${completedCount} | Failed: ${failedCount}`
							)
							return
						}
						continue
					}
				}

				// Mark as in-progress
				await specsManager.writeFile(
					"tasks",
					(await specsManager.readFile("tasks") || "").replace(
						new RegExp(`- \\[[ ]\\] \\*\\*${specTask.id}\\*\\*:`, "g"),
						`- [/] **${specTask.id}**:`
					)
				)

				// Build subtask message
				const subtaskMessage = this.buildSubtaskMessage(specTask)

				// Spawn subtask
				try {
					const child = await (provider as any).delegateParentAndOpenChild({
						parentTaskId: task.taskId,
						message: subtaskMessage,
						initialTodos: [],
						mode,
					})

					// Mark as done
					await specsManager.writeFile(
						"tasks",
						(await specsManager.readFile("tasks") || "").replace(
							new RegExp(`- \\[/\\] \\*\\*${specTask.id}\\*\\*:`, "g"),
							`- [x] **${specTask.id}**:`
						)
					)

					completedCount++
					results.push({ taskId: specTask.id, success: true })

					// Optional pause
					if (pauseMs > 0) {
						await new Promise((resolve) => setTimeout(resolve, pauseMs))
					}
				} catch (error) {
					failedCount++
					results.push({ taskId: specTask.id, success: false })

					if (stopOnFailure) {
						pushToolResult(
							`❌ **Failed at ${specTask.id}**\n\n` +
							`Error: ${error instanceof Error ? error.message : String(error)}\n\n` +
							`Completed: ${completedCount} | Failed: ${failedCount}`
						)
						return
					}
				}
			}

			// Final summary
			const progress = await taskExecutor.getProgress()
			pushToolResult(
				`✅ **Task Scheduling Complete!**\n\n` +
				`📊 **Results:**\n` +
				`- Completed: ${completedCount}\n` +
				`- Failed: ${failedCount}\n` +
				`- Total Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`
			)
		} catch (error) {
			await handleError("running all spec tasks", error)
		}
	}

	/**
	 * Build message for subtask
	 */
	private buildSubtaskMessage(specTask: TaskItem): string {
		const lines = [
			`## 📋 Spec Mode Task: ${specTask.id}`,
			"",
			`**Task:** ${specTask.title}`,
		]

		if (specTask.description) {
			lines.push("", `**Description:** ${specTask.description}`)
		}

		if (specTask.acceptanceCriteria && specTask.acceptanceCriteria.length > 0) {
			lines.push("", "**Acceptance Criteria:**")
			specTask.acceptanceCriteria.forEach((c) => lines.push(`- ${c}`))
		}

		lines.push(
			"",
			"---",
			"",
			"Execute this task according to `.specs/tasks.md`.",
			"Task status will be automatically updated upon completion."
		)

		return lines.join("\n")
	}

	override async handlePartial(task: Task, block: ToolUse<"run_all_spec_tasks">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "runAllSpecTasks",
			status: "preparing",
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const runAllSpecTasksTool = new RunAllSpecTasksTool()
