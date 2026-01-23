/**
 * Sentinel Edition - Start Background Service Tool
 *
 * Launches development servers or other long-running processes in the background,
 * allowing the QA Agent to start test servers without blocking the conversation.
 *
 * Features:
 * - Spawn detached processes that survive conversation turns
 * - Poll for server readiness before returning
 * - Track PIDs for cleanup on task completion
 * - Support for custom health check endpoints
 */

import { spawn, ChildProcess } from "child_process"
import * as path from "path"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

/**
 * Parameters for starting a background service
 */
interface StartBackgroundServiceParams {
	command: string
	workingDirectory?: string
	port: number
	healthCheckPath?: string
	timeout?: number
	env?: Record<string, string>
}

/**
 * Information about a running background service
 */
export interface BackgroundServiceInfo {
	pid: number
	port: number
	command: string
	startedAt: Date
	url: string
}

/**
 * Start Background Service Tool
 *
 * Allows agents to start dev servers or other services without blocking.
 */
export class StartBackgroundServiceTool extends BaseTool<"start_background_service"> {
	readonly name = "start_background_service" as const

	/**
	 * Parse legacy XML parameters
	 */
	parseLegacy(params: Partial<Record<string, string>>): StartBackgroundServiceParams {
		return {
			command: params.command || "",
			workingDirectory: params.working_directory || params.workingDirectory,
			port: parseInt(params.port || "3000", 10),
			healthCheckPath: params.health_check_path || params.healthCheckPath || "/",
			timeout: parseInt(params.timeout || "30000", 10),
		}
	}

	/**
	 * Execute the tool
	 */
	async execute(
		params: StartBackgroundServiceParams,
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const {
			command,
			port,
			workingDirectory = task.cwd,
			healthCheckPath = "/",
			timeout = 30000,
			env = {},
		} = params

		try {
			// Validate required parameters
			if (!command) {
				task.consecutiveMistakeCount++
				task.recordToolError("start_background_service")
				pushToolResult(await task.sayAndCreateMissingParamError("start_background_service", "command"))
				return
			}

			// Auto-detect port from command if not provided
			let effectivePort = port
			if (!effectivePort || isNaN(effectivePort)) {
				// Try to detect port from common dev server commands
				const portMatch = command.match(/(?:-p|--port|PORT=)\s*(\d+)/) || 
				                  command.match(/:(\d{4,5})/)
				if (portMatch) {
					effectivePort = parseInt(portMatch[1], 10)
				} else if (command.includes("vite") || command.includes("npm run dev")) {
					effectivePort = 5173 // Default Vite port
				} else {
					effectivePort = 3000 // Fallback default
				}
				console.log(`[BackgroundService] Auto-detected port: ${effectivePort}`)
			}

			task.consecutiveMistakeCount = 0

			// Check if port is already in use by our services
			if (task.backgroundServices?.has(effectivePort)) {
				const existing = task.backgroundServices.get(effectivePort)!
				pushToolResult(
					`Port ${effectivePort} is already in use by a background service (PID: ${existing.pid}). ` +
					`Use the existing service or stop it first.`
				)
				return
			}

			// Request approval (auto-approve if in Sentinel mode)
			const approvalMessage = JSON.stringify({
				tool: "start_background_service",
				command,
				port: effectivePort,
				workingDirectory,
				timeout,
			})

			// Auto-approve for Sentinel workflow modes
			const currentMode = (await task.providerRef.deref()?.getState())?.mode ?? ""
			const isSentinelMode = currentMode.startsWith("sentinel-")
			
			let didApprove: boolean
			if (isSentinelMode) {
				await task.say("text", `🚀 **Auto-approved:** Starting background service \`${command}\` on port ${effectivePort}...`)
				didApprove = true
			} else {
				didApprove = await askApproval("tool", approvalMessage)
			}
			
			if (!didApprove) {
				return
			}

			// Show status
			await task.say(
				"text",
				`🚀 Starting background service: \`${command}\` on port ${effectivePort}...`,
			)

			// Spawn the process
			const child = this.spawnDetached(command, workingDirectory, env)

			if (!child.pid) {
				pushToolResult(formatResponse.toolError("Failed to spawn process - no PID returned"))
				return
			}

			// Store service info
			const serviceInfo: BackgroundServiceInfo = {
				pid: child.pid,
				port: effectivePort,
				command,
				startedAt: new Date(),
				url: `http://localhost:${effectivePort}`,
			}

			// Initialize backgroundServices map if needed
			if (!task.backgroundServices) {
				task.backgroundServices = new Map()
			}
			task.backgroundServices.set(effectivePort, serviceInfo)

			// Poll for readiness
			const url = `http://localhost:${effectivePort}${healthCheckPath}`
			const isReady = await this.pollForReadiness(url, timeout)

			if (isReady) {
				pushToolResult(
					`✅ Background service started successfully!\n\n` +
					`- **Command:** \`${command}\`\n` +
					`- **PID:** ${child.pid}\n` +
					`- **Port:** ${port}\n` +
					`- **URL:** ${serviceInfo.url}\n` +
					`- **Health Check:** ${url} responded OK\n\n` +
					`The server is ready for testing. Use browser_action to navigate to ${serviceInfo.url}`
				)
			} else {
				// Service started but didn't respond in time
				pushToolResult(
					`⚠️ Background service started but health check timed out.\n\n` +
					`- **Command:** \`${command}\`\n` +
					`- **PID:** ${child.pid}\n` +
					`- **Port:** ${port}\n` +
					`- **Timeout:** ${timeout}ms\n\n` +
					`The process is running but ${url} did not respond within the timeout. ` +
					`The server may still be initializing. Try navigating to the URL manually.`
				)
			}
		} catch (error) {
			await handleError("starting background service", error as Error)
		}
	}

	/**
	 * Spawn a detached process that won't block the conversation
	 */
	private spawnDetached(
		command: string,
		workingDirectory: string,
		env: Record<string, string>,
	): ChildProcess {
		// Parse command into parts
		const parts = command.split(" ")
		const cmd = parts[0]
		const args = parts.slice(1)

		// Merge with process env
		const mergedEnv = {
			...process.env,
			...env,
			// Ensure FORCE_COLOR is disabled to avoid ANSI in logs
			FORCE_COLOR: "0",
		}

		const child = spawn(cmd, args, {
			cwd: workingDirectory,
			detached: true,
			stdio: "ignore", // Don't inherit stdio
			shell: true,
			env: mergedEnv,
		})

		// Unref to allow the parent process to exit independently
		child.unref()

		return child
	}

	/**
	 * Poll a URL until it responds with 2xx status
	 */
	private async pollForReadiness(url: string, timeout: number): Promise<boolean> {
		const startTime = Date.now()
		const pollInterval = 500 // Check every 500ms

		while (Date.now() - startTime < timeout) {
			try {
				const controller = new AbortController()
				const timeoutId = setTimeout(() => controller.abort(), 2000)

				const response = await fetch(url, {
					method: "HEAD",
					signal: controller.signal,
				})

				clearTimeout(timeoutId)

				if (response.ok || response.status < 400) {
					return true
				}
			} catch {
				// Server not ready yet, continue polling
			}

			await this.delay(pollInterval)
		}

		return false
	}

	/**
	 * Simple delay helper
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * Handle partial streaming (not really applicable for this tool)
	 */
	override async handlePartial(task: Task, block: ToolUse<"start_background_service">): Promise<void> {
		const nativeArgs = block.nativeArgs as { command?: string; port?: number } | undefined
		const command = nativeArgs?.command
		const port = nativeArgs?.port

		const partialMessage = JSON.stringify({
			tool: "start_background_service",
			command: command || "(streaming...)",
			port: port || "(streaming...)",
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

/**
 * Stop a background service by port
 */
export async function stopBackgroundService(
	task: Task,
	port: number,
): Promise<{ success: boolean; message: string }> {
	if (!task.backgroundServices?.has(port)) {
		return {
			success: false,
			message: `No background service found on port ${port}`,
		}
	}

	const serviceInfo = task.backgroundServices.get(port)!

	try {
		// Kill the process
		process.kill(serviceInfo.pid)
		task.backgroundServices.delete(port)

		return {
			success: true,
			message: `Stopped background service on port ${port} (PID: ${serviceInfo.pid})`,
		}
	} catch (error) {
		// Process may have already exited
		task.backgroundServices.delete(port)

		return {
			success: true,
			message: `Background service on port ${port} was already stopped or couldn't be killed`,
		}
	}
}

/**
 * Stop all background services for a task
 */
export async function stopAllBackgroundServices(task: Task): Promise<void> {
	if (!task.backgroundServices) return

	for (const [port, serviceInfo] of task.backgroundServices) {
		try {
			process.kill(serviceInfo.pid)
			console.log(`[BackgroundService] Stopped service on port ${port} (PID: ${serviceInfo.pid})`)
		} catch {
			console.log(`[BackgroundService] Service on port ${port} was already stopped`)
		}
	}

	task.backgroundServices.clear()
}

/**
 * Singleton tool instance
 */
export const startBackgroundServiceTool = new StartBackgroundServiceTool()
