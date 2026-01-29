/**
 * Agent Context Manager
 *
 * Manages isolated conversation contexts for different AI agents.
 * Each agent has its own conversation history, system prompt, and state.
 * This ensures context separation between parallel AI tasks.
 */

import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Represents an isolated context for a single AI agent
 */
export interface AgentContext {
	/** Unique identifier for this agent context */
	id: string
	/** Agent role/type (e.g., "ui-button", "ui-display", "layout") */
	role: string
	/** System prompt specific to this agent */
	systemPrompt: string
	/** Conversation history - completely isolated from other agents */
	messages: Anthropic.MessageParam[]
	/** Agent-specific metadata */
	metadata: {
		/** When this context was created */
		createdAt: number
		/** Last activity timestamp */
		lastActivityAt: number
		/** Number of API calls made */
		apiCallCount: number
		/** Total tokens used by this agent */
		tokenUsage: {
			input: number
			output: number
		}
		/** Task-specific data */
		taskData?: Record<string, unknown>
	}
	/** Current state of the agent */
	state: "idle" | "active" | "completed" | "failed"
	/** Results from tool calls */
	toolResults: Array<{
		toolId: string
		toolName: string
		result: unknown
		timestamp: number
	}>
}

/**
 * Configuration for creating a new agent context
 */
export interface AgentContextConfig {
	/** Agent role/type */
	role: string
	/** Custom system prompt (optional - will use default based on role) */
	systemPrompt?: string
	/** Initial task data */
	taskData?: Record<string, unknown>
}

/**
 * Manager for isolated AI agent contexts
 * Ensures each agent operates with its own conversation history
 */
export class AgentContextManager {
	private contexts: Map<string, AgentContext> = new Map()
	private static instance: AgentContextManager | null = null

	/** Default system prompts for different agent roles */
	private static readonly DEFAULT_SYSTEM_PROMPTS: Record<string, string> = {
		"ui-button": `You are a UI button designer. You create individual button elements in Figma.
Your job is to create ONE button with the exact specifications provided.
Always follow the tool call sequence: create_rectangle → add_text → set_text_color.
Use the exact coordinates, colors, and parameters given to you.`,

		"ui-display": `You are a UI display designer. You create display/screen elements in Figma.
Your job is to create display areas that show information like numbers, text, or results.
Always follow the tool call sequence: create_rectangle → add_text → set_text_color.
Make display elements visually distinct from buttons.`,

		"ui-layout": `You are a UI layout specialist. You arrange and organize UI elements in Figma.
Your job is to position elements according to the specified layout (grid, row, column).
Use move_node to reposition elements to their correct locations.`,

		"ui-frame": `You are a UI frame creator. You create container frames in Figma.
Your job is to create frames that hold other UI elements.
Use create_frame with the specified dimensions and colors.`,

		default: `You are a Figma UI designer assistant. Create UI elements as instructed.
Follow the exact specifications provided for positions, colors, and dimensions.`,
	}

	private constructor() {}

	/**
	 * Get the singleton instance
	 */
	static getInstance(): AgentContextManager {
		if (!AgentContextManager.instance) {
			AgentContextManager.instance = new AgentContextManager()
		}
		return AgentContextManager.instance
	}

	/**
	 * Create a new isolated agent context
	 * @param config Configuration for the new agent
	 * @returns The created agent context
	 */
	createContext(config: AgentContextConfig): AgentContext {
		const id = `agent-${config.role}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

		const systemPrompt =
			config.systemPrompt ||
			AgentContextManager.DEFAULT_SYSTEM_PROMPTS[config.role] ||
			AgentContextManager.DEFAULT_SYSTEM_PROMPTS.default

		const context: AgentContext = {
			id,
			role: config.role,
			systemPrompt,
			messages: [], // Start with empty conversation history
			metadata: {
				createdAt: Date.now(),
				lastActivityAt: Date.now(),
				apiCallCount: 0,
				tokenUsage: { input: 0, output: 0 },
				taskData: config.taskData,
			},
			state: "idle",
			toolResults: [],
		}

		this.contexts.set(id, context)
		console.log(`[AgentContextManager] Created new context: ${id} (role: ${config.role})`)

		return context
	}

	/**
	 * Get an existing context by ID
	 */
	getContext(id: string): AgentContext | undefined {
		return this.contexts.get(id)
	}

	/**
	 * Add a message to an agent's conversation history
	 * This maintains context isolation - messages are only added to the specified agent
	 */
	addMessage(contextId: string, message: Anthropic.MessageParam): void {
		const context = this.contexts.get(contextId)
		if (!context) {
			console.warn(`[AgentContextManager] Context not found: ${contextId}`)
			return
		}

		context.messages.push(message)
		context.metadata.lastActivityAt = Date.now()

		console.log(
			`[AgentContextManager] Added ${message.role} message to ${contextId} (total: ${context.messages.length})`,
		)
	}

	/**
	 * Add an assistant message with tool use to the context
	 */
	addAssistantMessage(contextId: string, content: Anthropic.ContentBlock[]): void {
		this.addMessage(contextId, { role: "assistant", content })
	}

	/**
	 * Add a user message (typically tool results) to the context
	 */
	addUserMessage(contextId: string, content: string | Anthropic.ContentBlockParam[]): void {
		this.addMessage(contextId, { role: "user", content })
	}

	/**
	 * Record a tool result for the agent
	 */
	recordToolResult(contextId: string, toolId: string, toolName: string, result: unknown): void {
		const context = this.contexts.get(contextId)
		if (!context) return

		context.toolResults.push({
			toolId,
			toolName,
			result,
			timestamp: Date.now(),
		})
	}

	/**
	 * Update token usage for an agent
	 */
	updateTokenUsage(contextId: string, inputTokens: number, outputTokens: number): void {
		const context = this.contexts.get(contextId)
		if (!context) return

		context.metadata.tokenUsage.input += inputTokens
		context.metadata.tokenUsage.output += outputTokens
		context.metadata.apiCallCount++
	}

	/**
	 * Set the state of an agent
	 */
	setState(contextId: string, state: AgentContext["state"]): void {
		const context = this.contexts.get(contextId)
		if (!context) return

		context.state = state
		context.metadata.lastActivityAt = Date.now()
		console.log(`[AgentContextManager] Context ${contextId} state changed to: ${state}`)
	}

	/**
	 * Get the messages for an agent (for API calls)
	 * Returns a copy to prevent external modification
	 */
	getMessages(contextId: string): Anthropic.MessageParam[] {
		const context = this.contexts.get(contextId)
		if (!context) return []

		return [...context.messages]
	}

	/**
	 * Get the system prompt for an agent
	 */
	getSystemPrompt(contextId: string): string {
		const context = this.contexts.get(contextId)
		return context?.systemPrompt || AgentContextManager.DEFAULT_SYSTEM_PROMPTS.default
	}

	/**
	 * Clear all messages from an agent's context (start fresh)
	 */
	clearMessages(contextId: string): void {
		const context = this.contexts.get(contextId)
		if (!context) return

		context.messages = []
		console.log(`[AgentContextManager] Cleared messages for context: ${contextId}`)
	}

	/**
	 * Delete a context entirely
	 */
	deleteContext(contextId: string): boolean {
		const deleted = this.contexts.delete(contextId)
		if (deleted) {
			console.log(`[AgentContextManager] Deleted context: ${contextId}`)
		}
		return deleted
	}

	/**
	 * Delete all contexts (cleanup)
	 */
	deleteAllContexts(): void {
		const count = this.contexts.size
		this.contexts.clear()
		console.log(`[AgentContextManager] Deleted all ${count} contexts`)
	}

	/**
	 * Get all active contexts
	 */
	getActiveContexts(): AgentContext[] {
		return Array.from(this.contexts.values()).filter((c) => c.state === "active")
	}

	/**
	 * Get statistics about all managed contexts
	 */
	getStats(): {
		totalContexts: number
		activeContexts: number
		totalApiCalls: number
		totalTokens: { input: number; output: number }
	} {
		let totalApiCalls = 0
		let totalInputTokens = 0
		let totalOutputTokens = 0
		let activeCount = 0

		for (const context of this.contexts.values()) {
			totalApiCalls += context.metadata.apiCallCount
			totalInputTokens += context.metadata.tokenUsage.input
			totalOutputTokens += context.metadata.tokenUsage.output
			if (context.state === "active") activeCount++
		}

		return {
			totalContexts: this.contexts.size,
			activeContexts: activeCount,
			totalApiCalls,
			totalTokens: { input: totalInputTokens, output: totalOutputTokens },
		}
	}

	/**
	 * Cleanup old/inactive contexts (call periodically to prevent memory leaks)
	 * @param maxAgeMs Maximum age in milliseconds for inactive contexts
	 */
	cleanupStaleContexts(maxAgeMs: number = 30 * 60 * 1000): number {
		const now = Date.now()
		let deletedCount = 0

		for (const [id, context] of this.contexts) {
			const age = now - context.metadata.lastActivityAt
			const isStale = age > maxAgeMs && (context.state === "completed" || context.state === "failed")

			if (isStale) {
				this.contexts.delete(id)
				deletedCount++
			}
		}

		if (deletedCount > 0) {
			console.log(`[AgentContextManager] Cleaned up ${deletedCount} stale contexts`)
		}

		return deletedCount
	}
}

// Export singleton getter for convenience
export const getAgentContextManager = AgentContextManager.getInstance
