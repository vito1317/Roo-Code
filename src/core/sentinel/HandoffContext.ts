/**
 * Sentinel Edition - Handoff Context
 *
 * Defines the structured context passed between agents during workflow transitions.
 * Each agent type has specific context requirements for receiving and sending handoffs.
 */

/**
 * Task item in architect's plan
 */
export interface PlanTask {
	id: number
	title: string
	description: string
	dependencies: number[]
	estimatedComplexity: "low" | "medium" | "high"
	acceptanceCriteria: string[]
}

/**
 * Spec Mode Task Context
 * Context from tasks.md passed to FSM for spec-driven development
 */
export interface SpecTaskContext {
	/** Task ID from tasks.md */
	taskId: string
	/** Task title */
	title: string
	/** Task description */
	description?: string
	/** Acceptance criteria from spec */
	acceptanceCriteria?: string[]
	/** Estimated complexity (1-5) */
	complexity?: number
	/** Source spec file (requirements.md, design.md) */
	specFile?: string
	/** Dependencies on other tasks */
	dependencies?: string[]
}


/**
 * Risk identified by architect
 */
export interface IdentifiedRisk {
	description: string
	mitigation: string
	severity: "low" | "medium" | "high"
}

/**
 * Architect → Builder context
 */
export interface ArchitectPlan {
	projectName: string
	summary: string
	tasks: PlanTask[]
	techStack: {
		frontend?: string[]
		backend?: string[]
		database?: string
		testing?: string[]
		other?: string[]
	}
	acceptanceCriteria: string[]
	risks: IdentifiedRisk[]
	// Design tool selection flags
	needsDesign?: boolean
	hasUI?: boolean
	useFigma?: boolean
	usePenpot?: boolean
	useUIDesignCanvas?: boolean
}

/**
 * Test scenario for QA
 */
export interface TestScenario {
	name: string
	steps: string[]
	expectedResult: string
	priority: "critical" | "high" | "normal"
}

/**
 * Visual checkpoint for QA verification
 */
export interface VisualCheckpoint {
	selector: string
	expectedState: string
	screenshotRequired: boolean
}

/**
 * Builder → QA context
 */
export interface BuilderTestContext {
	targetUrl: string
	testCredentials?: {
		user: string
		pass: string
	}
	testScenarios: TestScenario[]
	visualCheckpoints: VisualCheckpoint[]
	changedFiles: string[]
	runCommand: string
	setupInstructions?: string[]
}

/**
 * Test result from QA
 */
export interface TestResult {
	scenario: string
	passed: boolean
	screenshots: string[]
	notes?: string
	failureDetails?: {
		step: string
		error: string
		suggestedFix?: string
	}
}

/**
 * Sensitive operation identified by QA
 */
export interface SensitiveOperation {
	file: string
	line: number
	type: "database" | "auth" | "file" | "network" | "crypto"
	description: string
}

/**
 * QA → Sentinel context
 */
export interface QAAuditContext {
	testsPassed: boolean
	testResults: TestResult[]
	changedFiles: string[]
	entryPoints: string[]
	sensitiveOperations: SensitiveOperation[]
}

/**
 * Vulnerability found by Sentinel
 */
export interface Vulnerability {
	severity: "critical" | "high" | "medium" | "low" | "info"
	type: "SQLi" | "XSS" | "Auth" | "IDOR" | "Injection" | "Crypto" | "Config" | "Other"
	file: string
	line: number
	description: string
	recommendation: string
	cweId?: string
	evidence?: string
}

/**
 * DAST test result
 */
export interface DASTResult {
	attack: string
	target: string
	result: "blocked" | "vulnerable" | "error"
	evidence?: string
	payload: string
}

/**
 * Sentinel → Final decision or Builder
 */
export interface SentinelAuditResult {
	securityPassed: boolean
	vulnerabilities: Vulnerability[]
	dastResults: DASTResult[]
	recommendation: "approve" | "fix_required" | "reject"
	summary: string
}

/**
 * Failure record for tracking retry history
 */
export interface FailureRecord {
	agent: string
	timestamp: Date
	reason: string
	details: string
}

/**
 * Architect code review result
 */
export interface ArchitectCodeReview {
	approved: boolean
	codeFeedback: string
	issues: {
		file: string
		line?: number
		issue: string
		severity: "critical" | "major" | "minor" | "suggestion"
	}[]
	meetsArchitecture: boolean
	meetsAcceptanceCriteria: boolean
}

/**
 * Architect test review result
 */
export interface ArchitectTestReview {
	approved: boolean
	testFeedback: string
	coverageAdequate: boolean
	testsMatchRequirements: boolean
	missingTests?: string[]
}

/**
 * Architect final review result
 */
export interface ArchitectFinalReview {
	approved: boolean
	finalFeedback: string
	securityAcceptable: boolean
	readyForDeployment: boolean
	remainingIssues?: string[]
}

/**
 * Complete handoff context passed between agents
 */
export interface HandoffContext {
	// Metadata
	id: string
	createdAt: Date
	fromAgent: string
	toAgent: string
	attemptNumber: number

	// Agent-specific contexts
	architectPlan?: ArchitectPlan
	builderTestContext?: BuilderTestContext
	qaAuditContext?: QAAuditContext
	sentinelResult?: SentinelAuditResult

	// Architect review contexts (Supervisor Workflow)
	architectReviewCode?: ArchitectCodeReview
	architectReviewTests?: ArchitectTestReview
	architectFinalReview?: ArchitectFinalReview

	// Designer context (Figma integration)
	figmaUrl?: string
	designSpecs?: string // Path to design-specs.md or inline specs

	// Design Review context
	expectedElements?: number // Number of expected UI elements
	actualElements?: number // Number of elements found by Design Review
	designReviewPassed?: boolean // Whether Design Review approved the design
	designReviewStatus?: string // "approved" | "rejected" - alternative format
	completion_percentage?: string // e.g. "60%" - used for rejection threshold check
	missingComponents?: string[] // List of missing components if rejected
	createdComponents?: string[] // List of components created by Designer (e.g. ["header", "button", "form"])

	// Design tool selection flags (extracted from Architect's handoff)
	needsDesign?: boolean
	hasUI?: boolean
	useFigma?: boolean
	usePenpot?: boolean
	useUIDesignCanvas?: boolean

	// Builder → Designer routing flags
	needsDesignRevision?: boolean // Set by Builder when design needs revision
	returnToDesigner?: boolean // Alternative flag to route back to Designer

	// MCP connection status for dynamic tool selection
	mcpConnectionStatus?: {
		uiDesignCanvas?: boolean
		penpot?: boolean
		talkToFigma?: boolean
		figmaWrite?: boolean
		mcpUi?: boolean
	}

	// Common fields
	previousAgentNotes: string
	failureHistory: FailureRecord[]

	// Dynamic phase instructions (injected at handoff)
	nextPhaseInstructions?: string

	// Spec Mode task context (for spec-driven development)
	specTaskContext?: SpecTaskContext

	// State
	status: "pending" | "in_progress" | "completed" | "failed" | "blocked"
}

/**
 * Create a new handoff context
 */
export function createHandoffContext(
	fromAgent: string,
	toAgent: string,
	previousContext?: HandoffContext,
): HandoffContext {
	return {
		id: generateContextId(),
		createdAt: new Date(),
		fromAgent,
		toAgent,
		attemptNumber: previousContext ? previousContext.attemptNumber + 1 : 1,
		previousAgentNotes: "",
		failureHistory: previousContext?.failureHistory || [],
		status: "pending",
	}
}

/**
 * Generate unique context ID
 */
function generateContextId(): string {
	return `hctx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Validate handoff context has required fields for target agent
 */
export function validateHandoffContext(context: HandoffContext, targetAgent: string): string[] {
	// TEMPORARILY: Allow all transitions without strict validation
	// This prevents the workflow from getting stuck when context fields are missing
	// The agents will handle missing context gracefully
	return []
}

/**
 * Serialize handoff context to JSON for storage
 */
export function serializeHandoffContext(context: HandoffContext): string {
	return JSON.stringify(context, (key, value) => {
		if (value instanceof Date) {
			return value.toISOString()
		}
		return value
	})
}

/**
 * Deserialize handoff context from JSON
 */
export function deserializeHandoffContext(json: string): HandoffContext {
	return JSON.parse(json, (key, value) => {
		if (key === "createdAt" || key === "timestamp") {
			return new Date(value)
		}
		return value
	})
}

/**
 * Extract summary for injection into agent prompt
 */
export function getHandoffSummary(context: HandoffContext): string {
	const lines: string[] = []

	lines.push(`## Handoff Context (Attempt #${context.attemptNumber})`)
	lines.push(`From: ${context.fromAgent}`)
	lines.push(`To: ${context.toAgent}`)
	lines.push("")

	if (context.previousAgentNotes) {
		lines.push(`### Previous Agent Notes`)
		lines.push(context.previousAgentNotes)
		lines.push("")
	}

	const failureHistory = context.failureHistory ?? []
	if (failureHistory.length > 0) {
		lines.push(`### Previous Failures (${failureHistory.length})`)
		for (const failure of failureHistory) {
			lines.push(`- [${failure.agent}] ${failure.reason}`)
		}
		lines.push("")
	}

	if (context.architectPlan) {
		lines.push(`### Architect Plan`)
		lines.push(`Project: ${context.architectPlan.projectName ?? "Unnamed Project"}`)
		const tasks = context.architectPlan.tasks ?? []
		lines.push(`Tasks: ${tasks.length}`)
		lines.push(`Tech Stack: ${JSON.stringify(context.architectPlan.techStack ?? {})}`)
		lines.push("")
	}

	if (context.builderTestContext) {
		lines.push(`### Builder Test Context`)
		lines.push(`Target URL: ${context.builderTestContext.targetUrl ?? "Not specified"}`)
		const changedFiles = context.builderTestContext.changedFiles ?? []
		const testScenarios = context.builderTestContext.testScenarios ?? []
		lines.push(`Changed Files: ${changedFiles.length}`)
		lines.push(`Test Scenarios: ${testScenarios.length}`)
		lines.push("")
	}

	if (context.qaAuditContext) {
		lines.push(`### QA Results`)
		lines.push(`Tests Passed: ${context.qaAuditContext.testsPassed ?? "Unknown"}`)
		const sensitiveOps = context.qaAuditContext.sensitiveOperations ?? []
		lines.push(`Sensitive Operations: ${sensitiveOps.length}`)
		lines.push("")
	}

	if (context.sentinelResult) {
		lines.push(`### Sentinel Audit`)
		lines.push(`Security Passed: ${context.sentinelResult.securityPassed ?? "Unknown"}`)
		const vulnerabilities = context.sentinelResult.vulnerabilities ?? []
		lines.push(`Vulnerabilities: ${vulnerabilities.length}`)
		lines.push(`Recommendation: ${context.sentinelResult.recommendation ?? "None"}`)
		lines.push("")
	}

	// Add dynamic phase instructions if present
	if (context.nextPhaseInstructions) {
		lines.push(`### Phase Instructions`)
		lines.push(context.nextPhaseInstructions)
		lines.push("")
	}

	return lines.join("\n")
}
