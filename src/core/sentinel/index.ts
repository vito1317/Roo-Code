/**
 * Sentinel Edition - Module Exports
 *
 * Central export point for all Sentinel Edition modules.
 */

// State Machine
export { SentinelStateMachine, AgentState, createSentinelFSM } from "./StateMachine"
export type { TransitionResult, FSMEvent, FSMEventListener, StateMachineConfig } from "./StateMachine"

// Agent Personas
export {
	SENTINEL_AGENTS,
	ARCHITECT_AGENT,
	BUILDER_AGENT,
	QA_ENGINEER_AGENT,
	SENTINEL_AGENT,
	getAgentPersona,
	getNextAgent,
	isSentinelAgent,
	getSentinelModesConfig,
} from "./personas"
export type { AgentPersona, ModelPreference, HandoffOutputSchema } from "./personas"

// Handoff Context
export {
	createHandoffContext,
	validateHandoffContext,
	serializeHandoffContext,
	deserializeHandoffContext,
	getHandoffSummary,
} from "./HandoffContext"
export type {
	HandoffContext,
	ArchitectPlan,
	BuilderTestContext,
	QAAuditContext,
	SentinelAuditResult,
	PlanTask,
	TestScenario,
	VisualCheckpoint,
	TestResult,
	Vulnerability,
	DASTResult,
	FailureRecord,
	SensitiveOperation,
} from "./HandoffContext"

// Silent Interceptor
export { SilentInterceptor, getSilentInterceptor } from "./SilentInterceptor"
