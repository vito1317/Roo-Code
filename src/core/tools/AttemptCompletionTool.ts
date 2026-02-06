import * as vscode from "vscode"

import { RooCodeEventName, type HistoryItem } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { Package } from "../../shared/package"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface AttemptCompletionParams {
	result: string
	command?: string
}

export interface AttemptCompletionCallbacks extends ToolCallbacks {
	askFinishSubTaskApproval: () => Promise<boolean>
	toolDescription: () => string
}

/**
 * Interface for provider methods needed by AttemptCompletionTool for delegation handling.
 */
interface DelegationProvider {
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void>
}

export class AttemptCompletionTool extends BaseTool<"attempt_completion"> {
	readonly name = "attempt_completion" as const

	async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
		const { result } = params
		const { handleError, pushToolResult, askFinishSubTaskApproval } = callbacks

		// Prevent attempt_completion if any tool failed in the current turn
		if (task.didToolFailInCurrentTurn) {
			const errorMsg = t("common:errors.attempt_completion_tool_failed")

			await task.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		const preventCompletionWithOpenTodos = vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("preventCompletionWithOpenTodos", false)

		const hasIncompleteTodos = task.todoList && task.todoList.some((todo) => todo.status !== "completed")

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			task.consecutiveMistakeCount++
			task.recordToolError("attempt_completion")

			pushToolResult(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)

			return
		}

		// ========================================
		// Spec Mode: Handle phase completion and transition
		// ========================================
		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		
		if (state?.mode === "spec") {
			try {
				const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
				if (workspacePath) {
					const { checkSpecFilesStatus, determineCurrentPhase, SPEC_MIN_LINES, approvePhase, getApprovedPhases } = await import("../specs/SpecModeContextProvider")
					const specStatus = checkSpecFilesStatus(workspacePath)
					const currentPhase = determineCurrentPhase(specStatus, workspacePath)
					const approvedPhases = getApprovedPhases(workspacePath)
					
					// Check if current phase file is INCOMPLETE - block completion
					let blockMessage = ""
					
					if (currentPhase === "requirements" && !specStatus.requirementsComplete) {
						blockMessage = `🚫 **BLOCKED: requirements.md 尚未完成！**\n\n` +
							`目前行數: ${specStatus.requirementsLineCount} 行\n` +
							`最低要求: ${SPEC_MIN_LINES.requirements} 行\n\n` +
							`請繼續使用 \`<!-- APPEND -->\` 添加更多內容，直到達到最低行數要求。`
					} else if (currentPhase === "design" && !specStatus.designComplete) {
						blockMessage = `🚫 **BLOCKED: design.md 尚未完成！**\n\n` +
							`目前行數: ${specStatus.designLineCount} 行\n` +
							`最低要求: ${SPEC_MIN_LINES.design} 行\n\n` +
							`請繼續使用 \`<!-- APPEND -->\` 添加更多內容，直到達到最低行數要求。`
					} else if (currentPhase === "tasks" && !specStatus.tasksComplete) {
						blockMessage = `🚫 **BLOCKED: tasks.md 尚未完成！**\n\n` +
							`目前行數: ${specStatus.tasksLineCount} 行\n` +
							`最低要求: ${SPEC_MIN_LINES.tasks} 行\n\n` +
							`請繼續使用 \`<!-- APPEND -->\` 添加更多內容，直到達到最低行數要求。`
					}
					
					if (blockMessage) {
						task.consecutiveMistakeCount++
						task.recordToolError("attempt_completion")
						pushToolResult(formatResponse.toolError(blockMessage))
						console.log(`[AttemptCompletionTool] BLOCKED: Spec Mode ${currentPhase} phase incomplete`)
						return
					}
					
					// Phase file is COMPLETE - check if we need to show transition popup
					// For requirements and design phases, show popup to ask for next phase
					
					// Extract original user prompt for context continuity
					let originalUserPrompt = ""
					const history = task.clineMessages || []
					const firstUserMessage = history.find(m => m.type === "say" && m.say === "user_feedback")
					if (firstUserMessage?.text) {
						originalUserPrompt = firstUserMessage.text
					}
					
					if (currentPhase === "requirements" && specStatus.requirementsComplete && !approvedPhases.requirements) {
						// Requirements complete, show popup to transition to design
						const choice = await vscode.window.showInformationMessage(
							`✅ Requirements 已完成！(${specStatus.requirementsLineCount} 行)\n是否進入 Design 階段？`,
							{ modal: true },
							"進入 Design 階段",
							"繼續編輯 Requirements"
						)
						
						if (choice === "進入 Design 階段") {
						// Approve requirements phase
						approvePhase(workspacePath, "requirements")
						console.log(`[AttemptCompletionTool] User approved requirements phase, transitioning to design`)
						
						// Create new task for design phase with rich context
				const designTaskPrompt = `## 🎨 Design 階段

### 📝 使用者原始需求
${originalUserPrompt ? `> ${originalUserPrompt.split('\n').slice(0, 5).join('\n> ')}` : '> [請讀取 .specs/requirements.md 了解原始需求]'}

### 任務
請根據 requirements.md 建立設計文件 (.specs/design.md)：

1. 先用 read_file 讀取 .specs/requirements.md
2. 建立 design.md 包含：
   - 系統架構圖 (Mermaid)
   - 資料庫設計 (ERD)
   - API 規格

完成後使用 attempt_completion 結束。`

						// Create and trigger new task
						const newTask = await provider?.createTask(designTaskPrompt)
						if (newTask) {
							// Trigger task execution with fresh system prompt
							setTimeout(() => {
								newTask.handleWebviewAskResponse("messageResponse", designTaskPrompt)
							}, 200)
						}
						
						pushToolResult(`✅ Requirements 階段已完成！Design 階段任務已啟動。`)
						return
						} else {
							// User wants to continue editing
							pushToolResult(`📝 繼續編輯 requirements.md。完成後再次調用 attempt_completion。`)
							return
						}
					} else if (currentPhase === "design" && specStatus.designComplete && !approvedPhases.design) {
						// Design complete, show popup to transition to tasks
						const choice = await vscode.window.showInformationMessage(
							`✅ Design 已完成！(${specStatus.designLineCount} 行)\n是否進入 Tasks 階段？`,
							{ modal: true },
							"進入 Tasks 階段",
							"繼續編輯 Design"
						)
						
						if (choice === "進入 Tasks 階段") {
					// Approve design phase
					approvePhase(workspacePath, "design")
					console.log(`[AttemptCompletionTool] User approved design phase, transitioning to tasks`)
					
					// Create new task for tasks phase with rich context
				const tasksTaskPrompt = `## ✅ Tasks 階段

### 📝 使用者原始需求
${originalUserPrompt ? `> ${originalUserPrompt.split('\n').slice(0, 5).join('\n> ')}` : '> [請讀取 .specs/requirements.md 了解原始需求]'}

### 任務
請根據 requirements.md 和 design.md 建立任務列表 (.specs/tasks.md)：

1. 先用 read_file 讀取 .specs/requirements.md 和 .specs/design.md
2. 建立 tasks.md 包含：
   - 任務分解 (TASK-001, TASK-002...)
   - 每個任務的驗收標準
   - TDD 測試案例
   - 任務依賴關係

完成後使用 attempt_completion 結束。`

					// Create and trigger new task
					const newTask = await provider?.createTask(tasksTaskPrompt)
					if (newTask) {
						// Trigger task execution with fresh system prompt
						setTimeout(() => {
							newTask.handleWebviewAskResponse("messageResponse", tasksTaskPrompt)
						}, 200)
					}
					
					pushToolResult(`✅ Design 階段已完成！Tasks 階段任務已啟動。`)
					return
						} else {
							// User wants to continue editing
							pushToolResult(`📝 繼續編輯 design.md。完成後再次調用 attempt_completion。`)
							return
						}
					}
					// Tasks phase complete or already approved - allow normal completion
				}
			} catch (e) {
				console.error(`[AttemptCompletionTool] Error checking spec status:`, e)
			}
		}


		try {
			if (!result) {
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion")
				pushToolResult(await task.sayAndCreateMissingParamError("attempt_completion", "result"))
				return
			}

			task.consecutiveMistakeCount = 0

			// ========================================
			// Sentinel Edition: FSM Interception
			// ========================================
			// When Sentinel FSM is active and we're not at the final SENTINEL agent,
			// intercept the completion and trigger a handoff to the next agent.
			const sentinelFSM = task.sentinelStateMachine
			if (sentinelFSM && sentinelFSM.isActive()) {
				const { AgentState } = await import("../sentinel/StateMachine")
				const currentState = sentinelFSM.getCurrentState()

				// Only intercept if not at the final SENTINEL stage
				// (SENTINEL agent completing means the workflow is done)
				// Only intercept if not at terminal/review states
			// Only intercept if not at terminal/review states
			// Review states auto-pass and shouldn't be intercepted (they use Architect mode)
			// BUT ARCHITECT_REVIEW_FINAL should trigger COMPLETED transition for walkthrough
			const isCompleted = currentState === AgentState.COMPLETED
			const isFinalReview = currentState === AgentState.ARCHITECT_REVIEW_FINAL
			
			if (isFinalReview) {
				// ARCHITECT_REVIEW_FINAL completing means workflow is done
				// Trigger transition to COMPLETED which generates the walkthrough
				await task.say(
					"text",
					`🎉 **Final Review Complete!** Transitioning to COMPLETED state and generating walkthrough...`,
				)
				
				// Build handoff data for final review
				const handoffData: Partial<import("../sentinel/HandoffContext").HandoffContext> = {
					architectFinalReview: {
						approved: true,
						finalFeedback: result,
						securityAcceptable: true,
						readyForDeployment: true,
					},
					previousAgentNotes: result,
				}
				
				// Trigger FSM transition to COMPLETED (this generates the walkthrough)
				const transitionResult = await sentinelFSM.handleAgentCompletion(handoffData)
				
				if (transitionResult.success) {
					await task.say(
						"text",
						`✅ **Sentinel Workflow Complete!**`,
					)
				} else {
					await task.say(
						"text",
						`⚠️ **Workflow transition failed:** ${transitionResult.error}`,
					)
				}
				
				// Continue with normal completion flow (shows result to user)
			} else if (!isCompleted) {
					// Extract handoff context from the result
					const handoffData = this.extractHandoffContextFromResult(result, currentState)

					await task.say(
						"text",
						`\ud83d\udd04 **Sentinel Mode:** Intercepting completion from ${currentState}. Initiating handoff...`,
					)

					// Trigger FSM transition
					const transitionResult = await sentinelFSM.handleAgentCompletion(handoffData)

					if (transitionResult.success) {
						// Inject the handoff context summary into the next agent's prompt
						const contextSummary = sentinelFSM.getContextSummary()

						// Get the next agent's persona information
						const { getAgentPersona } = await import("../sentinel/personas")
						const nextAgentSlug = sentinelFSM.getCurrentAgent()
						const nextPersona = getAgentPersona(nextAgentSlug)

						// Create a handoff message that will be sent as a "user" message
						// to continue the conversation with the next agent
						// IMPORTANT: Strong identity injection to prevent context pollution
						const previousAgentName = transitionResult.fromState?.replace("sentinel-", "").toUpperCase() || "Previous Agent"
						const currentAgentName = nextPersona?.name || transitionResult.toState
						const currentAgentSlug = nextAgentSlug || transitionResult.toState

						const handoffMessage =
							`# 🔄 Sentinel Agent Transition - IDENTITY RESET\n\n` +
							`## ⚠️ CRITICAL: YOU ARE NOW ${currentAgentName}\n\n` +
							`**你現在是 ${currentAgentName}**，不是其他任何角色！\n\n` +
							`- ❌ 你不是 ${previousAgentName}\n` +
							`- ❌ 上面對話中 ${previousAgentName} 完成的工作不是你做的\n` +
							`- ✅ 你是 **${currentAgentName}**，你的工作現在才開始\n\n` +
							`---\n\n` +
							`## 📋 來自 ${previousAgentName} 的交接內容\n\n` +
							`以下是 **${previousAgentName}** 完成的工作摘要（這不是你的工作！）：\n\n` +
							`${contextSummary || result}\n\n` +
							`---\n\n` +
							`## 🎯 ${currentAgentName} 的任務\n\n` +
							`現在請你以 **${currentAgentName}** 的身份，根據上面的交接內容開始你自己的工作。\n` +
							`按照你的角色定義（${currentAgentSlug}）執行任務。完成後使用 attempt_completion 交接給下一個代理。\n\n` +
							`**重要提醒：對話歷史中之前代理的工作不屬於你，請專注於你自己的職責！**`

						// CONTEXT SEPARATION: Clear conversation history BEFORE any UI updates
						// This prevents context pollution between agents
						console.log(`[Sentinel] Starting context separation: ${previousAgentName} → ${currentAgentName}`)

						await task.resetForSentinelHandoff(
							contextSummary || result,
							previousAgentName,
							currentAgentName,
						)

						// Wait a moment for the reset to fully complete
						await new Promise((resolve) => setTimeout(resolve, 100))

						// Force clear the API history again to be absolutely sure
						// This is a safety measure in case any async operations added messages
						const historyLengthBefore = task.apiConversationHistory.length
						if (historyLengthBefore > 0) {
							console.log(`[Sentinel] WARNING: API history not empty after reset (${historyLengthBefore} messages), forcing clear`)
							task.apiConversationHistory = []
						}

						await task.say(
							"text",
							`✅ **Sentinel Handoff Complete**\n\n` +
								`- **From:** ${transitionResult.fromState}\n` +
								`- **To:** ${transitionResult.toState}\n\n` +
								`The workflow continues with **${nextPersona?.name || transitionResult.toState}**.`,
						)

						// Resume the conversation by sending the handoff as a follow-up message
						// This triggers the next agent to start working immediately
						// NOTE: The conversation history has been cleared, so the new agent
						// starts with a clean slate and only sees the handoff message
						const provider = task.providerRef.deref()
						if (provider) {
							// Queue the handoff message to continue the conversation
							// Use a longer delay to ensure all state is properly cleared
							setTimeout(async () => {
								try {
									// Final safety check before sending handoff
									console.log(`[Sentinel] Sending handoff message. API history length: ${task.apiConversationHistory.length}`)
									await task.handleWebviewAskResponse("messageResponse", handoffMessage)
								} catch (err) {
									console.error("[Sentinel] Failed to send handoff continuation:", err)
								}
							}, 800) // Longer delay for stability
						}

						return // Don't proceed with normal completion
					} else {
						// Transition failed (possibly blocked)
						if (transitionResult.toState === AgentState.BLOCKED) {
							pushToolResult(
								`⚠️ **Workflow Blocked**\n\n` +
									`- **Reason:** ${transitionResult.error}\n\n` +
									`Human intervention is required. Please review the issues and decide how to proceed.`,
							)
						} else {
							pushToolResult(
								`❌ **Handoff Failed**\n\n` +
									`- **Error:** ${transitionResult.error}\n\n` +
									`Please provide the required context and try again.`,
							)
						}
					}

				return // Don't proceed with normal completion
			}
		}

			await task.say("completion_result", result, undefined, false)

			// Force final token usage update before emitting TaskCompleted
			// This ensures the most recent stats are captured regardless of throttle timer
			// and properly updates the snapshot to prevent redundant emissions
			task.emitFinalTokenUsageUpdate()

			TelemetryService.instance.captureTaskCompleted(task.taskId)
			task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)

			// Check for subtask using parentTaskId (metadata-driven delegation)
			if (task.parentTaskId) {
				// Check if this subtask has already completed and returned to parent
				// to prevent duplicate tool_results when user revisits from history
				const provider = task.providerRef.deref() as DelegationProvider | undefined
				if (provider) {
					try {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						const status = historyItem?.status

						if (status === "completed") {
							// Subtask already completed - skip delegation flow entirely
							// Fall through to normal completion ask flow below (outside this if block)
							// This shows the user the completion result and waits for acceptance
							// without injecting another tool_result to the parent
						} else if (status === "active") {
							// Normal subtask completion - do delegation
							const delegated = await this.delegateToParent(
								task,
								result,
								provider,
								askFinishSubTaskApproval,
								pushToolResult,
							)
							if (delegated) return
						} else {
							// Unexpected status (undefined or "delegated") - log error and skip delegation
							// undefined indicates a bug in status persistence during child creation
							// "delegated" would mean this child has its own grandchild pending (shouldn't reach attempt_completion)
							console.error(
								`[AttemptCompletionTool] Unexpected child task status "${status}" for task ${task.taskId}. ` +
									`Expected "active" or "completed". Skipping delegation to prevent data corruption.`,
							)
							// Fall through to normal completion ask flow
						}
					} catch (err) {
						// If we can't get the history, log error and skip delegation
						console.error(
							`[AttemptCompletionTool] Failed to get history for task ${task.taskId}: ${(err as Error)?.message ?? String(err)}. ` +
								`Skipping delegation.`,
						)
						// Fall through to normal completion ask flow
					}
				}
			}

			const { response, text, images } = await task.ask("completion_result", "", false)

			if (response === "yesButtonClicked") {
				return
			}

			// User provided feedback - push tool result to continue the conversation
			await task.say("user_feedback", text ?? "", images)

			const feedbackText = `<user_message>\n${text}\n</user_message>`
			pushToolResult(formatResponse.toolResult(feedbackText, images))
		} catch (error) {
			await handleError("inspecting site", error as Error)
		}
	}

	/**
	 * Handles the common delegation flow when a subtask completes.
	 * Returns true if delegation was performed and the caller should return early.
	 */
	private async delegateToParent(
		task: Task,
		result: string,
		provider: DelegationProvider,
		askFinishSubTaskApproval: () => Promise<boolean>,
		pushToolResult: (result: string) => void,
	): Promise<boolean> {
		const didApprove = await askFinishSubTaskApproval()

		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return true
		}

		pushToolResult("")

		await provider.reopenParentFromDelegation({
			parentTaskId: task.parentTaskId!,
			childTaskId: task.taskId,
			completionResultSummary: result,
		})

		return true
	}

	override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		const lastMessage = task.clineMessages.at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask === "command") {
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			} else {
				await task.say("completion_result", result ?? "", undefined, false)

				// Force final token usage update before emitting TaskCompleted for consistency
				task.emitFinalTokenUsageUpdate()

				TelemetryService.instance.captureTaskCompleted(task.taskId)
				task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)

				await task.ask("command", command ?? "", block.partial).catch(() => {})
			}
		} else {
			await task.say("completion_result", result ?? "", undefined, block.partial)
		}
	}

	/**
	 * Sentinel Edition: Extract handoff context from completion result
	 *
	 * Attempts to parse JSON from the result, or creates a basic context
	 * with the result as notes if JSON parsing fails.
	 */
	private extractHandoffContextFromResult(
		result: string,
		currentState: string,
	): Partial<import("../sentinel/HandoffContext").HandoffContext> {
		// Try to extract JSON from the result
		const jsonMatch = result.match(/```json\s*([\s\S]*?)```/)
		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[1])
				return this.buildHandoffDataFromParsed(parsed, currentState, result)
			} catch {
				// JSON parsing failed, fall through
			}
		}

		// Try to parse the entire result as JSON
		try {
			const trimmed = result.trim()
			if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
				const parsed = JSON.parse(trimmed)
				return this.buildHandoffDataFromParsed(parsed, currentState, result)
			}
		} catch {
			// Not valid JSON, fall through
		}

		// Return basic context with result as notes
		return {
			previousAgentNotes: result,
		}
	}

	/**
	 * Build typed handoff data from parsed JSON based on current agent
	 */
	private buildHandoffDataFromParsed(
		parsed: Record<string, unknown>,
		currentState: string,
		originalResult: string,
	): Partial<import("../sentinel/HandoffContext").HandoffContext> {
		const base: Partial<import("../sentinel/HandoffContext").HandoffContext> = {
			previousAgentNotes: originalResult,
		}

		// Import AgentState enum for comparison
		// Note: Using string comparison since we can't import statically
		switch (currentState) {
			case "sentinel-architect":
				return {
					...base,
					architectPlan: parsed as unknown as import("../sentinel/HandoffContext").ArchitectPlan,
				}

			case "sentinel-builder":
				return {
					...base,
					builderTestContext: parsed as unknown as import("../sentinel/HandoffContext").BuilderTestContext,
				}

			case "sentinel-qa":
				return {
					...base,
					qaAuditContext: parsed as unknown as import("../sentinel/HandoffContext").QAAuditContext,
				}

			case "sentinel-security":
				return {
					...base,
					sentinelResult: parsed as unknown as import("../sentinel/HandoffContext").SentinelAuditResult,
				}

			default:
				return base
		}
	}
}

export const attemptCompletionTool = new AttemptCompletionTool()
