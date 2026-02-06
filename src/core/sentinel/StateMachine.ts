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
import { FigmaPreviewPanel } from "../../services/figma/FigmaPreviewPanel"
import { UIDesignCanvasPanel } from "../../services/ui-design/UIDesignCanvasPanel"

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
	// UI/UX Design phase (optional, when Figma is enabled)
	DESIGNER = "sentinel-designer",
	// Design verification phase (verifies Designer completed all elements)
	DESIGN_REVIEW = "sentinel-design-review",
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
	maxDesignReviewRetries: number
	autoTransition: boolean
	onHumanInterventionRequired: (reason: string, context: HandoffContext) => Promise<boolean>
}

const DEFAULT_CONFIG: StateMachineConfig = {
	maxQARetries: 3,
	maxSecurityRetries: 2,
	maxDesignReviewRetries: 3, // Max times Design Review can reject before auto-approving
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
	private designReviewRejectionCount: number = 0
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

		// Architect completes planning → Designer (if UI design needed) or Builder
		{
			from: AgentState.ARCHITECT,
			to: AgentState.DESIGNER,
			condition: (ctx) => {
				if (!ctx?.architectPlan) return false
				// Check for Figma URL
				if (ctx.figmaUrl) return true
				// Check for design flags
				const plan = ctx.architectPlan as unknown as Record<string, unknown>
				const isTruthy = (val: unknown): boolean => val === true || val === "true" || val === 1 || val === "1"
				if (isTruthy(plan?.needsDesign) || isTruthy(plan?.needs_design)) return true
				if (isTruthy(plan?.hasUI) || isTruthy(plan?.has_ui) || isTruthy(plan?.hasUi)) return true
				if (isTruthy(plan?.useFigma) || isTruthy(plan?.use_figma)) return true
				if (isTruthy(plan?.usePenpot) || isTruthy(plan?.use_penpot)) return true
				if (isTruthy(plan?.useUIDesignCanvas) || isTruthy(plan?.use_ui_design_canvas)) return true
				// Check notes for keywords
				const notes = ctx.previousAgentNotes?.toLowerCase() || ""
				if (
					notes.includes("figma") ||
					notes.includes("penpot") ||
					notes.includes("designer") ||
					notes.includes("ui design") ||
					notes.includes("ui canvas")
				)
					return true
				return false
			},
			label: "Plan completed with UI design, handoff to Designer",
		},
		{
			from: AgentState.ARCHITECT,
			to: AgentState.BUILDER,
			condition: (ctx) => !!ctx?.architectPlan,
			label: "Plan completed, handoff to Builder (fallback)",
		},

		// Designer completes → Design Review verifies
		// IMPORTANT: Require expectedElements >= 15 to prevent low-quality designs
		{
			from: AgentState.DESIGNER,
			to: AgentState.DESIGN_REVIEW,
			condition: (ctx) => {
				// Minimum element threshold - prevents placeholder-only designs
				const MIN_ELEMENTS = 15
				const MIN_COMPONENTS_FALLBACK = 10 // Increased from 3

				// Designer must have created enough elements for a real UI
				const elementCount = typeof ctx?.expectedElements === "number" ? ctx.expectedElements : 0
				const hasEnoughElements = elementCount >= MIN_ELEMENTS

				// Check for actual UI components (not just frames)
				const components = ctx?.createdComponents || []
				const actualUIComponents = components.filter((name: string) => {
					const lower = name.toLowerCase()
					// Only count actual UI elements, not just container frames
					const uiKeywords = [
						"button",
						"text",
						"input",
						"label",
						"icon",
						"image",
						"title",
						"subtitle",
						"header",
						"footer",
						"nav",
						"card",
						"list",
						"item",
						"badge",
						"avatar",
						"tab",
						"按鈕",
						"文字",
						"輸入",
						"標題",
						"圖標",
						"標籤",
						"導航",
						"卡片",
					]
					return uiKeywords.some((keyword) => lower.includes(keyword))
				})

				// Primary check: expectedElements >= 15
				if (hasEnoughElements) {
					console.log(`[SentinelFSM] Designer handoff approved: ${elementCount} elements created`)
					return true
				}

				// Strict fallback: require 10+ components with at least 5 actual UI elements
				const hasDesignSpecs = !!ctx?.designSpecs
				const hasEnoughComponents = components.length >= MIN_COMPONENTS_FALLBACK
				const hasActualUIElements = actualUIComponents.length >= 5

				if (hasDesignSpecs && hasEnoughComponents && hasActualUIElements) {
					console.log(
						`[SentinelFSM] Designer handoff approved via fallback: ${components.length} components, ${actualUIComponents.length} UI elements`,
					)
					return true
				}

				// Reject handoff if design quality is too low
				console.log(
					`[SentinelFSM] Designer handoff REJECTED: only ${elementCount} elements (minimum ${MIN_ELEMENTS}), components=${components.length}, actualUIElements=${actualUIComponents.length}`,
				)
				console.log(`[SentinelFSM] Components list: ${JSON.stringify(components)}`)
				return false
			},
			label: "Design submitted with sufficient quality, handoff to Design Review for verification",
		},

		// Design Review approves (subtask) → Complete and return to parent
		// IMPORTANT: This transition must come BEFORE the BUILDER transition
		// to ensure subtasks return to parent after design phase completes
		{
			from: AgentState.DESIGN_REVIEW,
			to: AgentState.COMPLETED,
			condition: (ctx) => {
				// Check if design review passed
				if (ctx?.designReviewPassed !== true) return false
				// Check if this is a subtask (has parent task)
				// Access task via the FSM's taskRef (set during construction)
				const task = (this as any).taskRef?.deref?.()
				const isSubtask = !!task?.parentTaskId
				if (isSubtask) {
					console.log(
						`[SentinelFSM] Design subtask completed, returning to parent task (${task.parentTaskId})`,
					)
				}
				return isSubtask
			},
			label: "Design subtask complete, return to parent",
		},

		// Design Review approves → Builder implements (non-subtask only)
		{
			from: AgentState.DESIGN_REVIEW,
			to: AgentState.BUILDER,
			condition: (ctx) => {
				// Only proceed to Builder if design review passed AND this is NOT a subtask
				if (ctx?.designReviewPassed !== true) return false
				// Check if this is a subtask
				const task = (this as any).taskRef?.deref?.()
				const isSubtask = !!task?.parentTaskId
				// If it's a subtask, don't go to Builder (the COMPLETED transition above handles it)
				return !isSubtask
			},
			label: "Design verified complete, handoff to Builder",
		},

		// Design Review rejects → Designer fixes
		{
			from: AgentState.DESIGN_REVIEW,
			to: AgentState.DESIGNER,
			condition: (ctx) => ctx?.designReviewPassed === false,
			label: "Design incomplete, return to Designer",
		},

		// ===== PHASE 2: IMPLEMENTATION & CODE REVIEW =====
		// Builder needs design revision → Return to Designer
		{
			from: AgentState.BUILDER,
			to: AgentState.DESIGNER,
			condition: (ctx) => ctx?.needsDesignRevision === true || ctx?.returnToDesigner === true,
			label: "Design revision needed, return to Designer",
		},

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
			condition: (ctx) => ctx?.qaAuditContext !== undefined && ctx?.qaAuditContext?.testsPassed !== false,
			label: "Testing complete, Architect reviews",
		},

		// QA finds issues → Return directly to Builder to fix
		{
			from: AgentState.QA_ENGINEER,
			to: AgentState.BUILDER,
			condition: (ctx) => ctx?.qaAuditContext?.testsPassed === false && ctx?.needsDesignRevision !== true,
			label: "Tests failed, return to Builder to fix",
		},

		// QA finds design issues → Return to Designer
		{
			from: AgentState.QA_ENGINEER,
			to: AgentState.DESIGNER,
			condition: (ctx) => ctx?.needsDesignRevision === true || ctx?.returnToDesigner === true,
			label: "Design issues found, return to Designer",
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
			[AgentState.BLOCKED]: "sentinel-builder", // Stay in workflow, let Builder try to fix
			[AgentState.ARCHITECT]: "sentinel-architect",
			[AgentState.DESIGNER]: "sentinel-designer",
			[AgentState.DESIGN_REVIEW]: "sentinel-design-review",
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
		this.designReviewRejectionCount = 0
		this.emit({
			type: "transition",
			fromState: AgentState.BLOCKED,
			toState: AgentState.IDLE,
			message: "FSM reset",
		})
	}

	/**
	 * Spec task completion callback (set by TaskExecutor)
	 */
	private onSpecTaskCompleteCallback?: (result: { success: boolean; taskId: string }) => void

	/**
	 * Set callback for Spec task completion
	 */
	setOnSpecTaskComplete(callback: (result: { success: boolean; taskId: string }) => void): void {
		this.onSpecTaskCompleteCallback = callback
	}

	/**
	 * Start FSM from a Spec Mode task
	 * This initializes the FSM with task context and runs the complete pipeline:
	 * Architect → Designer → Review → Builder → QA → Sentinel → Final Review
	 */
	async startFromSpecTask(specTaskContext: import("./HandoffContext").SpecTaskContext): Promise<TransitionResult> {
		if (this.currentState !== AgentState.IDLE) {
			return {
				success: false,
				fromState: this.currentState,
				toState: this.currentState,
				error: "FSM already active. Call reset() first.",
			}
		}

		console.log(`[SentinelFSM] Starting from Spec Task: ${specTaskContext.taskId} - ${specTaskContext.title}`)

		// Create initial context with Spec task info
		this.currentContext = createHandoffContext(AgentState.IDLE, AgentState.ARCHITECT)
		this.currentContext.specTaskContext = specTaskContext

		// Build initial architect instructions from task info
		const taskInstructions = this.buildArchitectInstructionsFromSpec(specTaskContext)
		this.currentContext.nextPhaseInstructions = taskInstructions

		// Start the workflow
		return this.transition(AgentState.ARCHITECT)
	}

	/**
	 * Build Architect instructions from Spec task context
	 */
	private buildArchitectInstructionsFromSpec(spec: import("./HandoffContext").SpecTaskContext): string {
		const lines: string[] = []

		lines.push("## 📋 Spec Mode Task Execution")
		lines.push("")
		lines.push(`### Task: ${spec.title}`)

		if (spec.description) {
			lines.push("")
			lines.push(`**Description:** ${spec.description}`)
		}

		if (spec.acceptanceCriteria && spec.acceptanceCriteria.length > 0) {
			lines.push("")
			lines.push("**Acceptance Criteria:**")
			for (const criteria of spec.acceptanceCriteria) {
				lines.push(`- ${criteria}`)
			}
		}

		if (spec.complexity) {
			lines.push("")
			lines.push(`**Complexity:** ${spec.complexity}/5`)
		}

		if (spec.specFile) {
			lines.push("")
			lines.push(`**Source Spec:** \`${spec.specFile}\``)
		}

		lines.push("")
		lines.push("---")
		lines.push("")
		lines.push("**IMPORTANT:** This task is from the project's `.specs/tasks.md` file.")
		lines.push("Complete this task following the full Sentinel pipeline:")
		lines.push("1. 規劃 (Architect) → Analyze requirements and create implementation plan")
		lines.push("2. 畫UI (Designer) → Create UI mockups if needed")
		lines.push("3. Review → Verify design quality")
		lines.push("4. Builder → Implement the feature")
		lines.push("5. Code Review → Verify code quality")
		lines.push("6. 資安審核 (Sentinel) → Security audit")
		lines.push("7. Final Review → Final sign-off")

		return lines.join("\n")
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
			// Count as QA failure if returning from QA or Architect Test Review
			if (fromState === AgentState.QA_ENGINEER || fromState === AgentState.ARCHITECT_REVIEW_TESTS) {
				this.qaRejectionCount++
				console.log(`[SentinelFSM] QA rejection count: ${this.qaRejectionCount}/${this.config.maxQARetries}`)
				if (this.qaRejectionCount >= this.config.maxQARetries) {
					return this.triggerHumanIntervention(
						`QA tests failed ${this.qaRejectionCount} times. Human intervention required.`,
					)
				}
			} else if (fromState === AgentState.SENTINEL) {
				this.securityRejectionCount++
				console.log(
					`[SentinelFSM] Security rejection count: ${this.securityRejectionCount}/${this.config.maxSecurityRetries}`,
				)
				if (this.securityRejectionCount >= this.config.maxSecurityRetries) {
					return this.triggerHumanIntervention(
						`Security audit failed ${this.securityRejectionCount} times. Human intervention required.`,
					)
				}
			}
		}

		// Check for Design Review → Designer loop prevention
		if (nextState === AgentState.DESIGNER && fromState === AgentState.DESIGN_REVIEW) {
			this.designReviewRejectionCount++
			console.log(
				`[SentinelFSM] Design Review rejection count: ${this.designReviewRejectionCount}/${this.config.maxDesignReviewRetries}`,
			)

			if (this.designReviewRejectionCount >= this.config.maxDesignReviewRetries) {
				// Check if this is a subtask - if so, complete instead of continuing to Builder
				const task = this.taskRef?.deref?.()
				const isSubtask = !!task?.parentTaskId

				if (isSubtask) {
					console.log(
						`[SentinelFSM] Max Design Review retries reached (subtask). Auto-approving and returning to parent.`,
					)
					if (this.currentContext) {
						this.currentContext.designReviewPassed = true
						this.currentContext.previousAgentNotes =
							(this.currentContext.previousAgentNotes || "") +
							`\n\n⚠️ Auto-approved after ${this.designReviewRejectionCount} Design Review attempts. Returning to parent task.`
					}
					return this.transition(AgentState.COMPLETED)
				} else {
					console.log(
						`[SentinelFSM] Max Design Review retries reached. Auto-approving and proceeding to Builder.`,
					)
					// Auto-approve and proceed to Builder instead of looping forever
					if (this.currentContext) {
						this.currentContext.designReviewPassed = true
						this.currentContext.previousAgentNotes =
							(this.currentContext.previousAgentNotes || "") +
							`\n\n⚠️ Auto-approved after ${this.designReviewRejectionCount} Design Review attempts.`
					}
					return this.transition(AgentState.BUILDER)
				}
			}
		}

		// Reset counters on successful forward progress
		if (nextState === AgentState.BUILDER && fromState === AgentState.DESIGN_REVIEW) {
			// Successfully passed Design Review - reset counter
			this.designReviewRejectionCount = 0
			console.log("[SentinelFSM] Design Review passed, reset rejection counter")
		}
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
			// Phase 1: Initial planning → Designer (if Figma or UI needed) or Builder
			case AgentState.ARCHITECT: {
				console.log(
					"[SentinelFSM] determineNextState from ARCHITECT, handoffData:",
					JSON.stringify(handoffData, null, 2),
				)

				// Check if there's a Figma URL to route to Designer first
				if (handoffData.figmaUrl) {
					console.log("[SentinelFSM] Figma URL detected - routing to Designer:", handoffData.figmaUrl)
					return AgentState.DESIGNER
				}

				// Check if Designer should create UI mockup
				const plan = handoffData.architectPlan as Record<string, unknown> | undefined
				console.log("[SentinelFSM] architectPlan:", plan)
				console.log("[SentinelFSM] handoffData root:", JSON.stringify(handoffData, null, 2))

				// Helper to check truthy values (handles "true", true, 1, etc.)
				const isTruthy = (val: unknown): boolean => {
					if (val === true || val === "true" || val === 1 || val === "1") return true
					return false
				}

				// Check flags at both root level AND inside architectPlan
				// Architect might set these flags in either location
				const rootData = handoffData as Record<string, unknown>

				// Debug: Log the exact raw values before isTruthy check
				console.log("[SentinelFSM] Raw flag values from plan:", {
					needsDesign: plan?.needsDesign,
					needs_design: plan?.needs_design,
					hasUI: plan?.hasUI,
					has_ui: plan?.has_ui,
					useUIDesignCanvas: plan?.useUIDesignCanvas,
					use_ui_design_canvas: plan?.use_ui_design_canvas,
				})
				console.log("[SentinelFSM] Raw flag values from root:", {
					needsDesign: rootData.needsDesign,
					needs_design: rootData.needs_design,
					hasUI: rootData.hasUI,
					has_ui: rootData.has_ui,
					useUIDesignCanvas: rootData.useUIDesignCanvas,
					use_ui_design_canvas: rootData.use_ui_design_canvas,
				})

				const needsDesign =
					isTruthy(plan?.needsDesign) ||
					isTruthy(plan?.needs_design) ||
					isTruthy(rootData.needsDesign) ||
					isTruthy(rootData.needs_design)
				const hasUI =
					isTruthy(plan?.hasUI) ||
					isTruthy(plan?.has_ui) ||
					isTruthy(plan?.hasUi) ||
					isTruthy(rootData.hasUI) ||
					isTruthy(rootData.has_ui) ||
					isTruthy(rootData.hasUi)
				const useFigma =
					isTruthy(plan?.useFigma) ||
					isTruthy(plan?.use_figma) ||
					isTruthy(rootData.useFigma) ||
					isTruthy(rootData.use_figma)
				const usePenpot =
					isTruthy(plan?.usePenpot) ||
					isTruthy(plan?.use_penpot) ||
					isTruthy(rootData.usePenpot) ||
					isTruthy(rootData.use_penpot)
				const useUIDesignCanvas =
					isTruthy(plan?.useUIDesignCanvas) ||
					isTruthy(plan?.use_ui_design_canvas) ||
					isTruthy(rootData.useUIDesignCanvas) ||
					isTruthy(rootData.use_ui_design_canvas)

				// CRITICAL: Check if hasUI is EXPLICITLY set to false
				// This allows tasks like testing, backend work, etc. to skip Designer completely
				const hasUIExplicitlyFalse =
					plan?.hasUI === false ||
					plan?.has_ui === false ||
					plan?.hasUi === false ||
					rootData.hasUI === false ||
					rootData.has_ui === false ||
					rootData.hasUi === false

				console.log(
					"[SentinelFSM] Design flags (after isTruthy) - needsDesign:",
					needsDesign,
					"hasUI:",
					hasUI,
					"useFigma:",
					useFigma,
					"usePenpot:",
					usePenpot,
					"useUIDesignCanvas:",
					useUIDesignCanvas,
					"hasUIExplicitlyFalse:",
					hasUIExplicitlyFalse,
				)

				// If hasUI is explicitly set to false, skip Designer entirely
				if (hasUIExplicitlyFalse) {
					console.log(
						"[SentinelFSM] hasUI explicitly set to false - skipping Designer, routing directly to Builder",
					)
					return AgentState.BUILDER
				}

				if (needsDesign || hasUI || useFigma || usePenpot || useUIDesignCanvas) {
					console.log("[SentinelFSM] UI design requested - routing to Designer for mockup generation")
					return AgentState.DESIGNER
				}

				// Also check notes for Figma/UI keywords as fallback
				const notes = handoffData.previousAgentNotes?.toLowerCase() || ""
				if (
					notes.includes("figma") ||
					notes.includes("penpot") ||
					notes.includes("designer") ||
					notes.includes("ui design") ||
					notes.includes("ui 設計") ||
					notes.includes("ui canvas")
				) {
					console.log("[SentinelFSM] Design tool keywords found in notes - routing to Designer")
					return AgentState.DESIGNER
				}

				// CRITICAL: Also check the original user request for design/UI keywords
				// This ensures we route to Designer even if Architect forgot to set the flags
				const task = this.taskRef.deref()
				console.log("[SentinelFSM] Checking user request keywords, task exists:", !!task)
				if (task) {
					// Find the first user feedback message which contains the original user request
					// In Sentinel mode, the first message might be "text" instead of "user_feedback"
					const allMessages = task.clineMessages || []
					console.log("[SentinelFSM] Total clineMessages:", allMessages.length)
					console.log(
						"[SentinelFSM] Message types:",
						allMessages
							.map((m) => `${m.type}/${m.say || m.ask}`)
							.slice(0, 10)
							.join(", "),
					)

					// First try to find user_feedback, then fall back to first text message with content
					let firstUserMessage = allMessages.find((m) => m.type === "say" && m.say === "user_feedback")
					if (!firstUserMessage) {
						// In Sentinel mode, the first message might be a "text" type that contains the user's request
						firstUserMessage = allMessages.find(
							(m) => m.type === "say" && m.say === "text" && m.text && m.text.length > 0,
						)
					}
					console.log(
						"[SentinelFSM] First user message found:",
						!!firstUserMessage,
						"type:",
						firstUserMessage?.say,
						"text:",
						firstUserMessage?.text?.substring(0, 50),
					)

					if (firstUserMessage && firstUserMessage.text) {
						const userRequest = firstUserMessage.text.toLowerCase()
						console.log("[SentinelFSM] User request (first 100 chars):", userRequest.substring(0, 100))

						// Check for explicit design tool keywords
						const figmaKeywords = [
							"figma",
							"使用figma",
							"用figma",
							"請先使用figma",
							"先figma",
							"設計稿",
							"mockup",
						]
						if (figmaKeywords.some((keyword) => userRequest.includes(keyword))) {
							console.log(
								"[SentinelFSM] Figma keywords found in ORIGINAL USER REQUEST - routing to Designer",
							)
							if (this.currentContext?.architectPlan) {
								;(this.currentContext.architectPlan as unknown as Record<string, unknown>).useFigma =
									true
							}
							return AgentState.DESIGNER
						}

						// Check for Penpot keywords
						const penpotKeywords = ["penpot", "使用penpot", "用penpot", "請先使用penpot", "先penpot"]
						if (penpotKeywords.some((keyword) => userRequest.includes(keyword))) {
							console.log(
								"[SentinelFSM] Penpot keywords found in ORIGINAL USER REQUEST - routing to Designer",
							)
							if (this.currentContext?.architectPlan) {
								;(this.currentContext.architectPlan as unknown as Record<string, unknown>).usePenpot =
									true
							}
							return AgentState.DESIGNER
						}

						// UI DETECTION: Only detect explicit UI/design related keywords
						// Removed generic keywords like "app", "應用", "note" to prevent false positives
						const designKeywords = [
							// Explicit design keywords (Chinese)
							"ui設計",
							"介面設計",
							"界面設計",
							"視覺設計",
							"畫面設計",
							"幫我設計介面",
							"設計一個畫面",
							"設計一個頁面",
							// Explicit design keywords (English)
							"ui design",
							"design the interface",
							"design a page",
							"design mockup",
							// UI component keywords that clearly indicate UI work
							"dashboard設計",
							"儀表板設計",
							"控制面板設計",
							"登入頁面",
							"login page",
							"註冊頁面",
							"register page",
							"按鈕設計",
							"選單設計",
							"導航設計",
							"navigation design",
							// Design tool keywords
							"figma",
							"penpot",
							"ui canvas",
							"mockup",
							"設計稿",
							"wireframe",
							// Specific UI component requests
							"前端介面",
							"frontend ui",
							"視覺介面",
						]

						if (designKeywords.some((keyword) => userRequest.includes(keyword))) {
							console.log(
								"[SentinelFSM] UI/Design keywords detected in user request - routing to Designer with UIDesignCanvas",
							)
							// Set UIDesignCanvas as default for UI tasks
							if (this.currentContext?.architectPlan) {
								const plan = this.currentContext.architectPlan as unknown as Record<string, unknown>
								plan.useUIDesignCanvas = true
								plan.needsDesign = true
								plan.hasUI = true
							}
							return AgentState.DESIGNER
						}
					}
				}

				console.log("[SentinelFSM] No UI design indicators found - routing to Builder")
				return AgentState.BUILDER
			}

			// Phase 1b: Designer → Design Review
			case AgentState.DESIGNER:
				return AgentState.DESIGN_REVIEW

			// Phase 1c: Design Review → Builder (if approved) or Designer (if rejected)
			case AgentState.DESIGN_REVIEW: {
				// [HANDOFF LOGGING] Full handoff data dump for debugging
				console.log("[SentinelFSM] ========== DESIGN REVIEW HANDOFF DECISION ==========")
				console.log("[SentinelFSM] Full handoffData:", JSON.stringify(handoffData, null, 2))

				// Check for approval - support multiple formats
				// Accept boolean true, string "true", or status-based approval
				// Cast to any to allow flexible comparison (AI may output various formats)
				const designReviewPassedValue = handoffData.designReviewPassed as any
				const isApprovedByFlag =
					designReviewPassedValue === true ||
					designReviewPassedValue === "true" ||
					designReviewPassedValue === 1 ||
					designReviewPassedValue === "1"

				// Also check status field for approval indicators
				const statusLower = (handoffData.designReviewStatus || handoffData.status || "")
					.toString()
					.toLowerCase()
				const isApprovedByStatus =
					statusLower === "approved" ||
					statusLower === "passed" ||
					statusLower === "pass" ||
					statusLower.includes("通過") ||
					statusLower.includes("approved")

				// Check notes for approval keywords
				const notesLower = (handoffData.previousAgentNotes || "").toString().toLowerCase()
				const isApprovedByNotes =
					notesLower.includes("設計審查通過") ||
					notesLower.includes("design review passed") ||
					notesLower.includes("審查通過") ||
					notesLower.includes("勉強可以") ||
					notesLower.includes("通過了")

				const isApproved = isApprovedByFlag || isApprovedByStatus || isApprovedByNotes

				// Only reject if NOT approved AND has explicit rejection indicators
				// Key fix: if isApproved is true, we should NOT reject
				const hasExplicitRejection =
					handoffData.designReviewStatus === "rejected" ||
					(handoffData.completion_percentage && parseInt(handoffData.completion_percentage) < 80)

				const isRejected = !isApproved && hasExplicitRejection

				console.log("[SentinelFSM] Design Review check:", {
					designReviewPassed: handoffData.designReviewPassed,
					designReviewPassedType: typeof handoffData.designReviewPassed,
					designReviewStatus: handoffData.designReviewStatus,
					status: handoffData.status,
					completion_percentage: handoffData.completion_percentage,
					isApprovedByFlag,
					isApprovedByStatus,
					isApprovedByNotes,
					isApproved,
					hasExplicitRejection,
					isRejected,
				})

				if (isRejected) {
					console.log("[SentinelFSM] Design Review REJECTED - returning to Designer")
					return AgentState.DESIGNER
				}

				// Check if this is a subtask - if so, complete instead of continuing to Builder
				const task = this.taskRef?.deref?.()
				if (task?.parentTaskId) {
					console.log(
						`[SentinelFSM] Design Review PASSED - this is a subtask, returning COMPLETED to return to parent (${task.parentTaskId})`,
					)
					return AgentState.COMPLETED
				}

				console.log("[SentinelFSM] Design Review PASSED - continuing to Builder")
				return AgentState.BUILDER
			}

			// Phase 2: Builder → Architect reviews code
			case AgentState.BUILDER:
				return AgentState.ARCHITECT_REVIEW_CODE

			// Phase 2b: Architect reviews code → QA (auto-approve unless rejected)
			case AgentState.ARCHITECT_REVIEW_CODE:
				if (handoffData.architectReviewCode?.approved === false) {
					return AgentState.ARCHITECT // Re-plan before Builder
				}
				return AgentState.QA_ENGINEER

			// Phase 3: QA → Builder (if tests failed) or Architect reviews tests (if passed)
			case AgentState.QA_ENGINEER: {
				// Check if QA tests failed - need to go back to Builder to fix issues
				// Method 1: Explicit testsPassed flag
				if (handoffData.qaAuditContext?.testsPassed === false) {
					console.log("[SentinelFSM] QA tests FAILED (explicit flag) - returning to Builder for fixes")
					return AgentState.BUILDER
				}
				// Method 2: Check for failure indicators in the notes if no explicit flag
				const notes = handoffData.previousAgentNotes?.toLowerCase() || ""
				const failureIndicators = [
					"critical issue",
					"failed",
					"error",
					"not working",
					"broken",
					"❌",
					"x critical",
					"tests failed",
					"test failed",
					"failure",
				]
				const hasFailure = failureIndicators.some((indicator) => notes.includes(indicator))
				if (hasFailure && !notes.includes("all tests pass") && !notes.includes("tests passed")) {
					console.log("[SentinelFSM] QA tests FAILED (detected from notes) - returning to Builder for fixes")
					return AgentState.BUILDER
				}
				return AgentState.ARCHITECT_REVIEW_TESTS
			}

			// Phase 3b: Architect reviews tests → Sentinel (auto-approve unless rejected OR tests failed)
			case AgentState.ARCHITECT_REVIEW_TESTS: {
				// Method 1: Explicit rejection from architect - now goes DIRECTLY to Builder
				if (handoffData.architectReviewTests?.approved === false) {
					console.log("[SentinelFSM] Architect rejected tests - returning to Builder with issues to fix")
					// Pass the rejection notes to Builder
					if (this.currentContext && handoffData.previousAgentNotes) {
						this.currentContext.previousAgentNotes =
							(this.currentContext.previousAgentNotes || "") +
							"\n\n**Architect Test Review Feedback:**\n" +
							handoffData.previousAgentNotes
					}
					return AgentState.BUILDER // Direct to Builder, not Architect
				}
				// Method 2: Check if QA tests actually failed (from context)
				if (this.currentContext?.qaAuditContext?.testsPassed === false) {
					console.log("[SentinelFSM] QA tests were marked as FAILED in context - returning to Builder")
					return AgentState.BUILDER
				}
				// Method 3: Check for failure keywords in current handoff notes
				const reviewNotes = handoffData.previousAgentNotes?.toLowerCase() || ""
				const testFailIndicators = [
					"tests: failed",
					"test failed",
					"tests failed",
					"critical issue",
					"❌",
					"needs fix",
					"need to fix",
					"bug found",
					"issue found",
				]
				const hasTestFailure = testFailIndicators.some((indicator) => reviewNotes.includes(indicator))
				if (hasTestFailure) {
					console.log("[SentinelFSM] Test failure detected in review notes - returning to Builder")
					// Pass issue details to Builder
					if (this.currentContext && handoffData.previousAgentNotes) {
						this.currentContext.previousAgentNotes =
							(this.currentContext.previousAgentNotes || "") +
							"\n\n**Issues to Fix:**\n" +
							handoffData.previousAgentNotes
					}
					return AgentState.BUILDER
				}
				return AgentState.SENTINEL
			}

			// BLOCKED state recovery - allow handoff to continue the workflow
			case AgentState.BLOCKED: {
				console.log("[SentinelFSM] BLOCKED state handoff - attempting recovery")

				// CRITICAL: Reset rejection counters on recovery to prevent immediate re-blocking
				this.qaRejectionCount = 0
				this.securityRejectionCount = 0
				this.designReviewRejectionCount = 0
				console.log("[SentinelFSM] BLOCKED recovery: Reset rejection counters")

				// If tests passed in the handoff, go to Architect Code Review for verification
				const qaResult = handoffData.qaAuditContext
				if (qaResult?.testsPassed === true) {
					console.log("[SentinelFSM] BLOCKED recovery: QA tests passed, proceeding to Architect Code Review")
					return AgentState.ARCHITECT_REVIEW_CODE
				}
				// If tests failed, go back to Builder
				if (qaResult?.testsPassed === false) {
					console.log("[SentinelFSM] BLOCKED recovery: QA tests failed, returning to Builder")
					return AgentState.BUILDER
				}
				// Default: go to Architect Review to verify what happened
				console.log("[SentinelFSM] BLOCKED recovery: No clear indication, going to Architect Review")
				return AgentState.ARCHITECT_REVIEW_CODE
			}

			// Phase 4: Sentinel security audit → Architect final review (or back to Builder if failed)
			case AgentState.SENTINEL:
				// Check if security audit failed
				if (
					handoffData.sentinelResult?.securityPassed === false ||
					handoffData.sentinelResult?.recommendation === "reject"
				) {
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

		// Update context - track the actual fromState for each transition
		if (this.currentContext) {
			this.currentContext.fromAgent = fromState // Update fromAgent to reflect current transition
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

		// Generate walkthrough on completion and clear agent memory
		if (targetState === AgentState.COMPLETED && this.currentContext) {
			const task = this.taskRef.deref()

			// Check if this is a subtask - if so, trigger parent return
			if (task?.parentTaskId) {
				console.log(
					`[SentinelFSM] Subtask workflow completed. Triggering return to parent (${task.parentTaskId})`,
				)

				// Clear agent memory first
				task.clearSentinelAgentMemory()
				console.log("[SentinelFSM] Cleared agent memory for subtask completion")

				// Add a message that instructs the AI to use attempt_completion
				// This will trigger the normal subtask return flow
				await task.say(
					"text",
					`✅ **設計子任務已完成**\n\n` +
						`設計審查已通過，現在需要返回父任務。\n\n` +
						`⚠️ **重要：請立即使用 \`attempt_completion\` 工具返回父任務！**\n\n` +
						`父任務 ID: \`${task.parentTaskId}\`\n` +
						`請在 result 參數中總結設計結果，然後返回父任務繼續後續工作。`,
				)

				// Skip walkthrough generation for subtasks
				return {
					success: true,
					fromState,
					toState: targetState,
					context: this.currentContext ?? undefined,
				}
			}

			// For non-subtasks, generate walkthrough
			await this.generateWalkthrough()

			// Clear per-agent conversation memory as workflow is complete
			if (task) {
				task.clearSentinelAgentMemory()
				console.log("[SentinelFSM] Cleared agent memory on workflow completion")
			}

			// Trigger Spec task completion callback if set (for TaskExecutor auto-advance)
			if (this.onSpecTaskCompleteCallback && this.currentContext.specTaskContext) {
				const specTaskId = this.currentContext.specTaskContext.taskId
				console.log(`[SentinelFSM] Triggering Spec task completion callback for task: ${specTaskId}`)
				this.onSpecTaskCompleteCallback({ success: true, taskId: specTaskId })
			}
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
		if (!provider) {
			console.error("[SentinelFSM] switchToAgentMode: No provider available")
			return
		}

		let targetModeSlug: string
		if (agentState === AgentState.COMPLETED || agentState === AgentState.IDLE) {
			// Check if this is a subtask completing - if so, don't switch mode
			// The subtask needs to stay in current mode to use attempt_completion
			const task = this.taskRef.deref()
			if (task?.parentTaskId && agentState === AgentState.COMPLETED) {
				console.log(
					"[SentinelFSM] switchToAgentMode: Subtask completing - skipping mode switch to allow parent return",
				)
				return
			}
			// Return to default mode for non-subtasks
			targetModeSlug = "code"
		} else if (agentState === AgentState.BLOCKED) {
			// Stay in current mode
			console.log("[SentinelFSM] switchToAgentMode: BLOCKED state - staying in current mode")
			return
		} else {
			// Switch to agent mode using the correct mode slug
			targetModeSlug = this.getCurrentAgent()
		}

		console.log(`[SentinelFSM] switchToAgentMode: Switching to mode "${targetModeSlug}" for state ${agentState}`)

		try {
			// Before switching mode, populate mcpConnectionStatus in currentContext for Designer
			if (agentState === AgentState.DESIGNER) {
				const mcpHub = provider.getMcpHub()
				const mcpConnectionStatus = {
					uiDesignCanvas: mcpHub?.isUIDesignCanvasConnected?.() ?? false,
					penpot:
						mcpHub
							?.getServers()
							?.some((s) => s.name.toLowerCase().includes("penpot") && s.status === "connected") ?? false,
					talkToFigma: mcpHub?.isTalkToFigmaConnected?.() ?? false,
					figmaWrite:
						mcpHub?.getServers()?.some((s) => s.name === "figma-write" && s.status === "connected") ??
						false,
					mcpUi:
						mcpHub
							?.getServers()
							?.some((s) => s.name.toLowerCase().includes("mcp-ui") && s.status === "connected") ?? false,
				}
				console.log(`[SentinelFSM] Populating mcpConnectionStatus for Designer:`, mcpConnectionStatus)

				// Update currentContext with mcpConnectionStatus
				if (this.currentContext) {
					this.currentContext.mcpConnectionStatus = mcpConnectionStatus
				}
			}

			// Pre-open design preview panel BEFORE mode switch for Designer
			// This ensures the panel is ready to receive design updates immediately
			if (agentState === AgentState.DESIGNER) {
				await this.openFigmaPreviewForDesigner(provider)
			}

			await provider.handleModeSwitch(targetModeSlug)
			console.log(`[SentinelFSM] switchToAgentMode: Successfully switched to "${targetModeSlug}"`)
		} catch (error) {
			console.error(`[SentinelFSM] switchToAgentMode: Failed to switch to "${targetModeSlug}":`, error)
		}
	}

	/**
	 * Open design preview panel when Designer starts working
	 * Supports both UIDesignCanvas and Figma based on handoff context
	 */
	private async openFigmaPreviewForDesigner(provider: ClineProvider): Promise<void> {
		try {
			// Get settings from provider state
			const state = await provider.getState()

			// Check if we should use UIDesignCanvas (from handoff context, state, or as default)
			const mcpHub = provider.getMcpHub()
			const uiDesignCanvasConnected = mcpHub?.isUIDesignCanvasConnected?.() ?? false
			const uiDesignCanvasEnabled = state.uiDesignCanvasEnabled ?? true // Default true for built-in tool

			// Check Figma connection status
			const talkToFigmaConnected = mcpHub?.isTalkToFigmaConnected?.() ?? false
			const figmaWriteConnected =
				mcpHub?.getServers()?.some((s) => s.name === "figma-write" && s.status === "connected") ?? false

			// Use UIDesignCanvas if:
			// 1. Explicitly requested in architect plan, OR
			// 2. UIDesignCanvas is enabled AND (connected OR no Figma alternatives are connected)
			const useUIDesignCanvas =
				this.currentContext?.architectPlan?.useUIDesignCanvas ||
				(uiDesignCanvasEnabled && (uiDesignCanvasConnected || (!talkToFigmaConnected && !figmaWriteConnected)))

			console.log(
				`[SentinelFSM] Design preview check - useUIDesignCanvas: ${useUIDesignCanvas}, enabled: ${uiDesignCanvasEnabled}, connected: ${uiDesignCanvasConnected}, talkToFigma: ${talkToFigmaConnected}, figmaWrite: ${figmaWriteConnected}`,
			)

			if (useUIDesignCanvas) {
				// Open UIDesignCanvas preview panel
				console.log("[SentinelFSM] Opening UIDesignCanvas preview panel for Designer")
				const panel = UIDesignCanvasPanel.createOrShow(provider.context.extensionUri)

				// Set the MCP server port for syncing edits back to server
				if (mcpHub) {
					const port = mcpHub.getUIDesignCanvasPort()
					panel.setMcpServerPort(port)
					console.log("[SentinelFSM] UIDesignCanvas panel configured with MCP port:", port)
				}

				console.log("[SentinelFSM] UIDesignCanvas preview panel opened for Designer")
				return
			}

			// Otherwise, try to use Figma
			const figmaEnabled = state.figmaEnabled
			const webPreviewEnabled = state.figmaWebPreviewEnabled
			const figmaFileUrl = state.figmaFileUrl

			if (!figmaEnabled) {
				console.log("[SentinelFSM] Figma is disabled, skipping preview panel")
				return
			}

			if (!webPreviewEnabled) {
				console.log("[SentinelFSM] Figma web preview is disabled, skipping preview panel")
				return
			}

			if (!figmaFileUrl) {
				console.log("[SentinelFSM] No Figma file URL configured, skipping preview panel")
				return
			}

			// Initialize and show Figma preview panel
			const figmaPreview = FigmaPreviewPanel.initialize(provider.context.extensionUri)
			await figmaPreview.show(figmaFileUrl)
			console.log("[SentinelFSM] Figma preview panel opened for Designer")
		} catch (error) {
			console.error("[SentinelFSM] Failed to open design preview:", error)
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
	private async generateWalkthrough(): Promise<boolean> {
		const provider = this.providerRef.deref()
		if (!provider || !this.currentContext) {
			console.error("[SentinelFSM] generateWalkthrough: No provider or context")
			return false
		}

		const context = this.currentContext
		const task = provider.getCurrentTask()
		if (!task) {
			console.error("[SentinelFSM] generateWalkthrough: No current task")
			return false
		}

		let walkthrough = "# 📋 Workflow Walkthrough\n\n"
		walkthrough += `**Status:** ✅ Completed\n`
		walkthrough += `**Completed at:** ${new Date().toLocaleString()}\n\n`

		walkthrough += "---\n\n"

		// Add flow comparison diagram
		walkthrough += "## 📊 Workflow Flow Comparison\n\n"
		walkthrough += "### Planned Flow vs Actual Flow\n\n"
		walkthrough += "```mermaid\n"
		walkthrough += "flowchart LR\n"
		walkthrough += '    subgraph Planned["📋 Planned Flow"]\n'
		walkthrough += "        P1[Architect] --> P2[Builder]\n"
		walkthrough += "        P2 --> P3[Review]\n"
		walkthrough += "        P3 --> P4[QA]\n"
		walkthrough += "        P4 --> P5[Security]\n"
		walkthrough += "        P5 --> P6[Final]\n"
		walkthrough += "    end\n"
		walkthrough += '    subgraph Actual["✅ Actual Flow"]\n'
		walkthrough += '        A1["✅ Architect"] --> A2["✅ Builder"]\n'
		walkthrough += '        A2 --> A3["✅ Review"]\n'
		walkthrough += '        A3 --> A4["✅ QA"]\n'
		walkthrough += '        A4 --> A5["✅ Security"]\n'
		walkthrough += '        A5 --> A6["✅ Final"]\n'
		walkthrough += "    end\n"
		walkthrough += "```\n\n"

		// Architect Plan Summary
		if (context.architectPlan) {
			walkthrough += "## 🏗️ Architect Plan\n\n"
			const plan = context.architectPlan
			walkthrough += `**Project:** ${plan.projectName || "N/A"}\n`
			walkthrough += `**Summary:** ${plan.summary || "N/A"}\n\n`
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
			walkthrough += `**Test URL:** ${builder.targetUrl || "N/A"}\n`
			walkthrough += `**Run Command:** ${builder.runCommand || "N/A"}\n\n`
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

		console.log(`[SentinelFSM] Attempting to write walkthrough to: ${walkthroughPath}`)

		try {
			const fs = await import("fs/promises")

			// Collect screenshots from workspace
			let screenshotSection = ""
			try {
				const files = await fs.readdir(cwd)
				const screenshots = files
					.filter(
						(f) => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg") || f.endsWith(".webp"),
					)
					.filter((f) => f.includes("screenshot") || f.includes("test") || f.includes("browser"))

				if (screenshots.length > 0) {
					screenshotSection = "\n## 📸 Test Screenshots\n\n"
					screenshots.forEach((s, i) => {
						screenshotSection += `### Screenshot ${i + 1}\n`
						screenshotSection += `![${s}](./${s})\n\n`
					})
				}
			} catch (e) {
				// Ignore errors reading screenshots
				console.warn("[SentinelFSM] Could not read screenshots:", e)
			}

			// Insert screenshots before the divider
			const finalWalkthrough = walkthrough.replace(
				"---\n\n*Generated by Sentinel Code Workflow*",
				screenshotSection + "---\n\n*Generated by Sentinel Code Workflow*",
			)

			await fs.writeFile(walkthroughPath, finalWalkthrough, "utf-8")
			console.log(`[SentinelFSM] Successfully wrote walkthrough to: ${walkthroughPath}`)
			await task.say("text", `📋 **Walkthrough saved to:** \`${walkthroughPath}\``)
			return true
		} catch (error) {
			// Log the error and notify user
			console.error(`[SentinelFSM] Failed to write walkthrough to ${walkthroughPath}:`, error)
			await task.say(
				"text",
				`⚠️ **Could not save walkthrough file**\n\nError: ${(error as Error).message}\n\nPath attempted: \`${walkthroughPath}\`\n\n---\n\n${walkthrough}`,
			)
			return false
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
	public getAgentDisplayName(state: AgentState): string {
		const names: Record<AgentState, string> = {
			[AgentState.IDLE]: "Idle",
			[AgentState.ARCHITECT]: "🟦 Architect",
			[AgentState.DESIGNER]: "🎨 Designer",
			[AgentState.DESIGN_REVIEW]: "🔎 Design Review",
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
	):
		| "IDLE"
		| "ARCHITECT"
		| "DESIGNER"
		| "BUILDER"
		| "ARCHITECT_REVIEW"
		| "QA"
		| "SENTINEL"
		| "COMPLETED"
		| "BLOCKED" {
		const mapping: Record<
			AgentState,
			| "IDLE"
			| "ARCHITECT"
			| "DESIGNER"
			| "BUILDER"
			| "ARCHITECT_REVIEW"
			| "QA"
			| "SENTINEL"
			| "COMPLETED"
			| "BLOCKED"
		> = {
			[AgentState.IDLE]: "IDLE",
			[AgentState.ARCHITECT]: "ARCHITECT",
			[AgentState.DESIGNER]: "DESIGNER",
			[AgentState.DESIGN_REVIEW]: "DESIGNER",
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
				[AgentState.DESIGNER]: "Analyzing Figma designs and creating UI specifications...",
				[AgentState.DESIGN_REVIEW]: "Verifying design completeness...",
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
				// Map agent state to clean display name (without emoji for handoff message)
				const getCleanAgentName = (agent: any): string => {
					if (!agent) return "Unknown"
					const agentStr = String(agent).toUpperCase()
					// Match against known agent states
					if (agentStr.includes("ARCHITECT") && agentStr.includes("CODE")) return "Architect (Code Review)"
					if (agentStr.includes("ARCHITECT") && agentStr.includes("TEST")) return "Architect (Test Review)"
					if (agentStr.includes("ARCHITECT") && agentStr.includes("FINAL")) return "Architect (Final Review)"
					if (agentStr.includes("DESIGN_REVIEW")) return "Design Review"
					if (agentStr.includes("ARCHITECT")) return "Architect"
					if (agentStr.includes("DESIGNER") || agentStr === "DESIGNER") return "Designer"
					if (agentStr.includes("BUILDER") || agentStr === "BUILDER") return "Builder"
					if (agentStr.includes("QA") || agentStr === "QA_ENGINEER") return "QA"
					if (agentStr.includes("SENTINEL") || agentStr === "SENTINEL") return "Sentinel"
					if (agentStr.includes("COMPLETED")) return "Completed"
					if (agentStr.includes("BLOCKED")) return "Blocked"
					if (agentStr.includes("IDLE")) return "Idle"
					return String(agent) // Fallback to original value
				}
				lastHandoff = {
					from: getCleanAgentName(ctx.fromAgent),
					to: getCleanAgentName(ctx.toAgent),
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

		if (ctx.architectPlan?.projectName) {
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
			designReviewRejectionCount: this.designReviewRejectionCount,
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
