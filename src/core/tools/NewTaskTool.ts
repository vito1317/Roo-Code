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

			// ========================================
			// Spec Mode: Block new_task if current phase file is incomplete
			// ========================================
			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			
			if (state?.mode === "spec") {
				try {
					const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
					if (workspacePath) {
						const { checkSpecFilesStatus, determineCurrentPhase, SPEC_MIN_LINES } = await import("../specs/SpecModeContextProvider")
						const specStatus = checkSpecFilesStatus(workspacePath)
						const currentPhase = determineCurrentPhase(specStatus, workspacePath)
						
						// Check if current phase file meets minimum requirements
						let blockMessage = ""
						
						if (currentPhase === "requirements" && !specStatus.requirementsComplete) {
							blockMessage = `🚫 **BLOCKED: 禁止建立子任務！requirements.md 尚未完成！**\n\n` +
								`目前行數: ${specStatus.requirementsLineCount} 行\n` +
								`最低要求: ${SPEC_MIN_LINES.requirements} 行\n\n` +
								`請繼續使用 \`<!-- APPEND -->\` 添加更多內容，直到達到最低行數要求。\n` +
								`系統會在檔案完成後自動建立下一個任務。`
						} else if (currentPhase === "design" && !specStatus.designComplete) {
							blockMessage = `🚫 **BLOCKED: 禁止建立子任務！design.md 尚未完成！**\n\n` +
								`目前行數: ${specStatus.designLineCount} 行\n` +
								`最低要求: ${SPEC_MIN_LINES.design} 行\n\n` +
								`請繼續使用 \`<!-- APPEND -->\` 添加更多內容，直到達到最低行數要求。\n` +
								`系統會在檔案完成後自動建立下一個任務。`
						} else if (currentPhase === "tasks" && !specStatus.tasksComplete) {
							blockMessage = `🚫 **BLOCKED: 禁止建立子任務！tasks.md 尚未完成！**\n\n` +
								`目前行數: ${specStatus.tasksLineCount} 行\n` +
								`最低要求: ${SPEC_MIN_LINES.tasks} 行\n\n` +
								`請繼續使用 \`<!-- APPEND -->\` 添加更多內容，直到達到最低行數要求。`
						}
						
						if (blockMessage) {
							task.consecutiveMistakeCount++
							task.recordToolError("new_task")
							task.didToolFailInCurrentTurn = true
							pushToolResult(blockMessage)
							console.log(`[NewTaskTool] BLOCKED: Spec Mode ${currentPhase} phase incomplete`)
							return
						}
					}
				} catch (e) {
					console.error(`[NewTaskTool] Error checking spec status:`, e)
				}
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
			// Note: provider was already declared above for Spec Mode check
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

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
	 * Enhanced to include full spec context (requirements.md, design.md) for proper handoffs
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

		// ========================================
		// Read spec files to inject full context
		// ========================================
		let requirementsContent = ""
		let designContent = ""
		let originalUserPrompt = ""

		try {
			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (workspacePath) {
				const specsDir = path.join(workspacePath, ".specs")
				
				// Read requirements.md
				const requirementsPath = path.join(specsDir, "requirements.md")
				try {
					requirementsContent = await fs.readFile(requirementsPath, "utf-8")
				} catch {
					requirementsContent = "[requirements.md not found]"
				}

				// Read design.md
				const designPath = path.join(specsDir, "design.md")
				try {
					designContent = await fs.readFile(designPath, "utf-8")
				} catch {
					designContent = "[design.md not found]"
				}

				// Try to get original user prompt from parent task history
				const history = parentTask.clineMessages || []
				const firstUserMessage = history.find(m => m.type === "say" && m.say === "user_feedback")
				if (firstUserMessage?.text) {
					originalUserPrompt = firstUserMessage.text
				} else {
					// Fallback: try to extract from first requirements.md heading
					const titleMatch = requirementsContent.match(/^#\s+(.+)$/m)
					if (titleMatch) {
						originalUserPrompt = titleMatch[1]
					}
				}
			}
		} catch (e) {
			console.error("[NewTaskTool] Error reading spec files:", e)
		}

		// ========================================
		// Build rich subtask message with full context
		// ========================================
		const subtaskMessage = [
			`## 📋 Spec Mode 任務: ${taskId}`,
			"",
			`**任務名稱:** ${title}`,
			description ? `\n**任務描述:** ${description}` : "",
			"",
			"---",
			"",
			"## 📝 使用者原始需求",
			"",
			originalUserPrompt ? `> ${originalUserPrompt.split('\n').slice(0, 5).join('\n> ')}` : "> [無法取得原始需求]",
			"",
			"---",
			"",
			"## 📄 需求規格書 (.specs/requirements.md)",
			"",
			"<details>",
			"<summary>點擊展開完整需求</summary>",
			"",
			"```markdown",
			requirementsContent.length > 3000 
				? requirementsContent.substring(0, 3000) + "\n\n... [內容過長，已截斷。請用 read_file 查看完整內容]"
				: requirementsContent,
			"```",
			"</details>",
			"",
			"---",
			"",
			"## 🎨 設計規格書 (.specs/design.md)",
			"",
			"<details>",
			"<summary>點擊展開完整設計</summary>",
			"",
			"```markdown",
			designContent.length > 3000
				? designContent.substring(0, 3000) + "\n\n... [內容過長，已截斷。請用 read_file 查看完整內容]"
				: designContent,
			"```",
			"</details>",
			"",
			"---",
			"",
			"## ⚡ 執行指示",
			"",
			"1. **仔細閱讀以上需求和設計文件**",
			"2. **根據設計規格完成此任務**",
			"3. **完成後系統會自動更新任務狀態**",
			"",
			`> 📌 完整規格位於 \`.specs/\` 目錄，如需更多細節請使用 \`read_file\` 工具查看。`,
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
			`- **Context Injected:** requirements.md + design.md\n` +
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

