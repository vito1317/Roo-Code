/**
 * Sentinel Edition - Finite State Machine
 *
 * Core orchestrator for the multi-agent development workflow.
 * Manages state transitions between Architect → Builder → QA → Sentinel.
 */

import type { Task } from "../task/Task"
import type { ClineProvider } from "../webview/ClineProvider"
import {
	type HandoffContext,
	createHandoffContext,
	validateHandoffContext,
	getHandoffSummary,
	type FailureRecord,
} from "./HandoffContext"
import { SENTINEL_AGENTS, getAgentPersona, getNextAgent, isSentinelAgent } from "./personas"

/**
 * Agent states in the FSM
 * 
 * Supervisor Workflow:
 * IDLE → ARCHITECT (plan) → BUILDER → ARCHITECT_REVIEW_CODE → 
 *        QA → ARCHITECT_REVIEW_TESTS → SENTINEL → ARCHITECT_REVIEW_FINAL → COMPLETED
 */
export enum AgentState {
	IDLE = "idle",
	// Initial planning phase
	ARCHITECT = "sentinel-architect",
	// Implementation phase
	BUILDER = "sentinel-builder",
	// Architect reviews Builder's code
	ARCHITECT_REVIEW_CODE = "sentinel-architect-review",
	// Testing phase
	QA_ENGINEER = "sentinel-qa",
	// Architect reviews QA results
	ARCHITECT_REVIEW_TESTS = "sentinel-architect-review-tests",
	// Security audit phase
	SENTINEL = "sentinel-security",
	// Architect final review
	ARCHITECT_REVIEW_FINAL = "sentinel-architect-final",
	// Terminal states
	COMPLETED = "completed",
	BLOCKED = "blocked",
}

/**
 * Transition result
 */
export interface TransitionResult {
	success: boolean
	fromState: AgentState
	toState: AgentState
	error?: string
	context?: HandoffContext
}

/**
 * State transition definition
 */
interface StateTransition {
	from: AgentState
	to: AgentState
	condition: (context: HandoffContext | null) => boolean
	label: string
}

/**
 * FSM event listener
 */
export type FSMEventListener = (event: FSMEvent) => void

/**
 * FSM events
 */
export interface FSMEvent {
	type: "transition" | "blocked" | "completed" | "error" | "retry"
	fromState: AgentState
	toState: AgentState
	context?: HandoffContext
	message?: string
}

/**
 * Configuration for the state machine
 */
export interface StateMachineConfig {
	maxQARetries: number
	maxSecurityRetries: number
	autoTransition: boolean
	onHumanInterventionRequired: (reason: string, context: HandoffContext) => Promise<boolean>
}

const DEFAULT_CONFIG: StateMachineConfig = {
	maxQARetries: 3,
	maxSecurityRetries: 2,
	autoTransition: true,
	onHumanInterventionRequired: async () => false,
}

/**
 * Sentinel State Machine
 *
 * Orchestrates the Architect-as-Supervisor workflow:
 * Architect → Builder → Architect(review) → QA → Architect(review) → Sentinel → Architect(review) → Complete
 */
export class SentinelStateMachine {
	private currentState: AgentState = AgentState.IDLE
	private currentContext: HandoffContext | null = null
	private qaRejectionCount: number = 0
	private securityRejectionCount: number = 0
	private config: StateMachineConfig
	private listeners: FSMEventListener[] = []
	private taskRef: WeakRef<Task>
	private providerRef: WeakRef<ClineProvider>

	/**
	 * Valid state transitions - Architect Supervisor Workflow
	 */
	private readonly transitions: StateTransition[] = [
		// ===== PHASE 1: PLANNING =====
		// Start workflow
		{
			from: AgentState.IDLE,
			to: AgentState.ARCHITECT,
			condition: () => true,
			label: "User initiates development",
		},

		// Architect completes planning → Builder implements
		{
			from: AgentState.ARCHITECT,
			to: AgentState.BUILDER,
			condition: (ctx) => !!ctx?.architectPlan,
			label: "Plan completed, handoff to Builder",
		},

		// ===== PHASE 2: IMPLEMENTATION & CODE REVIEW =====
		// Builder completes → Architect reviews code
		{
			from: AgentState.BUILDER,
			to: AgentState.ARCHITECT_REVIEW_CODE,
			condition: (ctx) => !!ctx?.builderTestContext,
			label: "Code committed, Architect reviews",
		},

		// Architect approves code → QA tests
		{
			from: AgentState.ARCHITECT_REVIEW_CODE,
			to: AgentState.QA_ENGINEER,
			condition: (ctx) => ctx?.architectReviewCode?.approved === true,
			label: "Code approved, handoff to QA",
		},

		// Architect rejects code → Builder fixes
		{
			from: AgentState.ARCHITECT_REVIEW_CODE,
			to: AgentState.BUILDER,
			condition: (ctx) => ctx?.architectReviewCode?.approved === false,
			label: "Code rejected, return to Builder",
		},

		// ===== PHASE 3: TESTING & TEST REVIEW =====
		// QA completes → Architect reviews tests
		{
			from: AgentState.QA_ENGINEER,
			to: AgentState.ARCHITECT_REVIEW_TESTS,
			condition: (ctx) => ctx?.qaAuditContext !== undefined,
			label: "Testing complete, Architect reviews",
		},

		// Architect approves tests → Sentinel security audit
		{
			from: AgentState.ARCHITECT_REVIEW_TESTS,
			to: AgentState.SENTINEL,
			condition: (ctx) => ctx?.architectReviewTests?.approved === true,
			label: "Tests approved, handoff to Sentinel",
		},

		// Architect rejects tests → QA re-tests or Builder fixes
		{
			from: AgentState.ARCHITECT_REVIEW_TESTS,
			to: AgentState.BUILDER,
			condition: (ctx) => ctx?.architectReviewTests?.approved === false,
			label: "Tests failed requirements, return to Builder",
		},

		// ===== PHASE 4: SECURITY & FINAL REVIEW =====
		// Sentinel completes → Architect final review
		{
			from: AgentState.SENTINEL,
			to: AgentState.ARCHITECT_REVIEW_FINAL,
			condition: (ctx) => ctx?.sentinelResult !== undefined,
			label: "Security audit complete, Architect final review",
		},

		// Architect approves final → Complete
		{
			from: AgentState.ARCHITECT_REVIEW_FINAL,
			to: AgentState.COMPLETED,
			condition: (ctx) => ctx?.architectFinalReview?.approved === true,
			label: "Final review passed, workflow complete",
		},

		// Architect rejects final → Builder fixes security issues
		{
			from: AgentState.ARCHITECT_REVIEW_FINAL,
			to: AgentState.BUILDER,
			condition: (ctx) => ctx?.architectFinalReview?.approved === false,
			label: "Final review failed, return to Builder",
		},
	]

	constructor(task: Task, provider: ClineProvider, config: Partial<StateMachineConfig> = {}) {
		this.taskRef = new WeakRef(task)
		this.providerRef = new WeakRef(provider)
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Get current state
	 */
	getCurrentState(): AgentState {
		return this.currentState
	}

	/**
	 * Get current agent slug (for mode switching)
	 */
	getCurrentAgent(): string {
		// Map AgentState to actual mode slugs
		const stateToModeSlug: Record<AgentState, string> = {
			[AgentState.IDLE]: "code",
			[AgentState.COMPLETED]: "code",
			[AgentState.BLOCKED]: "code",
			[AgentState.ARCHITECT]: "sentinel-architect",
			[AgentState.BUILDER]: "sentinel-builder",
			[AgentState.ARCHITECT_REVIEW_CODE]: "sentinel-architect-review",
			[AgentState.QA_ENGINEER]: "sentinel-qa",
			[AgentState.ARCHITECT_REVIEW_TESTS]: "sentinel-architect-review-tests",
			[AgentState.SENTINEL]: "sentinel-security",
			[AgentState.ARCHITECT_REVIEW_FINAL]: "sentinel-architect-final",
		}
		return stateToModeSlug[this.currentState] || "code"
	}

	/**
	 * Check if FSM is active
	 */
	isActive(): boolean {
		return this.currentState !== AgentState.IDLE && this.currentState !== AgentState.COMPLETED
	}

	/**
	 * Get current handoff context
	 */
	getCurrentContext(): HandoffContext | null {
		return this.currentContext
	}

	/**
	 * Start the Sentinel workflow
	 */
	async start(): Promise<TransitionResult> {
		if (this.currentState !== AgentState.IDLE) {
			return {
				success: false,
				fromState: this.currentState,
				toState: this.currentState,
				error: "FSM already active. Call reset() first.",
			}
		}

		return this.transition(AgentState.ARCHITECT)
	}

	/**
	 * Reset FSM to idle state
	 */
	reset(): void {
		this.currentState = AgentState.IDLE
		this.currentContext = null
		this.qaRejectionCount = 0
		this.securityRejectionCount = 0
		this.emit({
			type: "transition",
			fromState: AgentState.BLOCKED,
			toState: AgentState.IDLE,
			message: "FSM reset",
		})
	}

	/**
	 * Handle agent completion - called when attempt_completion is intercepted
	 */
	async handleAgentCompletion(handoffData: Partial<HandoffContext>): Promise<TransitionResult> {
		const fromState = this.currentState

		// Merge handoff data into current context
		if (this.currentContext) {
			this.currentContext = {
				...this.currentContext,
				...handoffData,
				status: "completed",
			}
		} else {
			this.currentContext = createHandoffContext(fromState, this.determineNextState(handoffData))
			Object.assign(this.currentContext, handoffData)
		}

		// Determine next state based on current state and handoff data
		const nextState = this.determineNextState(handoffData)

		// Check for loop prevention
		if (nextState === AgentState.BUILDER) {
			if (fromState === AgentState.QA_ENGINEER) {
				this.qaRejectionCount++
				if (this.qaRejectionCount >= this.config.maxQARetries) {
					return this.triggerHumanIntervention(
						`QA tests failed ${this.qaRejectionCount} times. Human intervention required.`,
					)
				}
			} else if (fromState === AgentState.SENTINEL) {
				this.securityRejectionCount++
				if (this.securityRejectionCount >= this.config.maxSecurityRetries) {
					return this.triggerHumanIntervention(
						`Security audit failed ${this.securityRejectionCount} times. Human intervention required.`,
					)
				}
			}
		}

		// Reset counters on successful forward progress
		if (nextState === AgentState.SENTINEL) {
			this.qaRejectionCount = 0
		}
		if (nextState === AgentState.COMPLETED) {
			this.securityRejectionCount = 0
		}

		return this.transition(nextState)
	}

	/**
	 * Determine next state based on current state and handoff data
	 */
	private determineNextState(handoffData: Partial<HandoffContext>): AgentState {
		switch (this.currentState) {
			// Phase 1: Initial planning → Builder
			case AgentState.ARCHITECT:
				return AgentState.BUILDER

			// Phase 2: Builder → Architect reviews code
			case AgentState.BUILDER:
				return AgentState.ARCHITECT_REVIEW_CODE

			// Phase 2b: Architect reviews code → QA (auto-approve unless rejected)
			case AgentState.ARCHITECT_REVIEW_CODE:
				if (handoffData.architectReviewCode?.approved === false) {
					return AgentState.ARCHITECT // Re-plan before Builder
				}
				return AgentState.QA_ENGINEER

			// Phase 3: QA → Architect reviews tests
			case AgentState.QA_ENGINEER:
				return AgentState.ARCHITECT_REVIEW_TESTS

			// Phase 3b: Architect reviews tests → Sentinel (auto-approve unless rejected)
			case AgentState.ARCHITECT_REVIEW_TESTS:
				if (handoffData.architectReviewTests?.approved === false) {
					return AgentState.ARCHITECT // Re-plan before Builder
				}
				return AgentState.SENTINEL

			// Phase 4: Sentinel security audit → Architect final review (or back to Builder if failed)
			case AgentState.SENTINEL:
				// Check if security audit failed
				if (handoffData.sentinelResult?.securityPassed === false || 
					handoffData.sentinelResult?.recommendation === "reject") {
					return AgentState.ARCHITECT // Return to Architect to re-plan fixes
				}
				return AgentState.ARCHITECT_REVIEW_FINAL

			// Phase 4b: Architect final review → COMPLETED (auto-approve unless rejected)
			case AgentState.ARCHITECT_REVIEW_FINAL:
				if (handoffData.architectFinalReview?.approved === false) {
					return AgentState.ARCHITECT // Re-plan before Builder
				}
				return AgentState.COMPLETED

			default:
				return AgentState.IDLE
		}
	}

	/**
	 * Perform state transition
	 */
	async transition(targetState: AgentState): Promise<TransitionResult> {
		const fromState = this.currentState

		// Validate transition is allowed
		const validTransition = this.transitions.find((t) => t.from === fromState && t.to === targetState)

		if (!validTransition && targetState !== AgentState.ARCHITECT) {
			return {
				success: false,
				fromState,
				toState: targetState,
				error: `Invalid transition from ${fromState} to ${targetState}`,
			}
		}

		// Validate context for target agent
		if (this.currentContext && isSentinelAgent(targetState)) {
			const validationErrors = validateHandoffContext(this.currentContext, targetState)
			if (validationErrors.length > 0) {
				return {
					success: false,
					fromState,
					toState: targetState,
					error: `Context validation failed: ${validationErrors.join(", ")}`,
				}
			}
		}

		// Perform transition
		this.currentState = targetState

		// Update context
		if (this.currentContext) {
			this.currentContext.toAgent = targetState
			this.currentContext.status = "in_progress"
		} else {
			this.currentContext = createHandoffContext(fromState, targetState)
		}

		// Switch mode
		await this.switchToAgentMode(targetState)

		// Emit event
		this.emit({
			type: "transition",
			fromState,
			toState: targetState,
			context: this.currentContext ?? undefined,
		})

		// Generate walkthrough on completion
		if (targetState === AgentState.COMPLETED && this.currentContext) {
			await this.generateWalkthrough()
		}

		return {
			success: true,
			fromState,
			toState: targetState,
			context: this.currentContext ?? undefined,
		}
	}

	/**
	 * Switch VS Code mode to match agent
	 */
	private async switchToAgentMode(agentState: AgentState): Promise<void> {
		const provider = this.providerRef.deref()
		if (!provider) return

		if (agentState === AgentState.COMPLETED || agentState === AgentState.IDLE) {
			// Return to default mode
			await provider.handleModeSwitch("code")
		} else if (agentState === AgentState.BLOCKED) {
			// Stay in current mode
		} else {
			// Switch to agent mode using the correct mode slug
			const modeSlug = this.getCurrentAgent()
			await provider.handleModeSwitch(modeSlug)
		}
	}

	/**
	 * Trigger human intervention and block FSM
	 */
	private async triggerHumanIntervention(reason: string): Promise<TransitionResult> {
		const fromState = this.currentState

		// Record failure
		if (this.currentContext) {
			const failure: FailureRecord = {
				agent: fromState,
				timestamp: new Date(),
				reason,
				details: "Max retry limit reached",
			}
			this.currentContext.failureHistory.push(failure)
			this.currentContext.status = "blocked"
		}

		// Check if user wants to continue
		const shouldContinue = await this.config.onHumanInterventionRequired(reason, this.currentContext!)

		if (shouldContinue) {
			// User manually approved continuation - reset counters
			this.qaRejectionCount = 0
			this.securityRejectionCount = 0
			return this.transition(AgentState.BUILDER)
		}

		// Block the FSM
		this.currentState = AgentState.BLOCKED

		this.emit({
			type: "blocked",
			fromState,
			toState: AgentState.BLOCKED,
			message: reason,
			context: this.currentContext ?? undefined,
		})

		return {
			success: false,
			fromState,
			toState: AgentState.BLOCKED,
			error: reason,
			context: this.currentContext ?? undefined,
		}
	}

	/**
	 * Generate walkthrough document on workflow completion
	 */
	private async generateWalkthrough(): Promise<void> {
		const provider = this.providerRef.deref()
		if (!provider || !this.currentContext) return

		const context = this.currentContext
		const task = provider.getCurrentTask()
		if (!task) return
		
		let walkthrough = "# 📋 Workflow Walkthrough\n\n"
		walkthrough += `**Status:** ✅ Completed\n`
		walkthrough += `**Completed at:** ${new Date().toLocaleString()}\n\n`
		
		walkthrough += "---\n\n"
		
		// Add flow comparison diagram
		walkthrough += "## 📊 Workflow Flow Comparison\n\n"
		walkthrough += "### Planned Flow vs Actual Flow\n\n"
		walkthrough += "```mermaid\n"
		walkthrough += "flowchart LR\n"
		walkthrough += "    subgraph Planned[\"📋 Planned Flow\"]\n"
		walkthrough += "        P1[Architect] --> P2[Builder]\n"
		walkthrough += "        P2 --> P3[Review]\n"
		walkthrough += "        P3 --> P4[QA]\n"
		walkthrough += "        P4 --> P5[Security]\n"
		walkthrough += "        P5 --> P6[Final]\n"
		walkthrough += "    end\n"
		walkthrough += "    subgraph Actual[\"✅ Actual Flow\"]\n"
		walkthrough += "        A1[\"✅ Architect\"] --> A2[\"✅ Builder\"]\n"
		walkthrough += "        A2 --> A3[\"✅ Review\"]\n"
		walkthrough += "        A3 --> A4[\"✅ QA\"]\n"
		walkthrough += "        A4 --> A5[\"✅ Security\"]\n"
		walkthrough += "        A5 --> A6[\"✅ Final\"]\n"
		walkthrough += "    end\n"
		walkthrough += "```\n\n"
		
		// Architect Plan Summary
		if (context.architectPlan) {
			walkthrough += "## 🏗️ Architect Plan\n\n"
			const plan = context.architectPlan
			walkthrough += `**Project:** ${plan.projectName}\n`
			walkthrough += `**Summary:** ${plan.summary}\n\n`
			if (plan.tasks && plan.tasks.length > 0) {
				walkthrough += "**Tasks:**\n"
				plan.tasks.forEach((t) => {
					walkthrough += `- ✅ ${t.title}\n`
				})
				walkthrough += "\n"
			}
		}

		// Builder Implementation
		if (context.builderTestContext) {
			walkthrough += "## 🔨 Builder Implementation\n\n"
			const builder = context.builderTestContext
			walkthrough += `**Test URL:** ${builder.targetUrl}\n`
			walkthrough += `**Run Command:** ${builder.runCommand}\n\n`
			if (builder.changedFiles && builder.changedFiles.length > 0) {
				walkthrough += "**Changed Files:**\n"
				builder.changedFiles.forEach((f) => {
					walkthrough += `- \`${f}\`\n`
				})
				walkthrough += "\n"
			}
		}

		// QA Results
		if (context.qaAuditContext) {
			walkthrough += "## 🧪 QA Test Results\n\n"
			const qa = context.qaAuditContext
			walkthrough += `**Test Result:** ${qa.testsPassed ? "✅ PASSED" : "❌ FAILED"}\n\n`
			
			if (qa.testResults && qa.testResults.length > 0) {
				walkthrough += "**Test Results:**\n"
				qa.testResults.forEach((r) => {
					const icon = r.passed ? "✅" : "❌"
					walkthrough += `- ${icon} ${r.scenario}\n`
				})
				walkthrough += "\n"
			}
		}

		// Security Audit
		if (context.sentinelResult) {
			walkthrough += "## 🔒 Security Audit\n\n"
			const sentinel = context.sentinelResult
			walkthrough += `**Security Result:** ${sentinel.securityPassed ? "✅ APPROVED" : "❌ ISSUES FOUND"}\n`
			walkthrough += `**Recommendation:** ${sentinel.recommendation}\n`
			if (sentinel.vulnerabilities && sentinel.vulnerabilities.length > 0) {
				walkthrough += "**Vulnerabilities Found:**\n"
				sentinel.vulnerabilities.forEach((v) => {
					walkthrough += `- ⚠️ [${v.severity}] ${v.description}\n`
				})
			}
			walkthrough += "\n"
		}

		walkthrough += "---\n\n"
		walkthrough += "*Generated by Sentinel Code Workflow*\n"

		// Save walkthrough as file
		const cwd = task.cwd
		const walkthroughPath = `${cwd}/walkthrough.md`
		
		try {
			const fs = await import("fs/promises")
			const path = await import("path")
			
			// Collect screenshots from workspace
			let screenshotSection = ""
			try {
				const files = await fs.readdir(cwd)
				const screenshots = files.filter(f => 
					f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp')
				).filter(f => f.includes('screenshot') || f.includes('test') || f.includes('browser'))
				
				if (screenshots.length > 0) {
					screenshotSection = "\n## 📸 Test Screenshots\n\n"
					screenshots.forEach((s, i) => {
						screenshotSection += `### Screenshot ${i + 1}\n`
						screenshotSection += `![${s}](./${s})\n\n`
					})
				}
			} catch (e) {
				// Ignore errors reading screenshots
			}
			
			// Insert screenshots before the divider
			const finalWalkthrough = walkthrough.replace(
				"---\n\n*Generated by Sentinel Code Workflow*",
				screenshotSection + "---\n\n*Generated by Sentinel Code Workflow*"
			)
			
			await fs.writeFile(walkthroughPath, finalWalkthrough, "utf-8")
			await task.say("text", `📋 **Walkthrough saved to:** \`walkthrough.md\`\n\n${finalWalkthrough}`)
		} catch (error) {
			// Fallback to just displaying in chat
			await task.say("text", walkthrough)
		}
	}

	/**
	 * Get context summary for injection into agent prompt
	 */
	getContextSummary(): string {
		if (!this.currentContext) {
			return ""
		}
		return getHandoffSummary(this.currentContext)
	}

	/**
	 * Add event listener
	 */
	addEventListener(listener: FSMEventListener): void {
		this.listeners.push(listener)
	}

	/**
	 * Remove event listener
	 */
	removeEventListener(listener: FSMEventListener): void {
		const index = this.listeners.indexOf(listener)
		if (index > -1) {
			this.listeners.splice(index, 1)
		}
	}

	/**
	 * Emit event to all listeners
	 */
	private emit(event: FSMEvent): void {
		// Notify webview of state change
		this.notifyWebview(event.toState)

		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch (error) {
				console.error("[SentinelFSM] Event listener error:", error)
			}
		}
	}

	/**
	 * Get human-readable agent name
	 */
	private getAgentDisplayName(state: AgentState): string {
		const names: Record<AgentState, string> = {
			[AgentState.IDLE]: "Idle",
			[AgentState.ARCHITECT]: "🟦 Architect",
			[AgentState.BUILDER]: "🟩 Builder",
			[AgentState.ARCHITECT_REVIEW_CODE]: "🔍 Architect (Code Review)",
			[AgentState.QA_ENGINEER]: "🟨 QA Engineer",
			[AgentState.ARCHITECT_REVIEW_TESTS]: "🔍 Architect (Test Review)",
			[AgentState.SENTINEL]: "🟥 Sentinel",
			[AgentState.ARCHITECT_REVIEW_FINAL]: "🔍 Architect (Final Review)",
			[AgentState.COMPLETED]: "✅ Completed",
			[AgentState.BLOCKED]: "🚫 Blocked",
		}
		return names[state] || String(state)
	}

	/**
	 * Map AgentState to webview state string
	 */
	private mapToWebviewState(
		state: AgentState,
	): "IDLE" | "ARCHITECT" | "BUILDER" | "ARCHITECT_REVIEW" | "QA" | "SENTINEL" | "COMPLETED" | "BLOCKED" {
		const mapping: Record<
			AgentState,
			"IDLE" | "ARCHITECT" | "BUILDER" | "ARCHITECT_REVIEW" | "QA" | "SENTINEL" | "COMPLETED" | "BLOCKED"
		> = {
			[AgentState.IDLE]: "IDLE",
			[AgentState.ARCHITECT]: "ARCHITECT",
			[AgentState.BUILDER]: "BUILDER",
			[AgentState.ARCHITECT_REVIEW_CODE]: "ARCHITECT_REVIEW",
			[AgentState.QA_ENGINEER]: "QA",
			[AgentState.ARCHITECT_REVIEW_TESTS]: "ARCHITECT_REVIEW",
			[AgentState.SENTINEL]: "SENTINEL",
			[AgentState.ARCHITECT_REVIEW_FINAL]: "ARCHITECT_REVIEW",
			[AgentState.COMPLETED]: "COMPLETED",
			[AgentState.BLOCKED]: "BLOCKED",
		}
		return mapping[state] || "IDLE"
	}

	/**
	 * Notify webview of current agent state
	 */
	private notifyWebview(state: AgentState): void {
		const provider = this.providerRef.deref()
		if (!provider) return

		try {
			// Special handling for COMPLETED state - still show the completion status
			const isCompleted = state === AgentState.COMPLETED
			
			// Get current activity description
			const activities: Record<AgentState, string> = {
				[AgentState.IDLE]: "",
				[AgentState.ARCHITECT]: "Creating implementation plan with Mermaid diagrams...",
				[AgentState.BUILDER]: "Writing code and implementing features...",
				[AgentState.ARCHITECT_REVIEW_CODE]: "Reviewing code quality and UI layout...",
				[AgentState.QA_ENGINEER]: "Running browser tests and taking screenshots...",
				[AgentState.ARCHITECT_REVIEW_TESTS]: "Reviewing test coverage and results...",
				[AgentState.SENTINEL]: "Performing security audit (OWASP checks)...",
				[AgentState.ARCHITECT_REVIEW_FINAL]: "Generating walkthrough and final summary...",
				[AgentState.COMPLETED]: "Workflow complete! Check walkthrough.md",
				[AgentState.BLOCKED]: "Waiting for human intervention...",
			}
			
			// Build handoff info from context
			let lastHandoff = undefined
			if (this.currentContext) {
				const ctx = this.currentContext
				lastHandoff = {
					from: ctx.fromAgent,
					to: ctx.toAgent,
					summary: this.getHandoffSummaryForUI(),
					timestamp: Date.now(),
				}
			}
			
			provider.postMessageToWebview({
				type: "sentinelAgentState",
				sentinelAgentState: {
					enabled: this.isActive() || isCompleted,
					currentAgent: this.mapToWebviewState(state),
					agentName: this.getAgentDisplayName(state),
					currentActivity: activities[state] || "",
					lastHandoff,
				},
			})
		} catch (error) {
			console.error("[SentinelFSM] Failed to notify webview:", error)
		}
	}
	
	/**
	 * Get simplified handoff summary for UI display
	 */
	private getHandoffSummaryForUI(): string {
		if (!this.currentContext) return ""
		
		const ctx = this.currentContext
		const parts: string[] = []
		
		if (ctx.architectPlan) {
			parts.push(`📐 Plan: ${ctx.architectPlan.projectName}`)
		}
		if (ctx.builderTestContext) {
			parts.push(`🔨 Files: ${ctx.builderTestContext.changedFiles?.length || 0} changed`)
		}
		if (ctx.qaAuditContext) {
			parts.push(`🧪 Tests: ${ctx.qaAuditContext.testsPassed ? "PASSED" : "FAILED"}`)
		}
		if (ctx.sentinelResult) {
			parts.push(`🛡️ Security: ${ctx.sentinelResult.securityPassed ? "OK" : "Issues"}`)
		}
		
		return parts.join(" | ")
	}

	/**
	 * Get FSM status for debugging
	 */
	getStatus(): object {
		return {
			currentState: this.currentState,
			isActive: this.isActive(),
			qaRejectionCount: this.qaRejectionCount,
			securityRejectionCount: this.securityRejectionCount,
			hasContext: !!this.currentContext,
			contextId: this.currentContext?.id,
			attemptNumber: this.currentContext?.attemptNumber,
		}
	}

	/**
	 * Force transition (for testing/debugging)
	 */
	forceState(state: AgentState): void {
		console.warn(`[SentinelFSM] Force state change: ${this.currentState} → ${state}`)
		this.currentState = state
	}
}

/**
 * Create FSM instance attached to a task
 */
export function createSentinelFSM(
	task: Task,
	provider: ClineProvider,
	config?: Partial<StateMachineConfig>,
): SentinelStateMachine {
	return new SentinelStateMachine(task, provider, config)
}
