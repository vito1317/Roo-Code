/**
 * Agent Visualization Types
 * Types for the Sentinel Agent orchestration dashboard
 */

/**
 * Sentinel agent types in the workflow pipeline
 */
export type SentinelAgentType = "architect" | "designer" | "builder" | "qa" | "sentinel"

/**
 * Agent state in the workflow
 */
export type AgentStateStatus = "idle" | "active" | "completed" | "error"

/**
 * Tool call status
 */
export type ToolCallStatus = "pending" | "running" | "success" | "error"

/**
 * Information about a single tool call
 */
export interface ToolCallInfo {
	id: string
	toolName: string
	params: Record<string, unknown>
	status: ToolCallStatus
	startTime: number
	endTime?: number
	result?: string
	error?: string
}

/**
 * Complete agent visualization state for the dashboard
 */
export interface AgentVisualizationState {
	/** Currently active agent */
	currentAgent: SentinelAgentType | null
	/** State of each agent in the pipeline */
	agentStates: Record<SentinelAgentType, AgentStateStatus>
	/** Recent tool calls for the activity feed */
	toolCalls: ToolCallInfo[]
	/** Current task description */
	currentTask: string
	/** Progress percentage (0-100) */
	progress: number
	/** Files read during session */
	filesRead: number
	/** Files written during session */
	filesWritten: number
	/** Total tools used */
	toolsUsed: number
}

/**
 * Create initial agent visualization state
 */
export function createInitialAgentVisualizationState(): AgentVisualizationState {
	return {
		currentAgent: null,
		agentStates: {
			architect: "idle",
			designer: "idle",
			builder: "idle",
			qa: "idle",
			sentinel: "idle",
		},
		toolCalls: [],
		currentTask: "",
		progress: 0,
		filesRead: 0,
		filesWritten: 0,
		toolsUsed: 0,
	}
}
