/**
 * Sentinel Edition - Handoff Context Tool
 *
 * Allows agents to submit structured handoff context when completing
 * their phase, triggering the FSM transition to the next agent.
 */

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	type HandoffContext,
	type ArchitectPlan,
	type BuilderTestContext,
	type QAAuditContext,
	type SentinelAuditResult,
} from "../sentinel/HandoffContext"
import { AgentState } from "../sentinel/StateMachine"

/**
 * Parameters for the handoff context tool
 */
interface HandoffContextParams {
	notes: string
	context_json: string
}

/**
 * Handoff Context Tool
 *
 * Used by agents to submit their work output and trigger transition
 * to the next agent in the workflow.
 */
export class HandoffContextTool extends BaseTool<"handoff_context"> {
	readonly name = "handoff_context" as const

	/**
	 * Parse legacy XML parameters
	 */
	parseLegacy(params: Partial<Record<string, string>>): HandoffContextParams {
		return {
			notes: params.notes || "",
			context_json: params.context_json || params.contextJson || "{}",
		}
	}

	/**
	 * Execute the tool
	 */
	async execute(
		params: HandoffContextParams,
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		const { notes, context_json } = params

		try {
			// Validate we have context
			if (!context_json || context_json === "{}") {
				task.consecutiveMistakeCount++
				task.recordToolError("handoff_context")
				pushToolResult(
					await task.sayAndCreateMissingParamError("handoff_context", "context_json")
				)
				return
			}

			// Check if Sentinel FSM is active
			const fsm = task.sentinelStateMachine
			if (!fsm || !fsm.isActive()) {
				pushToolResult(
					formatResponse.toolError(
						"Sentinel FSM is not active. Use this tool only within a Sentinel workflow."
					)
				)
				return
			}

			task.consecutiveMistakeCount = 0

			// Parse the context JSON
			let parsedContext: Record<string, unknown>
			try {
				parsedContext = JSON.parse(context_json)
			} catch (parseError) {
				task.recordToolError("handoff_context")
				pushToolResult(
					formatResponse.toolError(
						`Invalid JSON in context_json: ${(parseError as Error).message}`
					)
				)
				return
			}

			// Build handoff data based on current agent
			const currentState = fsm.getCurrentState()
			const handoffData = this.buildHandoffData(currentState, parsedContext, notes)

			// Show what's being submitted
			await task.say(
				"text",
				`\ud83d\udd04 Submitting handoff context from ${currentState}...`,
			)

			// Trigger FSM transition
			const result = await fsm.handleAgentCompletion(handoffData)

		if (result.success) {
				// Format context for display - show each field clearly
				let contextDisplay = ""
				const formatValue = (val: unknown, indent = 0): string => {
					const prefix = "  ".repeat(indent)
					if (val === null || val === undefined) return `${prefix}(empty)`
					if (Array.isArray(val)) {
						if (val.length === 0) return `${prefix}(empty list)`
						return val.map((v, i) => `${prefix}${i + 1}. ${typeof v === 'object' ? JSON.stringify(v) : v}`).join("\n")
					}
					if (typeof val === 'object') {
						return Object.entries(val as Record<string, unknown>)
							.map(([k, v]) => `${prefix}**${k}:** ${typeof v === 'object' ? '\n' + formatValue(v, indent + 1) : v}`)
							.join("\n")
					}
					return `${prefix}${val}`
				}
				
				try {
					contextDisplay = Object.entries(parsedContext)
						.map(([key, value]) => {
							const formattedValue = typeof value === 'object' 
								? '\n' + formatValue(value, 1)
								: String(value)
							return `- **${key}:** ${formattedValue}`
						})
						.join("\n\n")
				} catch {
					contextDisplay = JSON.stringify(parsedContext, null, 2)
				}
				
				pushToolResult(
					`✅ Handoff successful!\n\n` +
					`- **From:** ${result.fromState}\n` +
					`- **To:** ${result.toState}\n` +
					`- **Notes:** ${notes || "(none)"}\n\n` +
					`---\n\n` +
					`## 📋 Handoff Context (AI-to-AI Message):\n\n` +
					`${contextDisplay}\n\n` +
					`---\n\n` +
					`The workflow will now continue with the ${result.toState} agent.`
				)
				
				// CRITICAL: Add auto-continue message to trigger next agent
				// This tells the next agent what to do based on their role
				const continueMessage = this.buildContinueMessage(result.toState, parsedContext)
				task.userMessageContent.push({
					type: "text",
					text: continueMessage,
				})
			} else {
				if (result.toState === AgentState.BLOCKED) {
					pushToolResult(
						`⚠️ Workflow blocked!\n\n` +
						`- **Reason:** ${result.error}\n\n` +
						`Human intervention is required to continue.`
					)
				} else {
					pushToolResult(
						formatResponse.toolError(
							`Handoff failed: ${result.error}`
						)
					)
				}
			}
		} catch (error) {
			await handleError("submitting handoff context", error as Error)
		}
	}

	/**
	 * Build handoff data based on current agent state
	 */
	private buildHandoffData(
		currentState: AgentState,
		parsedContext: Record<string, unknown>,
		notes: string,
	): Partial<HandoffContext> {
		const base: Partial<HandoffContext> = {
			previousAgentNotes: notes,
		}

		switch (currentState) {
			case AgentState.ARCHITECT:
				return {
					...base,
					architectPlan: parsedContext as unknown as ArchitectPlan,
				}

			case AgentState.BUILDER:
				return {
					...base,
					builderTestContext: parsedContext as unknown as BuilderTestContext,
				}

			case AgentState.QA_ENGINEER:
				return {
					...base,
					qaAuditContext: parsedContext as unknown as QAAuditContext,
				}

			case AgentState.SENTINEL:
				return {
					...base,
					sentinelResult: parsedContext as unknown as SentinelAuditResult,
				}

			default:
				return base
		}
	}

	/**
	 * Handle partial streaming
	 */
	override async handlePartial(task: Task, block: ToolUse<"handoff_context">): Promise<void> {
		const params = block.params as Record<string, string | undefined>
		const notes = params.notes
		const contextJson = params.context_json || params.contextJson

		// Try to show a preview of the context
		let preview = "(parsing...)"
		if (contextJson && !block.partial) {
			try {
				const parsed = JSON.parse(contextJson)
				preview = `Keys: ${Object.keys(parsed).join(", ")}`
			} catch {
				preview = "(invalid JSON)"
			}
		}

		const partialMessage = JSON.stringify({
			tool: "handoff_context",
			notes: this.removeClosingTag("notes", notes, block.partial),
			contextPreview: preview,
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}

	/**
	 * Build a continue message for the next agent based on their role
	 */
	private buildContinueMessage(toState: AgentState, context: Record<string, unknown>): string {
		switch (toState) {
			case AgentState.ARCHITECT:
				return `[AUTO-CONTINUE] You are the Architect. Review the feedback and create/update the implementation plan.`
			case AgentState.BUILDER:
				return `[AUTO-CONTINUE] You are the Builder. Implement according to the Architect's plan: ${JSON.stringify(context).slice(0, 500)}`
			case AgentState.QA_ENGINEER:
				return `[AUTO-CONTINUE] You are QA. Test the implementation using browser_action and dom_extract.`
			case AgentState.ARCHITECT_REVIEW_CODE:
			case AgentState.ARCHITECT_REVIEW_TESTS:
				return `[AUTO-CONTINUE] Review the work and decide: approve or reject with feedback.`
			case AgentState.SENTINEL:
				return `[AUTO-CONTINUE] You are Sentinel Security. Perform security audit. After audit, use handoff_context to pass to Architect Final.`
			case AgentState.ARCHITECT_REVIEW_FINAL:
				return `[AUTO-CONTINUE] You are Architect Final Review. Create a walkthrough.md summarizing all work completed, then use attempt_completion.`
			case AgentState.COMPLETED:
				return `[AUTO-CONTINUE] Workflow completed. Use attempt_completion to finish.`
			default:
				return `[AUTO-CONTINUE] Continue with your assigned role.`
		}
	}
}

/**
 * Singleton tool instance
 */
export const handoffContextTool = new HandoffContextTool()
