/**
 * Task Executor - Kiro-style Spec Mode
 *
 * Enables step-by-step execution of tasks from tasks.md:
 * - Read tasks from specs
 * - Execute one task at a time
 * - Update status automatically
 * - Track progress across agent handoffs
 */

import { SpecsManager, type TaskItem, type TasksSpec } from "../specs/SpecsManager"

/**
 * Execution mode for tasks
 */
export type ExecutionMode = "auto" | "step" | "manual"

/**
 * Task execution state
 */
export interface TaskExecutionState {
	/** Current task being executed */
	currentTaskId: string | null
	/** Execution mode */
	mode: ExecutionMode
	/** Completed task IDs */
	completedTasks: string[]
	/** Failed task IDs */
	failedTasks: string[]
	/** Skipped task IDs */
	skippedTasks: string[]
	/** Execution start time */
	startedAt?: Date
	/** Last update time */
	updatedAt?: Date
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
	taskId: string
	success: boolean
	message?: string
	duration?: number
	output?: string
	error?: string
}

/**
 * Task Executor class
 * Manages step-by-step execution of tasks from tasks.md
 */
export class TaskExecutor {
	private specsManager: SpecsManager
	private state: TaskExecutionState
	private onTaskStart?: (task: TaskItem) => void
	private onTaskComplete?: (result: TaskExecutionResult) => void
	private onAllComplete?: () => void

	constructor(specsManager: SpecsManager) {
		this.specsManager = specsManager
		this.state = {
			currentTaskId: null,
			mode: "step", // Default to step-by-step mode (Kiro style)
			completedTasks: [],
			failedTasks: [],
			skippedTasks: [],
		}
	}

	/**
	 * Set execution mode
	 */
	setMode(mode: ExecutionMode): void {
		this.state.mode = mode
	}

	/**
	 * Get current execution state
	 */
	getState(): TaskExecutionState {
		return { ...this.state }
	}

	/**
	 * Register callbacks
	 */
	onEvents(handlers: {
		onTaskStart?: (task: TaskItem) => void
		onTaskComplete?: (result: TaskExecutionResult) => void
		onAllComplete?: () => void
	}): void {
		this.onTaskStart = handlers.onTaskStart
		this.onTaskComplete = handlers.onTaskComplete
		this.onAllComplete = handlers.onAllComplete
	}

	/**
	 * Load tasks from specs
	 */
	async loadTasks(): Promise<TaskItem[]> {
		const specs = await this.specsManager.readAllSpecs()
		return specs.tasks?.tasks || []
	}

	/**
	 * Get next pending task (respecting dependencies)
	 */
	async getNextTask(): Promise<TaskItem | null> {
		const tasks = await this.loadTasks()

		for (const task of tasks) {
			// Skip completed, failed, or skipped tasks
			if (
				this.state.completedTasks.includes(task.id) ||
				this.state.failedTasks.includes(task.id) ||
				this.state.skippedTasks.includes(task.id)
			) {
				continue
			}

			// Skip if currently in progress
			if (task.status === "in-progress" && this.state.currentTaskId !== task.id) {
				continue
			}

			// Check dependencies
			if (task.dependencies && task.dependencies.length > 0) {
				const allDepsComplete = task.dependencies.every((depId) =>
					this.state.completedTasks.includes(depId)
				)
				if (!allDepsComplete) {
					continue
				}
			}

			// Found a task ready to execute
			return task
		}

		return null
	}

	/**
	 * Start executing from a specific task
	 */
	async startFromTask(taskId: string): Promise<boolean> {
		const tasks = await this.loadTasks()
		const task = tasks.find((t) => t.id === taskId)

		if (!task) {
			return false
		}

		this.state.currentTaskId = taskId
		this.state.startedAt = new Date()
		this.state.updatedAt = new Date()

		// Update task status in tasks.md
		await this.specsManager.updateTaskStatus(taskId, "in-progress")

		// Trigger callback
		this.onTaskStart?.(task)

		return true
	}

	/**
	 * Start executing from the first pending task
	 */
	async start(): Promise<boolean> {
		const nextTask = await this.getNextTask()
		if (!nextTask) {
			return false
		}
		return this.startFromTask(nextTask.id)
	}

	/**
	 * Mark current task as complete and move to next
	 */
	async completeCurrentTask(result: Omit<TaskExecutionResult, "taskId">): Promise<TaskItem | null> {
		if (!this.state.currentTaskId) {
			return null
		}

		const taskId = this.state.currentTaskId
		const fullResult: TaskExecutionResult = { taskId, ...result }

		if (result.success) {
			this.state.completedTasks.push(taskId)
			await this.specsManager.updateTaskStatus(taskId, "done")
		} else {
			this.state.failedTasks.push(taskId)
			// Keep as in-progress if failed (needs retry)
		}

		this.state.updatedAt = new Date()
		this.onTaskComplete?.(fullResult)

		// Move to next task if in auto mode
		if (this.state.mode === "auto") {
			const nextTask = await this.getNextTask()
			if (nextTask) {
				await this.startFromTask(nextTask.id)
				return nextTask
			}
		}

		this.state.currentTaskId = null

		// Check if all tasks complete
		const allTasks = await this.loadTasks()
		const pendingTasks = allTasks.filter(
			(t) =>
				!this.state.completedTasks.includes(t.id) &&
				!this.state.skippedTasks.includes(t.id)
		)

		if (pendingTasks.length === 0) {
			this.onAllComplete?.()
		}

		return null
	}

	/**
	 * Skip current task
	 */
	async skipCurrentTask(reason?: string): Promise<TaskItem | null> {
		if (!this.state.currentTaskId) {
			return null
		}

		const taskId = this.state.currentTaskId
		this.state.skippedTasks.push(taskId)
		this.state.currentTaskId = null
		this.state.updatedAt = new Date()

		// Don't update task status for skipped (leave as todo)

		// Move to next task
		const nextTask = await this.getNextTask()
		if (nextTask && this.state.mode !== "manual") {
			await this.startFromTask(nextTask.id)
			return nextTask
		}

		return null
	}

	/**
	 * Retry a failed task
	 */
	async retryTask(taskId: string): Promise<boolean> {
		const failedIndex = this.state.failedTasks.indexOf(taskId)
		if (failedIndex === -1) {
			return false
		}

		this.state.failedTasks.splice(failedIndex, 1)
		return this.startFromTask(taskId)
	}

	/**
	 * Get execution progress
	 */
	async getProgress(): Promise<{
		total: number
		completed: number
		failed: number
		skipped: number
		pending: number
		percentage: number
	}> {
		const tasks = await this.loadTasks()
		const total = tasks.length
		const completed = this.state.completedTasks.length
		const failed = this.state.failedTasks.length
		const skipped = this.state.skippedTasks.length
		const pending = total - completed - failed - skipped

		return {
			total,
			completed,
			failed,
			skipped,
			pending,
			percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
		}
	}

	/**
	 * Get current task details
	 */
	async getCurrentTask(): Promise<TaskItem | null> {
		if (!this.state.currentTaskId) {
			return null
		}

		const tasks = await this.loadTasks()
		return tasks.find((t) => t.id === this.state.currentTaskId) || null
	}

	/**
	 * Generate handoff context for agent transition
	 */
	async generateHandoffForCurrentTask(): Promise<Record<string, unknown> | null> {
		const currentTask = await this.getCurrentTask()
		if (!currentTask) {
			return null
		}

		const progress = await this.getProgress()

		return {
			specMode: true,
			currentTask: {
				id: currentTask.id,
				title: currentTask.title,
				description: currentTask.description,
				acceptanceCriteria: currentTask.acceptanceCriteria,
				complexity: currentTask.complexity,
				assignedAgent: currentTask.assignedAgent,
			},
			progress: {
				completed: progress.completed,
				total: progress.total,
				percentage: progress.percentage,
			},
			completedTasks: this.state.completedTasks,
			dependencies: currentTask.dependencies || [],
		}
	}

	/**
	 * Reset execution state
	 */
	reset(): void {
		this.state = {
			currentTaskId: null,
			mode: this.state.mode,
			completedTasks: [],
			failedTasks: [],
			skippedTasks: [],
		}
	}

	/**
	 * Sync state from tasks.md (useful after external edits)
	 */
	async syncFromSpecs(): Promise<void> {
		const tasks = await this.loadTasks()

		// Reset and rebuild state from task statuses
		this.state.completedTasks = tasks.filter((t) => t.status === "done").map((t) => t.id)

		const inProgressTask = tasks.find((t) => t.status === "in-progress")
		if (inProgressTask) {
			this.state.currentTaskId = inProgressTask.id
		}

		this.state.updatedAt = new Date()
	}

	/**
	 * Execute a task with the full Sentinel FSM pipeline
	 * This routes the task through: Architect → Designer → Review → Builder → QA → Sentinel → Final
	 */
	async executeWithSentinelPipeline(
		taskId: string,
		getSentinelFSM: () => import("../sentinel/StateMachine").SentinelStateMachine | undefined,
		createFSM: () => Promise<import("../sentinel/StateMachine").SentinelStateMachine>,
	): Promise<TaskExecutionResult> {
		const tasks = await this.loadTasks()
		const task = tasks.find((t) => t.id === taskId)

		if (!task) {
			return { taskId, success: false, error: "Task not found" }
		}

		// Start the task
		await this.startFromTask(taskId)

		// Get or create FSM
		let fsm = getSentinelFSM()
		if (!fsm) {
			fsm = await createFSM()
		} else {
			fsm.reset()
		}

		// Build SpecTaskContext from task
		const complexityMap: Record<string, number> = { low: 1, medium: 3, high: 5 }
		const specTaskContext: import("../sentinel/HandoffContext").SpecTaskContext = {
			taskId: task.id,
			title: task.title,
			description: task.description,
			acceptanceCriteria: task.acceptanceCriteria,
			complexity: task.complexity ? complexityMap[task.complexity] || 3 : undefined,
			specFile: ".specs/tasks.md",
			dependencies: task.dependencies,
		}

		// Set up completion callback for auto-advance
		fsm.setOnSpecTaskComplete(async (result) => {
			console.log(`[TaskExecutor] FSM completed for task ${result.taskId}, success: ${result.success}`)
			
			// Complete the current task
			const nextTask = await this.completeCurrentTask({
				success: result.success,
				message: result.success ? "Task completed via Sentinel pipeline" : "Task failed in pipeline",
			})

			// Auto-advance is handled by completeCurrentTask when in auto mode
			if (nextTask && this.state.mode === "auto") {
				console.log(`[TaskExecutor] Auto-advancing to next task: ${nextTask.id}`)
			}
		})

		// Start the FSM with task context
		const startResult = await fsm.startFromSpecTask(specTaskContext)

		if (!startResult.success) {
			return {
				taskId,
				success: false,
				error: startResult.error || "Failed to start FSM",
			}
		}

		// Return immediately - FSM will call the completion callback when done
		return {
			taskId,
			success: true,
			message: "Task started with Sentinel pipeline (Architect → Designer → Builder → QA → Sentinel)",
		}
	}

	/**
	 * Run all remaining tasks in sequence with Sentinel pipeline
	 */
	async runAllWithPipeline(
		getSentinelFSM: () => import("../sentinel/StateMachine").SentinelStateMachine | undefined,
		createFSM: () => Promise<import("../sentinel/StateMachine").SentinelStateMachine>,
	): Promise<{ started: number; total: number }> {
		// Set to auto mode to automatically advance
		this.setMode("auto")

		const nextTask = await this.getNextTask()
		if (!nextTask) {
			const progress = await this.getProgress()
			return { started: 0, total: progress.total }
		}

		// Start the first task - subsequent tasks will be auto-started via completion callback
		await this.executeWithSentinelPipeline(nextTask.id, getSentinelFSM, createFSM)

		const progress = await this.getProgress()
		return { started: 1, total: progress.total }
	}
}

export default TaskExecutor

