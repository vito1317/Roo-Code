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
						const handoffMessage =
							`# 🔄 Sentinel Handoff\n\n` +
							`**Previous Agent:** ${transitionResult.fromState}\n` +
							`**Current Agent:** ${nextPersona?.name || transitionResult.toState}\n\n` +
							`---\n\n` +
							`## Handoff Context\n\n` +
							`${contextSummary || result}\n\n` +
							`---\n\n` +
							`**${nextPersona?.name || "Next Agent"}**: Please continue the workflow based on the context above. ` +
							`Follow your role definition and complete your tasks. When done, use attempt_completion to hand off to the next agent.`

						await task.say(
							"text",
							`✅ **Sentinel Handoff Complete**\n\n` +
								`- **From:** ${transitionResult.fromState}\n` +
								`- **To:** ${transitionResult.toState}\n\n` +
								`The workflow continues with **${nextPersona?.name || transitionResult.toState}**.`,
						)

						// Resume the conversation by sending the handoff as a follow-up message
						// This triggers the next agent to start working immediately
						const provider = task.providerRef.deref()
						if (provider) {
							// Queue the handoff message to continue the conversation
							setTimeout(async () => {
								try {
									await task.handleWebviewAskResponse("messageResponse", handoffMessage)
								} catch (err) {
									console.error("[Sentinel] Failed to send handoff continuation:", err)
								}
							}, 500) // Small delay to ensure current execution completes
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
