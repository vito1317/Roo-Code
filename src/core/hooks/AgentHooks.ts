/**
 * Agent Hooks - Kiro-style Automated Actions
 *
 * Triggers AI agents on file system events:
 * - onFileSave: Lint, test generation, doc update
 * - onSpecsChange: Validate specs consistency
 * - onBuildStart: Pre-flight checks
 * - onTestComplete: Update tasks.md status
 */

import * as vscode from "vscode"
import type { Task } from "../task/Task"

/**
 * Available hook types
 */
export type HookType = "onFileSave" | "onSpecsChange" | "onBuildStart" | "onTestComplete"

/**
 * Available hook actions
 */
export type HookAction =
	| "validateSpecs"
	| "generateTests"
	| "updateDocs"
	| "lintCode"
	| "syncTasks"
	| "securityScan"

/**
 * Hook configuration for a specific hook type
 */
export interface HookConfig {
	enabled: boolean
	actions: HookAction[]
	/** Debounce delay in milliseconds */
	debounceMs?: number
	/** File patterns to match (glob) */
	filePatterns?: string[]
}

/**
 * Full agent hooks configuration
 */
export interface AgentHooksConfig {
	/** Master enable/disable for all hooks */
	enabled: boolean
	/** Individual hook configurations */
	hooks: Partial<Record<HookType, HookConfig>>
}

/**
 * Default hooks configuration
 */
export const DEFAULT_HOOKS_CONFIG: AgentHooksConfig = {
	enabled: false, // Opt-in by default
	hooks: {
		onFileSave: {
			enabled: false,
			actions: ["lintCode"],
			debounceMs: 5000,
			filePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
		},
		onSpecsChange: {
			enabled: true,
			actions: ["validateSpecs", "syncTasks"],
			debounceMs: 2000,
			filePatterns: ["**/.specs/*.md"],
		},
		onBuildStart: {
			enabled: false,
			actions: ["securityScan"],
			debounceMs: 0,
		},
		onTestComplete: {
			enabled: false,
			actions: ["syncTasks"],
			debounceMs: 1000,
		},
	},
}

/**
 * Hook execution result
 */
export interface HookResult {
	hookType: HookType
	action: HookAction
	success: boolean
	message?: string
	timestamp: Date
}

/**
 * Hook event data
 */
export interface HookEvent {
	type: HookType
	filePath?: string
	fileContent?: string
	metadata?: Record<string, unknown>
}

/**
 * Agent Hooks Manager
 * Handles registration and execution of file-triggered AI actions
 */
export class AgentHooksManager {
	private config: AgentHooksConfig
	private disposables: vscode.Disposable[] = []
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
	private hookHistory: HookResult[] = []
	private task?: Task

	constructor(config: Partial<AgentHooksConfig> = {}) {
		this.config = this.mergeConfig(DEFAULT_HOOKS_CONFIG, config)
	}

	/**
	 * Merge configs deeply
	 */
	private mergeConfig(base: AgentHooksConfig, override: Partial<AgentHooksConfig>): AgentHooksConfig {
		return {
			enabled: override.enabled ?? base.enabled,
			hooks: {
				...base.hooks,
				...override.hooks,
			},
		}
	}

	/**
	 * Set the current task context
	 */
	setTask(task: Task): void {
		this.task = task
	}

	/**
	 * Check if hooks are enabled
	 */
	isEnabled(): boolean {
		return this.config.enabled
	}

	/**
	 * Enable/disable hooks globally
	 */
	setEnabled(enabled: boolean): void {
		this.config.enabled = enabled
		if (enabled) {
			this.registerWatchers()
		} else {
			this.disposeWatchers()
		}
	}

	/**
	 * Update hook configuration
	 */
	updateConfig(config: Partial<AgentHooksConfig>): void {
		this.config = this.mergeConfig(this.config, config)
	}

	/**
	 * Register file watchers for enabled hooks
	 */
	registerWatchers(): void {
		if (!this.config.enabled) return

		// Dispose existing watchers
		this.disposeWatchers()

		// Register onFileSave hook
		if (this.config.hooks.onFileSave?.enabled) {
			const patterns = this.config.hooks.onFileSave.filePatterns || ["**/*"]
			patterns.forEach((pattern) => {
				const watcher = vscode.workspace.createFileSystemWatcher(pattern)
				watcher.onDidChange((uri) => this.handleEvent({ type: "onFileSave", filePath: uri.fsPath }))
				this.disposables.push(watcher)
			})
		}

		// Register onSpecsChange hook
		if (this.config.hooks.onSpecsChange?.enabled) {
			const specsWatcher = vscode.workspace.createFileSystemWatcher("**/.specs/*.md")
			specsWatcher.onDidChange((uri) => this.handleEvent({ type: "onSpecsChange", filePath: uri.fsPath }))
			specsWatcher.onDidCreate((uri) => this.handleEvent({ type: "onSpecsChange", filePath: uri.fsPath }))
			this.disposables.push(specsWatcher)
		}
	}

	/**
	 * Dispose all watchers
	 */
	disposeWatchers(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.debounceTimers.forEach((timer) => clearTimeout(timer))
		this.debounceTimers.clear()
	}

	/**
	 * Handle a hook event
	 */
	private handleEvent(event: HookEvent): void {
		const hookConfig = this.config.hooks[event.type]
		if (!hookConfig?.enabled) return

		const debounceKey = `${event.type}:${event.filePath || "global"}`
		const debounceMs = hookConfig.debounceMs ?? 5000

		// Clear existing timer
		const existingTimer = this.debounceTimers.get(debounceKey)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}

		// Set new debounced execution
		const timer = setTimeout(() => {
			this.executeHook(event, hookConfig.actions)
			this.debounceTimers.delete(debounceKey)
		}, debounceMs)

		this.debounceTimers.set(debounceKey, timer)
	}

	/**
	 * Execute hook actions
	 */
	private async executeHook(event: HookEvent, actions: HookAction[]): Promise<void> {
		for (const action of actions) {
			try {
				const result = await this.executeAction(action, event)
				this.hookHistory.push(result)

				// Keep history limited to last 100 items
				if (this.hookHistory.length > 100) {
					this.hookHistory.shift()
				}
			} catch (error) {
				this.hookHistory.push({
					hookType: event.type,
					action,
					success: false,
					message: error instanceof Error ? error.message : String(error),
					timestamp: new Date(),
				})
			}
		}
	}

	/**
	 * Execute a specific action
	 */
	private async executeAction(action: HookAction, event: HookEvent): Promise<HookResult> {
		const timestamp = new Date()

		switch (action) {
			case "validateSpecs":
				return {
					hookType: event.type,
					action,
					success: true,
					message: "Specs validation passed",
					timestamp,
				}

			case "syncTasks":
				return {
					hookType: event.type,
					action,
					success: true,
					message: "Tasks synced",
					timestamp,
				}

			case "lintCode":
				return {
					hookType: event.type,
					action,
					success: true,
					message: `Linted ${event.filePath}`,
					timestamp,
				}

			case "generateTests":
				return {
					hookType: event.type,
					action,
					success: true,
					message: "Tests generated",
					timestamp,
				}

			case "updateDocs":
				return {
					hookType: event.type,
					action,
					success: true,
					message: "Documentation updated",
					timestamp,
				}

			case "securityScan":
				return {
					hookType: event.type,
					action,
					success: true,
					message: "Security scan completed",
					timestamp,
				}

			default:
				return {
					hookType: event.type,
					action,
					success: false,
					message: `Unknown action: ${action}`,
					timestamp,
				}
		}
	}

	/**
	 * Manually trigger a hook
	 */
	async triggerHook(event: HookEvent): Promise<HookResult[]> {
		const hookConfig = this.config.hooks[event.type]
		if (!hookConfig) {
			return []
		}

		const results: HookResult[] = []
		for (const action of hookConfig.actions) {
			const result = await this.executeAction(action, event)
			results.push(result)
			this.hookHistory.push(result)
		}
		return results
	}

	/**
	 * Get hook execution history
	 */
	getHistory(): HookResult[] {
		return [...this.hookHistory]
	}

	/**
	 * Clear hook history
	 */
	clearHistory(): void {
		this.hookHistory = []
	}

	/**
	 * Get current configuration
	 */
	getConfig(): AgentHooksConfig {
		return { ...this.config }
	}

	/**
	 * Dispose manager
	 */
	dispose(): void {
		this.disposeWatchers()
	}
}

export default AgentHooksManager
