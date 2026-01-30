import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

import { TodoItem } from "@roo-code/types"

import { Task } from "../task/Task"
import { getModeBySlug } from "../../shared/modes"
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import { parseMarkdownChecklist } from "./UpdateTodoListTool"
import { Package } from "../../shared/package"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { SpecsManager, TaskExecutor } from "../specs"

interface NewTaskParams {
	mode: string
	message: string
	todos?: string
	/** Spec Mode: task ID from tasks.md to execute as subtask */
	specTask?: string
	/** Spec Mode: 'next' for auto-pick, 'specific' uses specTask, 'all' runs all */
	specMode?: "next" | "specific" | "all"
}

export class NewTaskTool extends BaseTool<"new_task"> {
	readonly name = "new_task" as const

	async execute(params: NewTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { mode, message, todos, specMode, specTask } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// ===========================================
			// Kiro-style Spec Mode: Execute from tasks.md
			// ===========================================
			if (specMode) {
				const result = await this.executeSpecMode(task, params, callbacks)
				if (result) {
					return // Spec mode handled the request
				}
				// Fall through to normal mode if spec mode couldn't handle it
			}

			// Validate required parameters.
			if (!mode) {
				task.consecutiveMistakeCount++
				task.recordToolError("new_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "mode"))
				return
			}

			if (!message) {
				task.consecutiveMistakeCount++
				task.recordToolError("new_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "message"))
				return
			}

			// Get the VSCode setting for requiring todos.
			const provider = task.providerRef.deref()

			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const state = await provider.getState()

			// Use Package.name (dynamic at build time) as the VSCode configuration namespace.
			// Supports multiple extension variants (e.g., stable/nightly) without hardcoded strings.
			const requireTodos = vscode.workspace
				.getConfiguration(Package.name)
				.get<boolean>("newTaskRequireTodos", false)

			// Check if todos are required based on VSCode setting.
			// Note: `undefined` means not provided, empty string is valid.
			if (requireTodos && todos === undefined) {
				task.consecutiveMistakeCount++
				task.recordToolError("new_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "todos"))
				return
			}

			// Parse todos if provided, otherwise use empty array
			let todoItems: TodoItem[] = []
			if (todos) {
				try {
					todoItems = parseMarkdownChecklist(todos)
				} catch (error) {
					task.consecutiveMistakeCount++
					task.recordToolError("new_task")
					task.didToolFailInCurrentTurn = true
					pushToolResult(formatResponse.toolError("Invalid todos format: must be a markdown checklist"))
					return
				}
			}

			task.consecutiveMistakeCount = 0

			// Un-escape one level of backslashes before '@' for hierarchical subtasks
			// Un-escape one level: \\@ -> \@ (removes one backslash for hierarchical subtasks)
			const unescapedMessage = message.replace(/\\\\@/g, "\\@")

			// Verify the mode exists
			const targetMode = getModeBySlug(mode, state?.customModes)

			if (!targetMode) {
				pushToolResult(formatResponse.toolError(`Invalid mode: ${mode}`))
				return
			}

			const toolMessage = JSON.stringify({
				tool: "newTask",
				mode: targetMode.name,
				content: message,
				todos: todoItems,
			})

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			// Delegate parent and open child as sole active task
			const child = await (provider as any).delegateParentAndOpenChild({
				parentTaskId: task.taskId,
				message: unescapedMessage,
				initialTodos: todoItems,
				mode,
			})

			// Reflect delegation in tool result (no pause/unpause, no wait)
			pushToolResult(`Delegated to child task ${child.taskId}`)
			return
		} catch (error) {
			await handleError("creating new task", error)
			return
		}
	}

	/**
	 * Execute Kiro-style Spec Mode: spawn subtasks from tasks.md
	 */
	private async executeSpecMode(
		task: Task,
		params: NewTaskParams,
		callbacks: ToolCallbacks
	): Promise<boolean> {
		const { pushToolResult, askApproval, handleError } = callbacks
		const { specMode, specTask, mode } = params

		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspacePath) {
			pushToolResult("❌ No workspace folder found. Cannot access specs files.")
			return true
		}

		const specsManager = new SpecsManager(workspacePath)
		const taskExecutor = new TaskExecutor(specsManager)

		// Sync state from tasks.md
		await taskExecutor.syncFromSpecs()

		const provider = task.providerRef.deref()
		if (!provider) {
			pushToolResult("❌ Provider reference lost")
			return true
		}

		const state = await provider.getState()

		switch (specMode) {
			case "next": {
				const nextTask = await taskExecutor.getNextTask()
				if (!nextTask) {
					const progress = await taskExecutor.getProgress()
					pushToolResult(
						`✅ **All tasks completed!**\n\n` +
						`📊 Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`
					)
					return true
				}

				return await this.spawnSpecSubtask(task, nextTask.id, nextTask.title, nextTask.description, mode, provider, state, taskExecutor, callbacks)
			}

			case "specific": {
				if (!specTask) {
					pushToolResult("❌ `specTask` is required when `specMode` is 'specific'")
					return true
				}

				const tasks = await taskExecutor.loadTasks()
				const targetTask = tasks.find((t) => t.id === specTask)

				if (!targetTask) {
					pushToolResult(`❌ Task not found: ${specTask}`)
					return true
				}

				return await this.spawnSpecSubtask(task, targetTask.id, targetTask.title, targetTask.description, mode, provider, state, taskExecutor, callbacks)
			}

			case "all": {
				let nextTask = await taskExecutor.getNextTask()
				let count = 0

				while (nextTask) {
					const success = await this.spawnSpecSubtask(task, nextTask.id, nextTask.title, nextTask.description, mode, provider, state, taskExecutor, callbacks)
					
					if (!success) {
						const progress = await taskExecutor.getProgress()
						pushToolResult(
							`⚠️ Stopped at task ${nextTask.id} (${count} completed)\n\n` +
							`📊 Progress: ${progress.completed}/${progress.total}`
						)
						return true
					}

					count++
					await taskExecutor.completeCurrentTask({ success: true })
					nextTask = await taskExecutor.getNextTask()
				}

				const progress = await taskExecutor.getProgress()
				pushToolResult(
					`✅ **Executed ${count} tasks!**\n\n` +
					`📊 Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`
				)
				return true
			}

			default:
				pushToolResult(`❌ Unknown specMode: ${specMode}`)
				return true
		}
	}

	/**
	 * Spawn a subtask for a spec task item
	 */
	private async spawnSpecSubtask(
		parentTask: Task,
		taskId: string,
		title: string,
		description: string | undefined,
		targetMode: string | undefined,
		provider: any,
		state: any,
		taskExecutor: TaskExecutor,
		callbacks: ToolCallbacks
	): Promise<boolean> {
		const { askApproval, pushToolResult } = callbacks

		// Mark task as in-progress in tasks.md
		await taskExecutor.startFromTask(taskId)

		// Build subtask message
		const subtaskMessage = [
			`## 📋 Spec Mode Task: ${taskId}`,
			"",
			`**Task:** ${title}`,
			description ? `\n**Description:** ${description}` : "",
			"",
			"---",
			"",
			"Execute this task according to the specifications in `.specs/tasks.md`.",
			"When complete, the task status will be automatically updated.",
		].join("\n")

		// Create tool message for approval
		const toolMessage = JSON.stringify({
			tool: "newTask",
			mode: targetMode || "code",
			content: `[Spec Mode] ${taskId}: ${title}`,
			specMode: true,
			taskId,
		})

		const didApprove = await askApproval("tool", toolMessage)
		if (!didApprove) {
			return false
		}

		// Determine mode from task (or use default)
		const resolvedMode = targetMode || "code"
		const modeConfig = getModeBySlug(resolvedMode, state?.customModes)
		if (!modeConfig) {
			pushToolResult(`❌ Invalid mode: ${resolvedMode}`)
			return false
		}

		// Delegate to child task
		const child = await provider.delegateParentAndOpenChild({
			parentTaskId: parentTask.taskId,
			message: subtaskMessage,
			initialTodos: [],
			mode: resolvedMode,
		})

		pushToolResult(
			`🚀 **Started Spec Task: ${taskId}**\n\n` +
			`- **Title:** ${title}\n` +
			`- **Mode:** ${modeConfig.name}\n` +
			`- **Child Task:** ${child.taskId}`
		)

		return true
	}

	override async handlePartial(task: Task, block: ToolUse<"new_task">): Promise<void> {
		const mode: string | undefined = block.params.mode
		const message: string | undefined = block.params.message
		const todos: string | undefined = block.params.todos

		const partialMessage = JSON.stringify({
			tool: "newTask",
			mode: mode ?? "",
			content: message ?? "",
			todos: todos,
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const newTaskTool = new NewTaskTool()

