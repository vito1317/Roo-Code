import * as fs from "fs/promises"
import * as path from "path"
import { exec, spawn, ChildProcess } from "child_process"
import { promisify } from "util"

import * as vscode from "vscode"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import ReconnectingEventSource from "reconnecting-eventsource"
import {
	CallToolResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
	ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
import chokidar, { FSWatcher } from "chokidar"
import delay from "delay"
import deepEqual from "fast-deep-equal"
import { z } from "zod"

import type {
	McpResource,
	McpResourceResponse,
	McpResourceTemplate,
	McpServer,
	McpTool,
	McpToolCallResponse,
} from "@roo-code/types"

import { t } from "../../i18n"

import { ClineProvider } from "../../core/webview/ClineProvider"

import { GlobalFileNames } from "../../shared/globalFileNames"

import { fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual, getWorkspacePath } from "../../utils/path"
import { injectVariables } from "../../utils/config"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { sanitizeMcpName } from "../../utils/mcp-name"

const execAsync = promisify(exec)

/**
 * Kill any process using a specific port.
 * This is useful for cleaning up orphaned WebSocket servers that might
 * still be holding the port when the MCP server process was killed abruptly.
 *
 * @param port - The port number to free
 * @returns Promise<boolean> - True if port was freed or already free, false on error
 */
async function killProcessOnPort(port: number): Promise<boolean> {
	const platform = process.platform

	try {
		if (platform === "darwin" || platform === "linux") {
			// Find PIDs using the port
			const { stdout } = await execAsync(`lsof -ti :${port} 2>/dev/null || true`)
			const pids = stdout
				.trim()
				.split("\n")
				.filter((pid) => pid)
			if (pids.length > 0) {
				console.log(`[McpHub] Found processes using port ${port}: ${pids.join(", ")}`)
				for (const pid of pids) {
					try {
						await execAsync(`kill -9 ${pid}`)
						console.log(`[McpHub] Killed process ${pid}`)
					} catch (killError) {
						console.log(`[McpHub] Could not kill process ${pid}:`, killError)
					}
				}
				// Wait a bit for the port to be released
				await new Promise((resolve) => setTimeout(resolve, 500))
			}
			return true
		} else if (platform === "win32") {
			// Windows: find and kill processes using the port
			try {
				const { stdout } = await execAsync(`netstat -ano | findstr :${port}`)
				const lines = stdout.trim().split("\n")
				const pids = new Set<string>()
				for (const line of lines) {
					const parts = line.trim().split(/\s+/)
					const pid = parts[parts.length - 1]
					if (pid && /^\d+$/.test(pid)) {
						pids.add(pid)
					}
				}
				for (const pid of pids) {
					try {
						await execAsync(`taskkill /F /PID ${pid}`)
						console.log(`[McpHub] Killed process ${pid}`)
					} catch {
						// Process might have already exited
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 500))
			} catch {
				// No process found on port - that's OK
			}
			return true
		}
		return true
	} catch (error) {
		console.error(`[McpHub] Error killing process on port ${port}:`, error)
		return false
	}
}

// Discriminated union for connection states
export type ConnectedMcpConnection = {
	type: "connected"
	server: McpServer
	client: Client
	transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
}

export type DisconnectedMcpConnection = {
	type: "disconnected"
	server: McpServer
	client: null
	transport: null
}

export type McpConnection = ConnectedMcpConnection | DisconnectedMcpConnection

// Enum for disable reasons
export enum DisableReason {
	MCP_DISABLED = "mcpDisabled",
	SERVER_DISABLED = "serverDisabled",
}

// Base configuration schema for common settings
const BaseConfigSchema = z.object({
	disabled: z.boolean().optional(),
	timeout: z.number().min(1).max(3600).optional().default(60),
	alwaysAllow: z.array(z.string()).default([]),
	watchPaths: z.array(z.string()).optional(), // paths to watch for changes and restart server
	disabledTools: z.array(z.string()).default([]),
})

// Custom error messages for better user feedback
const typeErrorMessage = "Server type must be 'stdio', 'sse', or 'streamable-http'"
const stdioFieldsErrorMessage =
	"For 'stdio' type servers, you must provide a 'command' field and can optionally include 'args' and 'env'"
const sseFieldsErrorMessage =
	"For 'sse' type servers, you must provide a 'url' field and can optionally include 'headers'"
const streamableHttpFieldsErrorMessage =
	"For 'streamable-http' type servers, you must provide a 'url' field and can optionally include 'headers'"
const mixedFieldsErrorMessage =
	"Cannot mix 'stdio' and ('sse' or 'streamable-http') fields. For 'stdio' use 'command', 'args', and 'env'. For 'sse'/'streamable-http' use 'url' and 'headers'"
const missingFieldsErrorMessage =
	"Server configuration must include either 'command' (for stdio) or 'url' (for sse/streamable-http) and a corresponding 'type' if 'url' is used."

// Helper function to create a refined schema with better error messages
const createServerTypeSchema = () => {
	return z.union([
		// Stdio config (has command field)
		BaseConfigSchema.extend({
			type: z.enum(["stdio"]).optional(),
			command: z.string().min(1, "Command cannot be empty"),
			args: z.array(z.string()).optional(),
			cwd: z.string().default(() => vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath ?? process.cwd()),
			env: z.record(z.string()).optional(),
			// Ensure no SSE fields are present
			url: z.undefined().optional(),
			headers: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "stdio" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "stdio", { message: typeErrorMessage }),
		// SSE config (has url field)
		BaseConfigSchema.extend({
			type: z.enum(["sse"]).optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			// Ensure no stdio fields are present
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "sse" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "sse", { message: typeErrorMessage }),
		// StreamableHTTP config (has url field)
		BaseConfigSchema.extend({
			type: z.enum(["streamable-http"]).optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			// Ensure no stdio fields are present
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "streamable-http" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "streamable-http", {
				message: typeErrorMessage,
			}),
	])
}

// Server configuration schema with automatic type inference and validation
export const ServerConfigSchema = createServerTypeSchema()

// Settings schema
const McpSettingsSchema = z.object({
	mcpServers: z.record(ServerConfigSchema),
})

export class McpHub {
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private settingsWatcher?: vscode.FileSystemWatcher
	private fileWatchers: Map<string, FSWatcher[]> = new Map()
	private projectMcpWatcher?: vscode.FileSystemWatcher
	private isDisposed: boolean = false
	connections: McpConnection[] = []
	isConnecting: boolean = false
	private refCount: number = 0 // Reference counter for active clients
	private configChangeDebounceTimers: Map<string, NodeJS.Timeout> = new Map()
	private isProgrammaticUpdate: boolean = false
	private flagResetTimer?: NodeJS.Timeout
	private sanitizedNameRegistry: Map<string, string> = new Map()
	// Auto-reconnect tracking
	private reconnectAttempts: Map<string, number> = new Map()
	private reconnectTimers: Map<string, NodeJS.Timeout> = new Map()
	private static readonly MAX_RECONNECT_DELAY = 8000 // 8 seconds max delay
	private static readonly BASE_RECONNECT_DELAY = 1000 // 1 second base delay
	// Figma preview auto-open tracking (per session)
	private figmaPreviewAutoOpened: boolean = false

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.watchMcpSettingsFile()
		this.watchProjectMcpFile().catch(console.error)
		this.setupWorkspaceFoldersWatcher()
		this.initializeGlobalMcpServers()
		this.initializeProjectMcpServers()
		this.initializeBuiltInFigmaWriteServer(provider)
		this.initializeBuiltInTalkToFigmaServer()
		this.initializeBuiltInPenpotServer()
		this.initializeBuiltInUIDesignCanvasServer()
		this.initializeBuiltInMcpUiServer()
	}
	/**
	 * Registers a client (e.g., ClineProvider) using this hub.
	 * Increments the reference count.
	 */
	public registerClient(): void {
		this.refCount++
		// console.log(`McpHub: Client registered. Ref count: ${this.refCount}`)
	}

	/**
	 * Unregisters a client. Decrements the reference count.
	 * If the count reaches zero, disposes the hub.
	 */
	public async unregisterClient(): Promise<void> {
		this.refCount--

		// console.log(`McpHub: Client unregistered. Ref count: ${this.refCount}`)

		if (this.refCount <= 0) {
			console.log("McpHub: Last client unregistered. Disposing hub.")
			await this.dispose()
		}
	}

	/**
	 * Validates and normalizes server configuration
	 * @param config The server configuration to validate
	 * @param serverName Optional server name for error messages
	 * @returns The validated configuration
	 * @throws Error if the configuration is invalid
	 */
	private validateServerConfig(config: any, serverName?: string): z.infer<typeof ServerConfigSchema> {
		// Detect configuration issues before validation
		const hasStdioFields = config.command !== undefined
		const hasUrlFields = config.url !== undefined // Covers sse and streamable-http

		// Check for mixed fields (stdio vs url-based)
		if (hasStdioFields && hasUrlFields) {
			throw new Error(mixedFieldsErrorMessage)
		}

		// Infer type for stdio if not provided
		if (!config.type && hasStdioFields) {
			config.type = "stdio"
		}

		// For url-based configs, type must be provided by the user
		if (hasUrlFields && !config.type) {
			throw new Error("Configuration with 'url' must explicitly specify 'type' as 'sse' or 'streamable-http'.")
		}

		// Validate type if provided
		if (config.type && !["stdio", "sse", "streamable-http"].includes(config.type)) {
			throw new Error(typeErrorMessage)
		}

		// Check for type/field mismatch
		if (config.type === "stdio" && !hasStdioFields) {
			throw new Error(stdioFieldsErrorMessage)
		}
		if (config.type === "sse" && !hasUrlFields) {
			throw new Error(sseFieldsErrorMessage)
		}
		if (config.type === "streamable-http" && !hasUrlFields) {
			throw new Error(streamableHttpFieldsErrorMessage)
		}

		// If neither command nor url is present (type alone is not enough)
		if (!hasStdioFields && !hasUrlFields) {
			throw new Error(missingFieldsErrorMessage)
		}

		// Validate the config against the schema
		try {
			return ServerConfigSchema.parse(config)
		} catch (validationError) {
			if (validationError instanceof z.ZodError) {
				// Extract and format validation errors
				const errorMessages = validationError.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("; ")
				throw new Error(
					serverName
						? `Invalid configuration for server "${serverName}": ${errorMessages}`
						: `Invalid server configuration: ${errorMessages}`,
				)
			}
			throw validationError
		}
	}

	/**
	 * Formats and displays error messages to the user
	 * @param message The error message prefix
	 * @param error The error object
	 */
	private showErrorMessage(message: string, error: unknown): void {
		console.error(`${message}:`, error)
	}

	public setupWorkspaceFoldersWatcher(): void {
		// Skip if test environment is detected
		if (process.env.NODE_ENV === "test") {
			return
		}

		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(async () => {
				await this.updateProjectMcpServers()
				await this.watchProjectMcpFile()
			}),
		)
	}

	/**
	 * Debounced wrapper for handling config file changes
	 */
	private debounceConfigChange(filePath: string, source: "global" | "project"): void {
		// Skip processing if this is a programmatic update to prevent unnecessary server restarts
		if (this.isProgrammaticUpdate) {
			return
		}

		const key = `${source}-${filePath}`

		// Clear existing timer if any
		const existingTimer = this.configChangeDebounceTimers.get(key)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}

		// Set new timer
		const timer = setTimeout(async () => {
			this.configChangeDebounceTimers.delete(key)
			await this.handleConfigFileChange(filePath, source)
		}, 500) // 500ms debounce

		this.configChangeDebounceTimers.set(key, timer)
	}

	private async handleConfigFileChange(filePath: string, source: "global" | "project"): Promise<void> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			let config: any

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, parseError)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			const result = McpSettingsSchema.safeParse(config)

			if (!result.success) {
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))
				return
			}

			await this.updateServerConnections(result.data.mcpServers || {}, source)
		} catch (error) {
			// Check if the error is because the file doesn't exist
			if (error.code === "ENOENT" && source === "project") {
				// File was deleted, clean up project MCP servers
				await this.cleanupProjectMcpServers()
				await this.notifyWebviewOfServerChanges()
				vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
			} else {
				this.showErrorMessage(t("mcp:errors.failed_update_project"), error)
			}
		}
	}

	private async watchProjectMcpFile(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		// Clean up existing project MCP watcher if it exists
		if (this.projectMcpWatcher) {
			this.projectMcpWatcher.dispose()
			this.projectMcpWatcher = undefined
		}

		if (!vscode.workspace.workspaceFolders?.length) {
			return
		}

		const workspaceFolder = this.providerRef.deref()?.cwd ?? getWorkspacePath()
		const projectMcpPattern = new vscode.RelativePattern(workspaceFolder, ".roo/mcp.json")

		// Create a file system watcher for the project MCP file pattern
		this.projectMcpWatcher = vscode.workspace.createFileSystemWatcher(projectMcpPattern)

		// Watch for file changes
		const changeDisposable = this.projectMcpWatcher.onDidChange((uri) => {
			this.debounceConfigChange(uri.fsPath, "project")
		})

		// Watch for file creation
		const createDisposable = this.projectMcpWatcher.onDidCreate((uri) => {
			this.debounceConfigChange(uri.fsPath, "project")
		})

		// Watch for file deletion
		const deleteDisposable = this.projectMcpWatcher.onDidDelete(async () => {
			// Clean up all project MCP servers when the file is deleted
			await this.cleanupProjectMcpServers()
			await this.notifyWebviewOfServerChanges()
			vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
		})

		this.disposables.push(
			vscode.Disposable.from(changeDisposable, createDisposable, deleteDisposable, this.projectMcpWatcher),
		)
	}

	private async updateProjectMcpServers(): Promise<void> {
		try {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) return

			const content = await fs.readFile(projectMcpPath, "utf-8")
			let config: any

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, parseError)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			// Validate configuration structure
			const result = McpSettingsSchema.safeParse(config)
			if (result.success) {
				await this.updateServerConnections(result.data.mcpServers || {}, "project")
			} else {
				// Format validation errors for better user feedback
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				console.error("Invalid project MCP settings format:", errorMessages)
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))
			}
		} catch (error) {
			this.showErrorMessage(t("mcp:errors.failed_update_project"), error)
		}
	}

	private async cleanupProjectMcpServers(): Promise<void> {
		// Disconnect and remove all project MCP servers
		const projectConnections = this.connections.filter((conn) => conn.server.source === "project")

		for (const conn of projectConnections) {
			await this.deleteConnection(conn.server.name, "project")
		}

		// Clear project servers from the connections list
		await this.updateServerConnections({}, "project", false)
	}

	getServers(): McpServer[] {
		// Only return enabled servers, deduplicating by name with project servers taking priority
		const enabledConnections = this.connections.filter((conn) => !conn.server.disabled)

		// Deduplicate by server name: project servers take priority over global servers
		const serversByName = new Map<string, McpServer>()
		for (const conn of enabledConnections) {
			const existing = serversByName.get(conn.server.name)
			if (!existing) {
				serversByName.set(conn.server.name, conn.server)
			} else if (conn.server.source === "project" && existing.source !== "project") {
				// Project server overrides global server with the same name
				serversByName.set(conn.server.name, conn.server)
			}
			// If existing is project and current is global, keep existing (project wins)
		}

		return Array.from(serversByName.values())
	}

	getAllServers(): McpServer[] {
		// Return all servers regardless of state
		return this.connections.map((conn) => conn.server)
	}

	async getMcpServersPath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpServersPath = await provider.ensureMcpServersDirectoryExists()
		return mcpServersPath
	}

	async getMcpSettingsFilePath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpSettingsFilePath = path.join(
			await provider.ensureSettingsDirectoryExists(),
			GlobalFileNames.mcpSettings,
		)
		const fileExists = await fileExistsAtPath(mcpSettingsFilePath)
		if (!fileExists) {
			await fs.writeFile(
				mcpSettingsFilePath,
				`{
  "mcpServers": {

  }
}`,
			)
		}
		return mcpSettingsFilePath
	}

	private async watchMcpSettingsFile(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		// Clean up existing settings watcher if it exists
		if (this.settingsWatcher) {
			this.settingsWatcher.dispose()
			this.settingsWatcher = undefined
		}

		const settingsPath = await this.getMcpSettingsFilePath()
		const settingsUri = vscode.Uri.file(settingsPath)
		const settingsPattern = new vscode.RelativePattern(path.dirname(settingsPath), path.basename(settingsPath))

		// Create a file system watcher for the global MCP settings file
		this.settingsWatcher = vscode.workspace.createFileSystemWatcher(settingsPattern)

		// Watch for file changes
		const changeDisposable = this.settingsWatcher.onDidChange((uri) => {
			if (arePathsEqual(uri.fsPath, settingsPath)) {
				this.debounceConfigChange(settingsPath, "global")
			}
		})

		// Watch for file creation
		const createDisposable = this.settingsWatcher.onDidCreate((uri) => {
			if (arePathsEqual(uri.fsPath, settingsPath)) {
				this.debounceConfigChange(settingsPath, "global")
			}
		})

		this.disposables.push(vscode.Disposable.from(changeDisposable, createDisposable, this.settingsWatcher))
	}

	private async initializeMcpServers(source: "global" | "project"): Promise<void> {
		try {
			const configPath =
				source === "global" ? await this.getMcpSettingsFilePath() : await this.getProjectMcpPath()

			if (!configPath) {
				return
			}

			const content = await fs.readFile(configPath, "utf-8")
			const config = JSON.parse(content)
			const result = McpSettingsSchema.safeParse(config)

			if (result.success) {
				// Pass all servers including disabled ones - they'll be handled in updateServerConnections
				await this.updateServerConnections(result.data.mcpServers || {}, source, false)
			} else {
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				console.error(`Invalid ${source} MCP settings format:`, errorMessages)
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))

				if (source === "global") {
					// Still try to connect with the raw config, but show warnings
					try {
						await this.updateServerConnections(config.mcpServers || {}, source, false)
					} catch (error) {
						this.showErrorMessage(`Failed to initialize ${source} MCP servers with raw config`, error)
					}
				}
			}
		} catch (error) {
			if (error instanceof SyntaxError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, error)
				vscode.window.showErrorMessage(errorMessage)
			} else {
				this.showErrorMessage(`Failed to initialize ${source} MCP servers`, error)
			}
		}
	}

	private async initializeGlobalMcpServers(): Promise<void> {
		await this.initializeMcpServers("global")
	}

	// Get project-level MCP configuration path
	private async getProjectMcpPath(): Promise<string | null> {
		const workspacePath = this.providerRef.deref()?.cwd ?? getWorkspacePath()
		const projectMcpDir = path.join(workspacePath, ".roo")
		const projectMcpPath = path.join(projectMcpDir, "mcp.json")

		try {
			await fs.access(projectMcpPath)
			return projectMcpPath
		} catch {
			return null
		}
	}

	// Initialize project-level MCP servers
	private async initializeProjectMcpServers(): Promise<void> {
		await this.initializeMcpServers("project")
	}

	/**
	 * Initialize the built-in figma-write server for seamless Figma integration
	 * This server is automatically registered without user configuration
	 */
	private async initializeBuiltInFigmaWriteServer(provider: ClineProvider): Promise<void> {
		try {
			// Check if figma-write is enabled in settings
			const state = await provider.getState()
			const figmaWriteEnabled = state?.figmaWriteEnabled ?? false // Default to false (TalkToFigma is preferred)
			if (!figmaWriteEnabled) {
				console.log("[McpHub] figma-write is disabled in settings, skipping initialization")
				return
			}

			// Get the extension path to locate the figma-write-bridge
			const extensionPath = provider.context?.extensionPath
			if (!extensionPath) {
				console.log("[McpHub] Extension path not available, skipping built-in figma-write server")
				return
			}

			const serverPath = `${extensionPath}/tools/figma-write-bridge/server.ts`

			// Check if the server file exists
			try {
				await fs.access(serverPath)
			} catch {
				console.log("[McpHub] figma-write-bridge not found, skipping built-in server")
				return
			}

			// Check if figma-write is already configured by user (don't override)
			const existingConnection = this.connections.find((conn) => conn.server.name === "figma-write")
			if (existingConnection) {
				console.log("[McpHub] figma-write already configured, skipping built-in server")
				return
			}

			// Register the built-in figma-write server using node with tsx loader
			// Note: We use node --import tsx/esm to run TypeScript directly, avoiding npx PATH issues and bundling issues with zod schemas
			const nodeModulesPath = `${extensionPath}/tools/figma-write-bridge/node_modules`
			const tsxPath = `${nodeModulesPath}/tsx/dist/esm/index.mjs`
			const config = {
				command: "node",
				args: ["--import", tsxPath, serverPath],
				type: "stdio" as const,
				timeout: 60, // 60 seconds (unit is seconds, not milliseconds!)
				alwaysAllow: [] as string[],
				disabledTools: [] as string[],
				cwd: `${extensionPath}/tools/figma-write-bridge`,
				env: {
					...process.env,
					NODE_PATH: nodeModulesPath,
				},
			}

			console.log("[McpHub] Initializing built-in figma-write server")
			await this.connectToServer("figma-write", config, "global")
			console.log("[McpHub] Built-in figma-write server initialized")
		} catch (error) {
			// Don't fail if figma-write can't be initialized - it's optional
			console.log("[McpHub] Could not initialize built-in figma-write server:", error)
		}
	}

	// Track if TalkToFigma initialization is in progress to prevent duplicate initializations
	private talkToFigmaInitializing: boolean = false
	private lastTalkToFigmaInitTime: number = 0

	/**
	 * Initialize the built-in TalkToFigma server for Figma integration via ai-figma-mcp
	 * This server is automatically registered without user configuration
	 */
	private async initializeBuiltInTalkToFigmaServer(): Promise<void> {
		try {
			// Check if Figma Integration or TalkToFigma is enabled in settings
			const provider = this.providerRef.deref()
			if (provider) {
				const state = await provider.getState()
				// Check main Figma toggle first
				const figmaEnabled = state?.figmaEnabled ?? true // Default to true
				if (!figmaEnabled) {
					console.log("[McpHub] Figma Integration is disabled, skipping TalkToFigma initialization")
					return
				}
				// Then check TalkToFigma specific toggle
				const talkToFigmaEnabled = state?.talkToFigmaEnabled ?? true // Default to true
				if (!talkToFigmaEnabled) {
					console.log("[McpHub] TalkToFigma is disabled in settings, skipping initialization")
					return
				}
			}

			// Prevent duplicate initializations - must wait at least 5 seconds between attempts
			const now = Date.now()
			if (this.talkToFigmaInitializing) {
				console.log("[McpHub] TalkToFigma initialization already in progress, skipping")
				return
			}
			if (now - this.lastTalkToFigmaInitTime < 5000) {
				console.log("[McpHub] TalkToFigma was initialized recently, skipping (debounce)")
				return
			}

			// Check if TalkToFigma is already configured by user (don't override)
			const existingConnection = this.connections.find((conn) => conn.server.name === "TalkToFigma")
			if (existingConnection && existingConnection.server.status === "connected") {
				console.log("[McpHub] TalkToFigma already configured and connected, skipping built-in server")
				return
			}

			this.talkToFigmaInitializing = true
			this.lastTalkToFigmaInitTime = now

			// Register the built-in TalkToFigma server using npx
			// All tools are set to always allow for seamless Figma integration
			// Package: ai-figma-mcp (same tools as cursor-talk-to-figma-mcp)
			const config = {
				command: "npx",
				args: ["-y", "ai-figma-mcp@latest"],
				type: "stdio" as const,
				timeout: 60, // 60 seconds
				cwd: vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath ?? process.cwd(),
				alwaysAllow: [
					// Connection Management
					"join_channel",
					// Document & Selection
					"get_document_info",
					"get_selection",
					"read_my_design",
					"get_node_info",
					"get_nodes_info",
					// Annotations
					"get_annotations",
					"set_annotation",
					"set_multiple_annotations",
					"scan_nodes_by_types",
					// Prototyping & Connections
					"get_reactions",
					"set_default_connector",
					"create_connections",
					// Creating Elements
					"create_rectangle",
					"create_frame",
					"create_text",
					// Modifying text content
					"scan_text_nodes",
					"set_text_content",
					"set_multiple_text_contents",
					// Auto Layout & Spacing
					"set_layout_mode",
					"set_padding",
					"set_axis_align",
					"set_layout_sizing",
					"set_item_spacing",
					// Styling
					"set_fill_color",
					"set_stroke_color",
					"set_corner_radius",
					// Layout & Organization
					"move_node",
					"resize_node",
					"delete_node",
					"delete_multiple_nodes",
					"clone_node",
					// Components & Styles
					"get_styles",
					"get_local_components",
					"create_component_instance",
					"get_instance_overrides",
					"set_instance_overrides",
					// Export
					"export_node_as_image",
				] as string[],
				// Disable tools that should not be called by AI agents
				// join_channel is handled automatically by the extension
				disabledTools: ["join_channel"] as string[],
			}

			console.log("[McpHub] Initializing built-in TalkToFigma server")
			await this.connectToServer("TalkToFigma", config, "global")
			console.log("[McpHub] Built-in TalkToFigma server initialized")
			// Note: Channel connection prompt is handled in ClineProvider.performPreparationTasks()
		} catch (error) {
			// Don't fail if TalkToFigma can't be initialized - it's optional
			console.log("[McpHub] Could not initialize built-in TalkToFigma server:", error)
		} finally {
			this.talkToFigmaInitializing = false
		}
	}

	// Track if Penpot initialization is in progress
	private penpotInitializing: boolean = false
	private penpotServerProcess: ChildProcess | null = null
	private penpotPluginServerProcess: ChildProcess | null = null
	private penpotServerPort: number = 4401
	private penpotPluginServerPort: number = 4400

	// UI Design Canvas server tracking
	private uiDesignCanvasInitializing: boolean = false
	private uiDesignCanvasServerProcess: ChildProcess | null = null
	private uiDesignCanvasServerPort: number = 4420

	/**
	 * Initialize the built-in Penpot MCP server for Penpot design integration
	 * This starts the bundled Penpot MCP server and connects via SSE
	 * Auto-enabled by default - will silently fail if Penpot MCP server cannot start
	 */
	private async initializeBuiltInPenpotServer(): Promise<void> {
		try {
			// Check if Penpot MCP is enabled in settings (default: true, like TalkToFigma)
			const provider = this.providerRef.deref()
			if (provider) {
				const state = await provider.getState()
				const penpotEnabled = state?.penpotMcpEnabled ?? true // Default to true - auto-enabled
				if (!penpotEnabled) {
					console.log("[McpHub] Penpot MCP is disabled in settings, skipping initialization")
					return
				}
			}

			// Prevent duplicate initializations
			if (this.penpotInitializing) {
				console.log("[McpHub] Penpot MCP initialization already in progress, skipping")
				return
			}

			// Check if Penpot is already configured by user (don't override)
			const existingConnection = this.connections.find((conn) => conn.server.name === "PenpotMCP")
			if (existingConnection && existingConnection.server.status === "connected") {
				console.log("[McpHub] Penpot MCP already configured and connected, skipping built-in server")
				return
			}

			this.penpotInitializing = true

			// Get the extension path to locate the bundled penpot-mcp server
			const extensionPath = provider?.context?.extensionPath
			if (!extensionPath) {
				console.log("[McpHub] Extension path not available, skipping built-in Penpot server")
				return
			}

			const serverPath = `${extensionPath}/tools/penpot-mcp/mcp-server/dist/index.js`

			// Check if the bundled server file exists
			try {
				await fs.access(serverPath)
			} catch {
				console.log("[McpHub] Bundled penpot-mcp not found, skipping built-in server")
				return
			}

			// Kill any existing process on the Penpot port to avoid conflicts
			await killProcessOnPort(this.penpotServerPort)
			await killProcessOnPort(4402) // WebSocket port
			await killProcessOnPort(4403) // REPL port

			// Start the bundled Penpot MCP server as a child process
			const serverDir = `${extensionPath}/tools/penpot-mcp/mcp-server`
			const nodeModulesPath = `${serverDir}/node_modules`

			console.log("[McpHub] Starting bundled Penpot MCP server...")
			this.penpotServerProcess = spawn("node", [serverPath], {
				cwd: serverDir,
				env: {
					...process.env,
					NODE_PATH: nodeModulesPath,
					PENPOT_MCP_SERVER_PORT: String(this.penpotServerPort),
					PENPOT_MCP_WEBSOCKET_PORT: "4402",
					PENPOT_MCP_REPL_PORT: "4403",
				},
				stdio: ["pipe", "pipe", "pipe"],
				detached: false,
			})

			// Log server output for debugging
			this.penpotServerProcess.stdout?.on("data", (data) => {
				console.log(`[PenpotMCP] ${data.toString().trim()}`)
			})
			this.penpotServerProcess.stderr?.on("data", (data) => {
				console.error(`[PenpotMCP Error] ${data.toString().trim()}`)
			})
			this.penpotServerProcess.on("exit", (code) => {
				console.log(`[McpHub] Penpot MCP server exited with code ${code}`)
				this.penpotServerProcess = null
			})

			// Wait for the server to be ready (check SSE endpoint)
			const maxAttempts = 10
			const delayMs = 500
			let serverReady = false

			for (let i = 0; i < maxAttempts; i++) {
				try {
					const response = await fetch(`http://localhost:${this.penpotServerPort}/sse`, {
						method: "GET",
						headers: { Accept: "text/event-stream" },
					})
					if (response.ok || response.status === 200) {
						serverReady = true
						break
					}
				} catch {
					// Server not ready yet, wait and retry
				}
				await new Promise((resolve) => setTimeout(resolve, delayMs))
			}

			if (!serverReady) {
				console.log("[McpHub] Penpot MCP server failed to start within timeout")
				if (this.penpotServerProcess) {
					this.penpotServerProcess.kill()
					this.penpotServerProcess = null
				}
				return
			}

			console.log("[McpHub] Penpot MCP server started, connecting via SSE...")

			// Also start the Penpot Plugin server to serve the browser plugin
			await killProcessOnPort(this.penpotPluginServerPort)
			const pluginServerPath = `${extensionPath}/tools/penpot-mcp/penpot-plugin/server.js`
			try {
				await fs.access(pluginServerPath)
				console.log("[McpHub] Starting Penpot Plugin server...")
				this.penpotPluginServerProcess = spawn("node", [pluginServerPath], {
					cwd: `${extensionPath}/tools/penpot-mcp/penpot-plugin`,
					env: {
						...process.env,
						PENPOT_MCP_PLUGIN_PORT: String(this.penpotPluginServerPort),
					},
					stdio: ["pipe", "pipe", "pipe"],
					detached: false,
				})

				this.penpotPluginServerProcess.stdout?.on("data", (data) => {
					console.log(`[PenpotPlugin] ${data.toString().trim()}`)
				})
				this.penpotPluginServerProcess.stderr?.on("data", (data) => {
					console.error(`[PenpotPlugin Error] ${data.toString().trim()}`)
				})
				this.penpotPluginServerProcess.on("exit", (code) => {
					console.log(`[McpHub] Penpot Plugin server exited with code ${code}`)
					this.penpotPluginServerProcess = null
				})

				// Wait for plugin server to be ready
				await new Promise((resolve) => setTimeout(resolve, 1000))
				console.log("[McpHub] Penpot Plugin server started at http://localhost:" + this.penpotPluginServerPort)
			} catch {
				console.log("[McpHub] Penpot Plugin server not found, skipping")
			}

			// Connect to the Penpot MCP server via SSE
			const config = {
				url: `http://localhost:${this.penpotServerPort}/sse`,
				type: "sse" as const,
				timeout: 60, // 60 seconds
				alwaysAllow: [
					// Penpot tools - auto-approve for seamless design integration
					"execute_code",
					"high_level_overview",
					"penpot_api_info",
					"export_shape",
					"import_image",
				] as string[],
				disabledTools: [] as string[],
			}

			console.log("[McpHub] Connecting to built-in Penpot MCP server via SSE")
			await this.connectToServer("PenpotMCP", config, "global")
			console.log("[McpHub] Built-in Penpot MCP server initialized successfully")
		} catch (error) {
			// Silently fail if Penpot can't be initialized - it's optional and auto-enabled
			console.log("[McpHub] Penpot MCP server not available:", error)
			// Clean up the server process if it was started
			if (this.penpotServerProcess) {
				this.penpotServerProcess.kill()
				this.penpotServerProcess = null
			}
		} finally {
			this.penpotInitializing = false
		}
	}

	/**
	 * Stop the bundled Penpot MCP server and plugin server
	 */
	private async stopPenpotServer(): Promise<void> {
		if (this.penpotServerProcess) {
			console.log("[McpHub] Stopping bundled Penpot MCP server...")
			this.penpotServerProcess.kill()
			this.penpotServerProcess = null
			// Kill any lingering processes on the ports
			await killProcessOnPort(this.penpotServerPort)
			await killProcessOnPort(4402)
			await killProcessOnPort(4403)
		}
		if (this.penpotPluginServerProcess) {
			console.log("[McpHub] Stopping Penpot Plugin server...")
			this.penpotPluginServerProcess.kill()
			this.penpotPluginServerProcess = null
			await killProcessOnPort(this.penpotPluginServerPort)
		}
	}

	/**
	 * Check if Penpot MCP server is connected and available
	 */
	isPenpotMcpConnected(): boolean {
		return this.connections.some((conn) => conn.server.name === "PenpotMCP" && conn.server.status === "connected")
	}

	/**
	 * Initialize the built-in UI Design Canvas MCP server
	 * This provides a custom UI design system that doesn't depend on external tools like Penpot or Figma
	 * Auto-enabled by default
	 */
	private async initializeBuiltInUIDesignCanvasServer(): Promise<void> {
		try {
			// Check if UI Design Canvas is enabled in settings (default: true)
			const provider = this.providerRef.deref()
			if (provider) {
				const state = await provider.getState()
				const uiDesignCanvasEnabled = state?.uiDesignCanvasEnabled ?? true // Default to true
				if (!uiDesignCanvasEnabled) {
					console.log("[McpHub] UI Design Canvas is disabled in settings, skipping initialization")
					return
				}
			}

			// Prevent duplicate initializations
			if (this.uiDesignCanvasInitializing) {
				console.log("[McpHub] UI Design Canvas initialization already in progress, skipping")
				return
			}

			// Check if already connected
			const existingConnection = this.connections.find((conn) => conn.server.name === "UIDesignCanvas")
			if (existingConnection && existingConnection.server.status === "connected") {
				console.log("[McpHub] UI Design Canvas already connected, skipping")
				return
			}

			this.uiDesignCanvasInitializing = true

			// Get the extension path
			const extensionPath = provider?.context?.extensionPath
			if (!extensionPath) {
				console.log("[McpHub] Extension path not available, skipping UI Design Canvas server")
				return
			}

			const serverPath = `${extensionPath}/tools/ui-design-canvas/dist/McpServer.js`

			// Check if the server file exists
			try {
				await fs.access(serverPath)
			} catch {
				console.log("[McpHub] UI Design Canvas server not found, skipping")
				return
			}

			// Kill any existing process on the port
			await killProcessOnPort(this.uiDesignCanvasServerPort)

			// Start the UI Design Canvas MCP server
			const serverDir = `${extensionPath}/tools/ui-design-canvas`
			const nodeModulesPath = `${serverDir}/node_modules`

			console.log("[McpHub] Starting UI Design Canvas MCP server...")
			this.uiDesignCanvasServerProcess = spawn("node", [serverPath], {
				cwd: serverDir,
				env: {
					...process.env,
					NODE_PATH: nodeModulesPath,
					UI_CANVAS_PORT: String(this.uiDesignCanvasServerPort),
				},
				stdio: ["pipe", "pipe", "pipe"],
				detached: false,
			})

			// Log server output for debugging
			this.uiDesignCanvasServerProcess.stdout?.on("data", (data) => {
				console.log(`[UIDesignCanvas] ${data.toString().trim()}`)
			})
			this.uiDesignCanvasServerProcess.stderr?.on("data", (data) => {
				console.error(`[UIDesignCanvas Error] ${data.toString().trim()}`)
			})
			this.uiDesignCanvasServerProcess.on("exit", (code) => {
				console.log(`[McpHub] UI Design Canvas server exited with code ${code}`)
				this.uiDesignCanvasServerProcess = null
			})

			// Wait for the server to be ready (check health endpoint, NOT SSE!)
			// Using /sse for readiness check would create a dangling SSE connection
			const maxAttempts = 10
			const delayMs = 500
			let serverReady = false

			for (let i = 0; i < maxAttempts; i++) {
				try {
					const response = await fetch(`http://127.0.0.1:${this.uiDesignCanvasServerPort}/health`, {
						method: "GET",
					})
					if (response.ok) {
						serverReady = true
						break
					}
				} catch {
					// Server not ready yet, wait and retry
				}
				await new Promise((resolve) => setTimeout(resolve, delayMs))
			}

			if (!serverReady) {
				console.log("[McpHub] UI Design Canvas server failed to start within timeout")
				if (this.uiDesignCanvasServerProcess) {
					this.uiDesignCanvasServerProcess.kill()
					this.uiDesignCanvasServerProcess = null
				}
				return
			}

			console.log("[McpHub] UI Design Canvas server started, connecting via SSE...")

			// Connect to the UI Design Canvas MCP server via SSE
			const config = {
				url: `http://127.0.0.1:${this.uiDesignCanvasServerPort}/sse`,
				type: "sse" as const,
				timeout: 60,
				alwaysAllow: [
					// UI Design Canvas tools - auto-approve for seamless design integration
					"get_design",
					"new_design",
					"create_frame",
					"create_rectangle",
					"create_text",
					"create_ellipse",
					"create_image",
					"update_element",
					"move_element",
					"resize_element",
					"delete_element",
					"set_style",
					"set_layout",
					"find_elements",
					"get_element",
					"export_html",
					"export_json",
					"get_screenshot",
					"set_tokens",
					"get_tokens",
					"set_canvas",
				] as string[],
				disabledTools: [] as string[],
			}

			console.log("[McpHub] Connecting to UI Design Canvas MCP server via SSE")
			await this.connectToServer("UIDesignCanvas", config, "global")
			console.log("[McpHub] UI Design Canvas server initialized successfully")
		} catch (error) {
			console.log("[McpHub] UI Design Canvas server not available:", error)
			if (this.uiDesignCanvasServerProcess) {
				this.uiDesignCanvasServerProcess.kill()
				this.uiDesignCanvasServerProcess = null
			}
		} finally {
			this.uiDesignCanvasInitializing = false
		}
	}

	/**
	 * Stop the UI Design Canvas MCP server
	 */
	private async stopUIDesignCanvasServer(): Promise<void> {
		if (this.uiDesignCanvasServerProcess) {
			console.log("[McpHub] Stopping UI Design Canvas server...")
			this.uiDesignCanvasServerProcess.kill()
			this.uiDesignCanvasServerProcess = null
			await killProcessOnPort(this.uiDesignCanvasServerPort)
		}
	}

	/**
	 * Check if UI Design Canvas server is connected and available
	 */
	isUIDesignCanvasConnected(): boolean {
		return this.connections.some((conn) => conn.server.name === "UIDesignCanvas" && conn.server.status === "connected")
	}

	/**
	 * Get the UI Design Canvas server port
	 */
	getUIDesignCanvasPort(): number {
		return this.uiDesignCanvasServerPort
	}

	// Track if MCP-UI initialization is in progress
	private mcpUiInitializing: boolean = false

	/**
	 * Initialize the built-in MCP-UI server for interactive UI capabilities
	 * This server provides rich interactive tool responses with embedded UI
	 * Connects to user-configured local server or default URL
	 */
	private async initializeBuiltInMcpUiServer(): Promise<void> {
		try {
			// Prevent duplicate initializations
			if (this.mcpUiInitializing) {
				console.log("[McpHub] MCP-UI server initialization already in progress, skipping")
				return
			}

			// Check if MCP-UI is enabled in settings
			let mcpUiEnabled = true // Default to true for built-in server

			try {
				const provider = this.providerRef.deref()
				if (provider) {
					const state = await provider.getState()
					mcpUiEnabled = state?.mcpUiEnabled ?? true
					console.log(`[McpHub] MCP-UI settings from state: enabled=${mcpUiEnabled}`)
				} else {
					console.log("[McpHub] MCP-UI: Provider not available, skipping initialization")
					return
				}
			} catch (e) {
				const errorMsg = e instanceof Error ? e.message : String(e)
				console.log(`[McpHub] MCP-UI state not ready yet, skipping initialization. Error: ${errorMsg}`)
				return
			}

			if (!mcpUiEnabled) {
				console.log("[McpHub] MCP-UI is disabled in settings, skipping initialization")
				return
			}

			// Check if MCP-UI is already configured by user (don't override)
			const existingConnection = this.connections.find((conn) => conn.server.name === "MCP-UI")
			if (existingConnection && existingConnection.server.status === "connected") {
				console.log("[McpHub] MCP-UI already configured and connected, skipping built-in server")
				return
			}

			// Get extension path for built-in server
			const provider = this.providerRef.deref()
			const extensionPath = provider?.context?.extensionPath
			if (!extensionPath) {
				console.log("[McpHub] Extension path not available, skipping built-in MCP-UI server")
				return
			}

			const serverPath = `${extensionPath}/tools/mcp-ui-server/server.ts`

			// Check if the server file exists
			try {
				await fs.access(serverPath)
			} catch {
				console.log("[McpHub] mcp-ui-server not found, skipping built-in server")
				return
			}

			this.mcpUiInitializing = true

			// Use node with tsx loader to run TypeScript directly
			const nodeModulesPath = `${extensionPath}/tools/mcp-ui-server/node_modules`
			const tsxPath = `${nodeModulesPath}/tsx/dist/esm/index.mjs`
			const config = {
				command: "node",
				args: ["--import", tsxPath, serverPath],
				type: "stdio" as const,
				timeout: 60,
				alwaysAllow: ["*"] as string[], // Allow all MCP-UI tools
				disabledTools: [] as string[],
				cwd: `${extensionPath}/tools/mcp-ui-server`,
				env: {
					...process.env,
					NODE_PATH: nodeModulesPath,
				},
			}

			console.log(`[McpHub] Initializing built-in MCP-UI server at ${serverPath}`)
			await this.connectToServer("MCP-UI", config, "global")
			console.log("[McpHub] MCP-UI server initialized successfully")
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			console.log(`[McpHub] MCP-UI server not available: ${errorMsg}`)
		} finally {
			this.mcpUiInitializing = false
		}
	}

	/**
	 * Reconnect to MCP-UI server (called when settings change)
	 */
	async reconnectMcpUiServer(): Promise<void> {
		try {
			// Disconnect existing MCP-UI connection if any
			const existingConnection = this.connections.find((conn) => conn.server.name === "MCP-UI")
			if (existingConnection) {
				try {
					await this.deleteConnection("MCP-UI")
				} catch (deleteError) {
					// Ignore errors during disconnection
					console.log("[McpHub] Error disconnecting MCP-UI (ignoring):", deleteError)
				}
			}
			// Re-initialize with new settings
			await this.initializeBuiltInMcpUiServer()
		} catch (error) {
			// Silently fail - don't show errors to user if server is not available
			console.log("[McpHub] MCP-UI reconnection failed (this is normal if server is not running)")
		}
	}

	/**
	 * Check if MCP-UI server is connected and available
	 */
	isMcpUiConnected(): boolean {
		return this.connections.some((conn) => conn.server.name === "MCP-UI" && conn.server.status === "connected")
	}

	// Track if Figma channel has been connected in this session
	private figmaChannelConnected: boolean = false
	// Prevent multiple error prompts for the same disconnection event
	private figmaErrorPromptPending: boolean = false
	// Store the last used channel code for auto-reconnection
	private lastFigmaChannelCode: string | null = null

	/**
	 * Check if TalkToFigma server is connected and available
	 */
	isTalkToFigmaConnected(): boolean {
		return this.connections.some((conn) => conn.server.name === "TalkToFigma" && conn.server.status === "connected")
	}

	/**
	 * Check if Figma channel has been joined in this session
	 */
	isFigmaChannelConnected(): boolean {
		return this.figmaChannelConnected
	}

	/**
	 * Reset the Figma channel connection state
	 * Called when connection is detected as broken
	 */
	resetFigmaChannelConnection(): void {
		this.figmaChannelConnected = false
		console.log("[McpHub] Figma channel connection state reset")
	}

	/**
	 * Prompt user to enter the Figma channel code and connect
	 * Called at the start of each conversation if TalkToFigma is available
	 * @param forcePrompt If true, prompts even if already connected (for reconnection)
	 */
	async promptTalkToFigmaChannelConnection(forcePrompt: boolean = false): Promise<boolean> {
		// Skip if already connected in this session (unless forcing reconnection)
		if (this.figmaChannelConnected && !forcePrompt) {
			console.log("[McpHub] Figma channel already connected in this session")
			return true
		}

		// Skip if TalkToFigma server is not connected
		if (!this.isTalkToFigmaConnected()) {
			console.log("[McpHub] TalkToFigma server not connected, skipping channel prompt")
			return false
		}

		try {
			// If we have a previous channel code, try auto-reconnect first (even without forcePrompt)
			// This enables seamless reconnection when starting a new task
			if (this.lastFigmaChannelCode) {
				console.log(
					"[McpHub] Attempting auto-reconnection with previous channel code:",
					this.lastFigmaChannelCode,
				)
				vscode.window.showInformationMessage(
					`正在嘗試重新連接到頻道 ${this.lastFigmaChannelCode}... (Attempting to reconnect...)`,
				)

				try {
					const autoResult = await this.callTool("TalkToFigma", "join_channel", {
						channel: this.lastFigmaChannelCode,
					})
					if (autoResult) {
						const textContent = autoResult.content?.find((c: { type: string }) => c.type === "text")
						const resultText =
							textContent && "text" in textContent ? (textContent.text as string).toLowerCase() : ""

						// Check if auto-reconnect succeeded
						if (
							!resultText.includes("error") &&
							!resultText.includes("failed") &&
							!resultText.includes("not connected")
						) {
							this.figmaChannelConnected = true
							vscode.window.showInformationMessage(
								`✓ 已自動連接到頻道 ${this.lastFigmaChannelCode} (Auto-connected to channel)`,
							)
							console.log("[McpHub] Auto-reconnected to Figma channel:", this.lastFigmaChannelCode)
							return true
						}
					}
				} catch (autoError) {
					console.log("[McpHub] Auto-reconnection failed:", autoError)
				}

				// Auto-reconnect failed, will prompt for new code below
				console.log("[McpHub] Auto-reconnection with previous code failed, prompting for new code")
			}

			// Ask user for the channel code
			// Show appropriate message based on whether auto-reconnect was attempted
			let promptMessage: string
			let title: string
			if (this.lastFigmaChannelCode) {
				// Auto-reconnect was attempted but failed
				promptMessage = `自動重連失敗。請輸入新的頻道代碼：\n(Auto-reconnect to ${this.lastFigmaChannelCode} failed. Enter a new channel code:)`
				title = "重新連接 Figma (Reconnect)"
			} else if (forcePrompt) {
				promptMessage = `請輸入頻道代碼重新連接：\n(Enter channel code to reconnect:)`
				title = "重新連接 Figma (Reconnect)"
			} else {
				promptMessage = "請輸入 Figma 頻道代碼 (Enter Figma channel code from plugin)"
				title = "連接 Figma (Connect)"
			}

			const channelCode = await vscode.window.showInputBox({
				prompt: promptMessage,
				placeHolder: this.lastFigmaChannelCode || "e.g., abc123",
				value: this.lastFigmaChannelCode || undefined, // Pre-fill with last code
				title,
				ignoreFocusOut: true,
			})

			if (!channelCode) {
				console.log("[McpHub] User cancelled Figma channel connection")
				vscode.window.showInformationMessage("Figma 頻道未連接。(Figma channel not connected.)")
				return false
			}

			// Reset connection state before reconnecting
			this.figmaChannelConnected = false

			// Call the join_channel tool (correct tool name for ai-figma-mcp)
			const result = await this.callTool("TalkToFigma", "join_channel", { channel: channelCode })

			if (result) {
				this.figmaChannelConnected = true
				this.lastFigmaChannelCode = channelCode // Store for auto-reconnection
				vscode.window.showInformationMessage(`已連接到 Figma 頻道: ${channelCode}`)
				console.log("[McpHub] Successfully connected to Figma channel:", channelCode)
				return true
			}
			return false
		} catch (error) {
			console.log("[McpHub] Failed to connect to Figma channel:", error)
			this.figmaChannelConnected = false
			vscode.window.showWarningMessage(
				"Failed to connect to Figma channel. Make sure the Cursor Talk to Figma plugin is running in Figma.",
			)
			return false
		}
	}

	/**
	 * Open the Figma preview panel
	 */
	private async openFigmaPreviewPanel(figmaUrl: string, extensionUri: vscode.Uri): Promise<void> {
		try {
			const { FigmaPreviewPanel } = await import("../figma/FigmaPreviewPanel")
			const figmaPreview = FigmaPreviewPanel.initialize(extensionUri)
			await figmaPreview.show(figmaUrl)
			console.log("[McpHub] Figma preview panel opened automatically")
		} catch (error) {
			console.error("[McpHub] Failed to open Figma preview:", error)
		}
	}

	/**
	 * Handle Figma tool call failure - auto-reconnect with same channel code
	 * Returns true if reconnection was successful
	 */
	async handleFigmaConnectionError(errorMessage?: string): Promise<boolean> {
		console.log("[McpHub] Figma connection error detected:", errorMessage)

		// Check if this looks like a connection error
		const lowerError = (errorMessage || "").toLowerCase()
		const isConnectionError =
			!errorMessage ||
			lowerError.includes("disconnect") ||
			lowerError.includes("timeout") ||
			lowerError.includes("not connected") ||
			lowerError.includes("channel not found") ||
			lowerError.includes("no channel") ||
			lowerError.includes("join a channel") ||
			lowerError.includes("please join") ||
			lowerError.includes("not joined") ||
			lowerError.includes("channel closed") ||
			lowerError.includes("socket closed") ||
			lowerError.includes("websocket error") ||
			lowerError.includes("connection lost") ||
			lowerError.includes("connection refused") ||
			lowerError.includes("failed to send") ||
			lowerError.includes("no response") ||
			lowerError.includes("no active connection") ||
			lowerError.includes("unable to send")

		if (isConnectionError) {
			// Reset connection state
			this.resetFigmaChannelConnection()

			// Try auto-reconnect with stored channel code first (silently)
			if (this.lastFigmaChannelCode) {
				console.log("[McpHub] Attempting silent auto-reconnect to channel:", this.lastFigmaChannelCode)
				vscode.window.showInformationMessage(
					`正在自動重新連接到頻道 ${this.lastFigmaChannelCode}... (Auto-reconnecting to channel...)`,
				)

				try {
					const autoResult = await this.callTool("TalkToFigma", "join_channel", {
						channel: this.lastFigmaChannelCode,
					})
					if (autoResult) {
						const textContent = autoResult.content?.find((c: { type: string }) => c.type === "text")
						const resultText =
							textContent && "text" in textContent ? (textContent.text as string).toLowerCase() : ""

						// Check if auto-reconnect succeeded
						if (
							!resultText.includes("error") &&
							!resultText.includes("failed") &&
							!resultText.includes("not connected")
						) {
							this.figmaChannelConnected = true
							vscode.window.showInformationMessage(
								`✓ 已自動重新連接到頻道 ${this.lastFigmaChannelCode} (Auto-reconnected successfully)`,
							)
							console.log("[McpHub] Silent auto-reconnect successful:", this.lastFigmaChannelCode)
							return true
						}
					}
				} catch (autoError) {
					console.log("[McpHub] Silent auto-reconnect failed:", autoError)
				}

				// Auto-reconnect failed, show prompt
				vscode.window.showWarningMessage(
					`自動重連失敗。(Auto-reconnect to ${this.lastFigmaChannelCode} failed.)`,
				)
			}

			// Show error message and prompt for action (only if auto-reconnect failed or no stored code)
			const action = await vscode.window.showWarningMessage(
				"Figma 連線中斷或失敗。\n(Figma connection lost or failed.)",
				"重啟伺服器 (Restart Server)",
				"輸入新代碼 (New Code)",
				"取消 (Cancel)",
			)

			if (action === "重啟伺服器 (Restart Server)") {
				// Try to restart the MCP server first
				console.log("[McpHub] Attempting to restart Figma MCP server...")

				try {
					// Find which Figma server is being used
					const talkToFigmaConn = this.findConnection("TalkToFigma")
					const figmaWriteConn = this.findConnection("figma-write")

					if (talkToFigmaConn) {
						vscode.window.showInformationMessage(
							"正在重啟 TalkToFigma 伺服器... (Restarting TalkToFigma server...)",
						)
						await this.restartConnection("TalkToFigma", talkToFigmaConn.server.source)

						// After restart, clear old channel code and prompt for new one
						// This ensures the input dialog appears instead of auto-reconnecting
						this.lastFigmaChannelCode = null
						this.figmaChannelConnected = false
						vscode.window.showInformationMessage(
							"伺服器已重啟，請輸入新的連接代碼。(Server restarted, please enter new channel code.)",
						)
						return this.promptTalkToFigmaChannelConnection(true)
					} else if (figmaWriteConn) {
						vscode.window.showInformationMessage(
							"正在重啟 figma-write 伺服器... (Restarting figma-write server...)",
						)
						await this.restartConnection("figma-write", figmaWriteConn.server.source)
						vscode.window.showInformationMessage(
							"figma-write 伺服器已重啟。(figma-write server restarted.)",
						)
						return true
					} else {
						vscode.window.showErrorMessage("找不到 Figma MCP 伺服器。(No Figma MCP server found.)")
						return false
					}
				} catch (error) {
					console.error("[McpHub] Failed to restart Figma server:", error)
					vscode.window.showErrorMessage(
						`重啟失敗: ${error instanceof Error ? error.message : String(error)}`,
					)

					// If restart fails, offer to enter new code
					const retry = await vscode.window.showWarningMessage(
						"伺服器重啟失敗，是否要輸入新的連接代碼？\n(Server restart failed. Enter new channel code?)",
						"輸入新代碼 (New Code)",
						"取消 (Cancel)",
					)

					if (retry === "輸入新代碼 (New Code)") {
						return this.promptTalkToFigmaChannelConnection(true)
					}
					return false
				}
			} else if (action === "輸入新代碼 (New Code)") {
				return this.promptTalkToFigmaChannelConnection(true)
			}
		}

		return false
	}

	/**
	 * Creates a placeholder connection for disabled servers or when MCP is globally disabled
	 * @param name The server name
	 * @param config The server configuration
	 * @param source The source of the server (global or project)
	 * @param reason The reason for creating a placeholder (mcpDisabled or serverDisabled)
	 * @returns A placeholder DisconnectedMcpConnection object
	 */
	private createPlaceholderConnection(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project",
		reason: DisableReason,
	): DisconnectedMcpConnection {
		return {
			type: "disconnected",
			server: {
				name,
				config: JSON.stringify(config),
				status: "disconnected",
				disabled: reason === DisableReason.SERVER_DISABLED ? true : config.disabled,
				source,
				projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
				errorHistory: [],
			},
			client: null,
			transport: null,
		}
	}

	/**
	 * Checks if MCP is globally enabled
	 * @returns Promise<boolean> indicating if MCP is enabled
	 */
	private async isMcpEnabled(): Promise<boolean> {
		const provider = this.providerRef.deref()
		if (!provider) {
			return true // Default to enabled if provider is not available
		}
		const state = await provider.getState()
		return state.mcpEnabled ?? true
	}

	private async connectToServer(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project" = "global",
	): Promise<void> {
		// Remove existing connection if it exists with the same source
		await this.deleteConnection(name, source)

		// Register the sanitized name for O(1) lookup
		const sanitizedName = sanitizeMcpName(name)
		this.sanitizedNameRegistry.set(sanitizedName, name)

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			// Still create a connection object to track the server, but don't actually connect
			const connection = this.createPlaceholderConnection(name, config, source, DisableReason.MCP_DISABLED)
			this.connections.push(connection)
			return
		}

		// Skip connecting to disabled servers
		if (config.disabled) {
			// Still create a connection object to track the server, but don't actually connect
			const connection = this.createPlaceholderConnection(name, config, source, DisableReason.SERVER_DISABLED)
			this.connections.push(connection)
			return
		}

		// Set up file watchers for enabled servers
		this.setupFileWatcher(name, config, source)

		try {
			const client = new Client(
				{
					name: "Roo Code",
					version: this.providerRef.deref()?.context.extension?.packageJSON?.version ?? "1.0.0",
				},
				{
					capabilities: {},
				},
			)

			let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

			// Inject variables to the config (environment, magic variables,...)
			const configInjected = (await injectVariables(config, {
				env: process.env,
				workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
			})) as typeof config

			if (configInjected.type === "stdio") {
				// On Windows, wrap commands with cmd.exe to handle non-exe executables like npx.ps1
				// This is necessary for node version managers (fnm, nvm-windows, volta) that implement
				// commands as PowerShell scripts rather than executables.
				// Note: This adds a small overhead as commands go through an additional shell layer.
				const isWindows = process.platform === "win32"

				// Check if command is already cmd.exe to avoid double-wrapping
				const isAlreadyWrapped =
					configInjected.command.toLowerCase() === "cmd.exe" || configInjected.command.toLowerCase() === "cmd"

				const command = isWindows && !isAlreadyWrapped ? "cmd.exe" : configInjected.command
				const args =
					isWindows && !isAlreadyWrapped
						? ["/c", configInjected.command, ...(configInjected.args || [])]
						: configInjected.args

				transport = new StdioClientTransport({
					command,
					args,
					cwd: configInjected.cwd,
					env: {
						...getDefaultEnvironment(),
						...(configInjected.env || {}),
					},
					stderr: "pipe",
				})

				// Set up stdio specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}":`, error)
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
					// Schedule auto-reconnect
					this.scheduleAutoReconnect(name, source)
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
					// Schedule auto-reconnect
					this.scheduleAutoReconnect(name, source)
				}

				// transport.stderr is only available after the process has been started. However we can't start it separately from the .connect() call because it also starts the transport. And we can't place this after the connect call since we need to capture the stderr stream before the connection is established, in order to capture errors during the connection process.
				// As a workaround, we start the transport ourselves, and then monkey-patch the start method to no-op so that .connect() doesn't try to start it again.
				await transport.start()
				const stderrStream = transport.stderr
				if (stderrStream) {
					stderrStream.on("data", async (data: Buffer) => {
						const output = data.toString()
						// Check if output contains INFO level log (without ERROR)
						const hasInfo = /INFO/i.test(output)
						const hasError = /ERROR/i.test(output)

						if (hasInfo && !hasError) {
							// Log normal informational messages
							console.log(`Server "${name}" info:`, output)
						} else {
							// Treat as error log (includes ERROR or no INFO)
							console.error(`Server "${name}" stderr:`, output)
							const connection = this.findConnection(name, source)
							if (connection) {
								this.appendErrorMessage(connection, output)
								if (connection.server.status === "disconnected") {
									await this.notifyWebviewOfServerChanges()
								}
							}
						}

						// Check for TalkToFigma connection errors in ANY output (info or stderr)
						// Only trigger error handling if we HAD previously connected to a channel
						// "Please join a channel" before connection is NOT an error
						if (name === "TalkToFigma" && this.figmaChannelConnected) {
							const lowerOutput = output.toLowerCase()
							// These patterns indicate a real disconnection AFTER being connected
							const isFigmaConnectionError =
								lowerOutput.includes("disconnected from channel") ||
								lowerOutput.includes("disconnected from figma") ||
								lowerOutput.includes("left channel") ||
								lowerOutput.includes("channel closed") ||
								lowerOutput.includes("websocket closed") ||
								lowerOutput.includes("connection lost") ||
								lowerOutput.includes("socket closed") ||
								lowerOutput.includes("socket error") ||
								lowerOutput.includes("aggregateerror") ||
								lowerOutput.includes("econnrefused") ||
								lowerOutput.includes("connection error") ||
								lowerOutput.includes("connection refused")

							if (isFigmaConnectionError && !this.figmaErrorPromptPending) {
								console.log("[McpHub] TalkToFigma disconnection detected:", output)
								this.figmaErrorPromptPending = true
								// Trigger reconnection prompt (with debounce to prevent multiple prompts)
								setTimeout(() => {
									this.handleFigmaConnectionError(output).finally(() => {
										this.figmaErrorPromptPending = false
									})
								}, 500)
							}
						}
					})
				} else {
					console.error(`No stderr stream for ${name}`)
				}
			} else if (configInjected.type === "streamable-http") {
				// Streamable HTTP connection
				transport = new StreamableHTTPClientTransport(new URL(configInjected.url), {
					requestInit: {
						headers: configInjected.headers,
					},
				})

				// Set up Streamable HTTP specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}" (streamable-http):`, error)
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
					// Schedule auto-reconnect
					this.scheduleAutoReconnect(name, source)
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
					// Schedule auto-reconnect
					this.scheduleAutoReconnect(name, source)
				}
			} else if (configInjected.type === "sse") {
				// SSE connection
				const sseOptions = {
					requestInit: {
						headers: configInjected.headers,
					},
				}
				// Configure ReconnectingEventSource options
				const reconnectingEventSourceOptions = {
					max_retry_time: 5000, // Maximum retry time in milliseconds
					withCredentials: configInjected.headers?.["Authorization"] ? true : false, // Enable credentials if Authorization header exists
					fetch: (url: string | URL, init: RequestInit) => {
						const headers = new Headers({ ...(init?.headers || {}), ...(configInjected.headers || {}) })
						return fetch(url, {
							...init,
							headers,
						})
					},
				}
				global.EventSource = ReconnectingEventSource
				transport = new SSEClientTransport(new URL(configInjected.url), {
					...sseOptions,
					eventSourceInit: reconnectingEventSourceOptions,
				})

				// Set up SSE specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}":`, error)
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
					// Schedule auto-reconnect
					this.scheduleAutoReconnect(name, source)
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
					// Schedule auto-reconnect
					this.scheduleAutoReconnect(name, source)
				}
			} else {
				// Should not happen if validateServerConfig is correct
				throw new Error(`Unsupported MCP server type: ${(configInjected as any).type}`)
			}

			// Only override transport.start for stdio transports that have already been started
			if (configInjected.type === "stdio") {
				transport.start = async () => {}
			}

			// Create a connected connection
			const connection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name,
					config: JSON.stringify(configInjected),
					status: "connecting",
					disabled: configInjected.disabled,
					source,
					projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
					errorHistory: [],
				},
				client,
				transport,
			}
			this.connections.push(connection)

			// Connect (this will automatically start the transport)
			await client.connect(transport)
			connection.server.status = "connected"
			connection.server.error = ""
			connection.server.instructions = client.getInstructions()

			// Reset reconnect attempts on successful connection
			this.resetReconnectAttempts(name, source)

			// Initial fetch of tools and resources
			connection.server.tools = await this.fetchToolsList(name, source)
			connection.server.resources = await this.fetchResourcesList(name, source)
			connection.server.resourceTemplates = await this.fetchResourceTemplatesList(name, source)
		} catch (error) {
			// Update status with error
			const connection = this.findConnection(name, source)
			if (connection) {
				connection.server.status = "disconnected"
				this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
			}
			throw error
		}
	}

	private appendErrorMessage(connection: McpConnection, error: string, level: "error" | "warn" | "info" = "error") {
		const MAX_ERROR_LENGTH = 1000
		const truncatedError =
			error.length > MAX_ERROR_LENGTH
				? `${error.substring(0, MAX_ERROR_LENGTH)}...(error message truncated)`
				: error

		// Add to error history
		if (!connection.server.errorHistory) {
			connection.server.errorHistory = []
		}

		connection.server.errorHistory.push({
			message: truncatedError,
			timestamp: Date.now(),
			level,
		})

		// Keep only the last 100 errors
		if (connection.server.errorHistory.length > 100) {
			connection.server.errorHistory = connection.server.errorHistory.slice(-100)
		}

		// Update current error display
		connection.server.error = truncatedError
	}

	/**
	 * Schedule an auto-reconnect for a disconnected server
	 * Uses exponential backoff to prevent overwhelming the server
	 */
	private scheduleAutoReconnect(name: string, source: "global" | "project"): void {
		// Don't reconnect if disposed
		if (this.isDisposed) {
			return
		}

		const key = `${name}-${source}`

		// Clear any existing reconnect timer
		const existingTimer = this.reconnectTimers.get(key)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}

		// Get current attempt count
		const attempts = this.reconnectAttempts.get(key) || 0

		// Calculate delay with exponential backoff (2s, 4s, 8s, ... up to 30s)
		const delay = Math.min(McpHub.BASE_RECONNECT_DELAY * Math.pow(2, attempts), McpHub.MAX_RECONNECT_DELAY)

		console.log(`[McpHub] Scheduling auto-reconnect for "${name}" in ${delay}ms (attempt ${attempts + 1})`)

		const timer = setTimeout(async () => {
			// Don't reconnect if disposed
			if (this.isDisposed) {
				return
			}

			// Check if server still exists and is disconnected
			const connection = this.findConnection(name, source)
			if (!connection) {
				console.log(`[McpHub] Server "${name}" no longer exists, cancelling reconnect`)
				this.reconnectAttempts.delete(key)
				return
			}

			if (connection.server.status === "connected") {
				console.log(`[McpHub] Server "${name}" already connected, cancelling reconnect`)
				this.reconnectAttempts.delete(key)
				return
			}

			if (connection.server.disabled) {
				console.log(`[McpHub] Server "${name}" is disabled, cancelling reconnect`)
				this.reconnectAttempts.delete(key)
				return
			}

			// Increment attempt counter
			this.reconnectAttempts.set(key, attempts + 1)

			try {
				console.log(`[McpHub] Auto-reconnecting to "${name}"...`)

				// For built-in SSE servers, use restartConnection to properly restart the server process
				const builtInSseServers = ["UIDesignCanvas", "PenpotMCP"]
				if (builtInSseServers.includes(name)) {
					console.log(`[McpHub] Using restartConnection for built-in SSE server "${name}"`)
					await this.restartConnection(name, source)
					this.reconnectAttempts.delete(key)
					console.log(`[McpHub] Auto-reconnect to "${name}" successful`)
					return
				}

				// Read config from the connection BEFORE deleting
				const config = JSON.parse(connection.server.config)
				const validatedConfig = this.validateServerConfig(config, name)

				// Close the old transport/client but keep server info for retry
				try {
					if (connection.type === "connected") {
						await connection.transport.close().catch(() => {})
						await connection.client.close().catch(() => {})
					}
				} catch {
					// Ignore close errors
				}

				// Remove from connections array
				this.connections = this.connections.filter(
					(conn) => !(conn.server.name === name && conn.server.source === source),
				)

				// Try to connect
				await this.connectToServer(name, validatedConfig, source)

				// Success - reset attempt counter
				this.reconnectAttempts.delete(key)
				console.log(`[McpHub] Auto-reconnect to "${name}" successful`)
			} catch (error) {
				console.error(`[McpHub] Auto-reconnect to "${name}" failed:`, error)

				// Re-add a placeholder connection so findConnection works for next retry
				const existingConnection = this.findConnection(name, source)
				if (!existingConnection) {
					// Create a placeholder disconnected connection
					const config = connection.server.config
					this.connections.push({
						type: "disconnected",
						server: {
							name,
							config,
							status: "disconnected",
							error: error instanceof Error ? error.message : String(error),
							source,
						},
						client: null,
						transport: null,
					})
					await this.notifyWebviewOfServerChanges()
				}

				// Schedule another reconnect attempt
				this.scheduleAutoReconnect(name, source)
			}
		}, delay)

		this.reconnectTimers.set(key, timer)
	}

	/**
	 * Reset reconnect attempts for a server (called on successful manual reconnect)
	 */
	private resetReconnectAttempts(name: string, source: "global" | "project"): void {
		const key = `${name}-${source}`
		this.reconnectAttempts.delete(key)
		const timer = this.reconnectTimers.get(key)
		if (timer) {
			clearTimeout(timer)
			this.reconnectTimers.delete(key)
		}
	}

	/**
	 * Helper method to find a connection by server name and source
	 * @param serverName The name of the server to find
	 * @param source Optional source to filter by (global or project)
	 * @returns The matching connection or undefined if not found
	 */
	private findConnection(serverName: string, source?: "global" | "project"): McpConnection | undefined {
		// If source is specified, only find servers with that source
		if (source !== undefined) {
			return this.connections.find((conn) => conn.server.name === serverName && conn.server.source === source)
		}

		// If no source is specified, first look for project servers, then global servers
		// This ensures that when servers have the same name, project servers are prioritized
		const projectConn = this.connections.find(
			(conn) => conn.server.name === serverName && conn.server.source === "project",
		)
		if (projectConn) return projectConn

		// If no project server is found, look for global servers
		return this.connections.find(
			(conn) => conn.server.name === serverName && (conn.server.source === "global" || !conn.server.source),
		)
	}

	/**
	 * Find a connection by sanitized server name.
	 * This is used when parsing MCP tool responses where the server name has been
	 * sanitized (e.g., hyphens replaced with underscores) for API compliance.
	 * @param sanitizedServerName The sanitized server name from the API tool call
	 * @returns The original server name if found, or null if no match
	 */
	public findServerNameBySanitizedName(sanitizedServerName: string): string | null {
		const exactMatch = this.connections.find((conn) => conn.server.name === sanitizedServerName)
		if (exactMatch) {
			return exactMatch.server.name
		}

		return this.sanitizedNameRegistry.get(sanitizedServerName) ?? null
	}

	private async fetchToolsList(serverName: string, source?: "global" | "project"): Promise<McpTool[]> {
		try {
			// Use the helper method to find the connection
			const connection = this.findConnection(serverName, source)

			if (!connection || connection.type !== "connected") {
				return []
			}

			const response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema)

			// Determine the actual source of the server
			const actualSource = connection.server.source || "global"
			let configPath: string
			let alwaysAllowConfig: string[] = []
			let disabledToolsList: string[] = []

			// Read from the appropriate config file based on the actual source
			try {
				let serverConfigData: Record<string, any> = {}
				if (actualSource === "project") {
					// Get project MCP config path
					const projectMcpPath = await this.getProjectMcpPath()
					if (projectMcpPath) {
						configPath = projectMcpPath
						const content = await fs.readFile(configPath, "utf-8")
						serverConfigData = JSON.parse(content)
					}
				} else {
					// Get global MCP settings path
					configPath = await this.getMcpSettingsFilePath()
					const content = await fs.readFile(configPath, "utf-8")
					serverConfigData = JSON.parse(content)
				}
				if (serverConfigData) {
					alwaysAllowConfig = serverConfigData.mcpServers?.[serverName]?.alwaysAllow || []
					disabledToolsList = serverConfigData.mcpServers?.[serverName]?.disabledTools || []
				}

				// For built-in TalkToFigma server, always disable connection tools
				// These tools are handled automatically by the extension and should not be called by AI
				if (serverName === "TalkToFigma") {
					const builtInDisabledTools = ["join_channel", "get_channel"]
					for (const tool of builtInDisabledTools) {
						if (!disabledToolsList.includes(tool)) {
							disabledToolsList.push(tool)
						}
					}
					console.log(`[McpHub] TalkToFigma disabled tools: ${disabledToolsList.join(", ")}`)
				}
			} catch (error) {
				console.error(`Failed to read tool configuration for ${serverName}:`, error)
				// Continue with empty configs
			}

			// Mark tools as always allowed and enabled for prompt based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				alwaysAllow: alwaysAllowConfig.includes(tool.name),
				enabledForPrompt: !disabledToolsList.includes(tool.name),
			}))

			return tools
		} catch (error) {
			console.error(`Failed to fetch tools for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourcesList(serverName: string, source?: "global" | "project"): Promise<McpResource[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema)
			return response?.resources || []
		} catch (error) {
			// console.error(`Failed to fetch resources for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourceTemplatesList(
		serverName: string,
		source?: "global" | "project",
	): Promise<McpResourceTemplate[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
			)
			return response?.resourceTemplates || []
		} catch (error) {
			// console.error(`Failed to fetch resource templates for ${serverName}:`, error)
			return []
		}
	}

	async deleteConnection(name: string, source?: "global" | "project"): Promise<void> {
		// Clean up file watchers for this server
		this.removeFileWatchersForServer(name)

		// If source is provided, only delete connections from that source
		const connections = source
			? this.connections.filter((conn) => conn.server.name === name && conn.server.source === source)
			: this.connections.filter((conn) => conn.server.name === name)

		for (const connection of connections) {
			try {
				if (connection.type === "connected") {
					// For TalkToFigma or figma-write, try graceful shutdown first, then forceful kill
					const isFigmaServer = name === "TalkToFigma" || name === "figma-write"
					if (isFigmaServer) {
						try {
							const transport = connection.transport as any
							const proc = transport._process || transport.process
							if (proc) {
								// First try SIGTERM for graceful shutdown
								console.log(`[McpHub] Sending SIGTERM to ${name} process (pid: ${proc.pid})`)
								proc.kill("SIGTERM")

								// Wait a bit for graceful shutdown
								await new Promise((resolve) => setTimeout(resolve, 1000))

								// If process is still running, force kill
								try {
									// Check if process is still alive by sending signal 0
									proc.kill(0)
									console.log(`[McpHub] Process still running, sending SIGKILL to ${name} process (pid: ${proc.pid})`)
									proc.kill("SIGKILL")
								} catch {
									// Process already exited - good
									console.log(`[McpHub] ${name} process exited gracefully`)
								}
							}
						} catch (killError) {
							console.log(`[McpHub] Could not access ${name} process for kill:`, killError)
						}
						// Also clean up port 3055 which is used by the WebSocket server
						// This handles orphaned child processes that might still hold the port
						await killProcessOnPort(3055)
					}
					await connection.transport.close()
					await connection.client.close()
				}
			} catch (error) {
				console.error(`Failed to close transport for ${name}:`, error)
			}
		}

		// Remove the connections from the array
		this.connections = this.connections.filter((conn) => {
			if (conn.server.name !== name) return true
			if (source && conn.server.source !== source) return true
			return false
		})

		// Remove from sanitized name registry if no more connections with this name exist
		const remainingConnections = this.connections.filter((conn) => conn.server.name === name)
		if (remainingConnections.length === 0) {
			const sanitizedName = sanitizeMcpName(name)
			this.sanitizedNameRegistry.delete(sanitizedName)
		}
	}

	async updateServerConnections(
		newServers: Record<string, any>,
		source: "global" | "project" = "global",
		manageConnectingState: boolean = true,
	): Promise<void> {
		if (manageConnectingState) {
			this.isConnecting = true
		}
		this.removeAllFileWatchers()
		// Filter connections by source
		const currentConnections = this.connections.filter(
			(conn) => conn.server.source === source || (!conn.server.source && source === "global"),
		)
		const currentNames = new Set(currentConnections.map((conn) => conn.server.name))
		const newNames = new Set(Object.keys(newServers))

		// Delete removed servers
		for (const name of currentNames) {
			if (!newNames.has(name)) {
				await this.deleteConnection(name, source)
			}
		}

		// Update or add servers
		for (const [name, config] of Object.entries(newServers)) {
			// Only consider connections that match the current source
			const currentConnection = this.findConnection(name, source)

			// Validate and transform the config
			let validatedConfig: z.infer<typeof ServerConfigSchema>
			try {
				validatedConfig = this.validateServerConfig(config, name)
			} catch (error) {
				this.showErrorMessage(`Invalid configuration for MCP server "${name}"`, error)
				continue
			}

			if (!currentConnection) {
				// New server
				try {
					// Only setup file watcher for enabled servers
					if (!validatedConfig.disabled) {
						this.setupFileWatcher(name, validatedConfig, source)
					}
					await this.connectToServer(name, validatedConfig, source)
				} catch (error) {
					this.showErrorMessage(`Failed to connect to new MCP server ${name}`, error)
				}
			} else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed config
				try {
					// Only setup file watcher for enabled servers
					if (!validatedConfig.disabled) {
						this.setupFileWatcher(name, validatedConfig, source)
					}
					await this.deleteConnection(name, source)
					await this.connectToServer(name, validatedConfig, source)
				} catch (error) {
					this.showErrorMessage(`Failed to reconnect MCP server ${name}`, error)
				}
			}
			// If server exists with same config, do nothing
		}
		await this.notifyWebviewOfServerChanges()
		if (manageConnectingState) {
			this.isConnecting = false
		}
	}

	private setupFileWatcher(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project" = "global",
	) {
		// Initialize an empty array for this server if it doesn't exist
		if (!this.fileWatchers.has(name)) {
			this.fileWatchers.set(name, [])
		}

		const watchers = this.fileWatchers.get(name) || []

		// Only stdio type has args
		if (config.type === "stdio") {
			// Setup watchers for custom watchPaths if defined
			if (config.watchPaths && config.watchPaths.length > 0) {
				const watchPathsWatcher = chokidar.watch(config.watchPaths, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true,
				})

				watchPathsWatcher.on("change", async (changedPath) => {
					try {
						// Pass the source from the config to restartConnection
						await this.restartConnection(name, source)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${changedPath}:`, error)
					}
				})

				watchers.push(watchPathsWatcher)
			}

			// Also setup the fallback build/index.js watcher if applicable
			const filePath = config.args?.find((arg: string) => arg.includes("build/index.js"))
			if (filePath) {
				// we use chokidar instead of onDidSaveTextDocument because it doesn't require the file to be open in the editor
				const indexJsWatcher = chokidar.watch(filePath, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true, // This helps with atomic writes
				})

				indexJsWatcher.on("change", async () => {
					try {
						// Pass the source from the config to restartConnection
						await this.restartConnection(name, source)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${filePath}:`, error)
					}
				})

				watchers.push(indexJsWatcher)
			}

			// Update the fileWatchers map with all watchers for this server
			if (watchers.length > 0) {
				this.fileWatchers.set(name, watchers)
			}
		}
	}

	private removeAllFileWatchers() {
		this.fileWatchers.forEach((watchers) => watchers.forEach((watcher) => watcher.close()))
		this.fileWatchers.clear()
	}

	private removeFileWatchersForServer(serverName: string) {
		const watchers = this.fileWatchers.get(serverName)
		if (watchers) {
			watchers.forEach((watcher) => watcher.close())
			this.fileWatchers.delete(serverName)
		}
	}

	async restartConnection(serverName: string, source?: "global" | "project"): Promise<void> {
		this.isConnecting = true

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			this.isConnecting = false
			return
		}

		// Special handling for built-in figma-write server
		if (serverName === "figma-write") {
			vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }))
			// Reset Figma channel connection state
			this.resetFigmaChannelConnection()
			await delay(500)
			// Delete existing connection first
			await this.deleteConnection(serverName, source)
			// Ensure port 3055 is free before restarting
			await killProcessOnPort(3055)
			// Re-initialize the built-in server
			const provider = this.providerRef.deref()
			if (provider) {
				await this.initializeBuiltInFigmaWriteServer(provider)
			}
			await this.notifyWebviewOfServerChanges()
			this.isConnecting = false
			return
		}

		// Special handling for built-in TalkToFigma server
		if (serverName === "TalkToFigma") {
			vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }))
			// Reset Figma channel connection state
			this.resetFigmaChannelConnection()
			// Reset initialization tracking to allow re-initialization
			this.talkToFigmaInitializing = false
			this.lastTalkToFigmaInitTime = 0

			// Delete existing connection first - this should kill the process
			await this.deleteConnection(serverName, source)

			// Wait longer for the process to fully terminate and release the port
			await delay(3000)

			// Re-initialize with retry for EADDRINUSE
			const maxRetries = 3
			let lastError: Error | undefined
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					// Ensure port 3055 is free before each attempt
					console.log(`[McpHub] Ensuring port 3055 is free before attempt ${attempt}/${maxRetries}`)
					await killProcessOnPort(3055)

					console.log(`[McpHub] Attempting to restart TalkToFigma (attempt ${attempt}/${maxRetries})`)
					await this.initializeBuiltInTalkToFigmaServer()
					await this.notifyWebviewOfServerChanges()
					this.isConnecting = false
					return
				} catch (error) {
					lastError = error instanceof Error ? error : new Error(String(error))
					console.error(`[McpHub] TalkToFigma restart attempt ${attempt} failed:`, error)
					if (attempt < maxRetries && lastError.message.includes("EADDRINUSE")) {
						// Wait longer between retries (exponential backoff)
						const waitTime = 2000 * attempt
						console.log(`[McpHub] Waiting ${waitTime}ms before retry...`)
						await delay(waitTime)
					}
				}
			}
			// All retries failed
			vscode.window.showErrorMessage(`TalkToFigma 伺服器重啟失敗: ${lastError?.message || "Unknown error"}`)
			this.isConnecting = false
			return
		}

		// Special handling for built-in UIDesignCanvas server
		if (serverName === "UIDesignCanvas") {
			console.log("[McpHub] Restarting built-in UIDesignCanvas server")
			vscode.window.showInformationMessage("正在重新連接 UI Design Canvas 伺服器... (Reconnecting to UI Design Canvas server...)")

			// Stop existing server and delete connection
			try {
				await this.stopUIDesignCanvasServer()
			} catch (stopError) {
				console.log("[McpHub] Error stopping UIDesignCanvas (ignoring):", stopError)
			}

			try {
				await this.deleteConnection(serverName, source)
			} catch (deleteError) {
				console.log("[McpHub] Error disconnecting UIDesignCanvas (ignoring):", deleteError)
			}

			// Wait a bit for port to be released
			await delay(1000)

			// Re-initialize the built-in server
			try {
				await this.initializeBuiltInUIDesignCanvasServer()
				vscode.window.showInformationMessage("UI Design Canvas 伺服器連接成功！(UI Design Canvas server connected!)")
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				console.error("[McpHub] UIDesignCanvas reconnection failed:", errorMsg)
				vscode.window.showErrorMessage(`UI Design Canvas 連接失敗: ${errorMsg}`)
			}

			await this.notifyWebviewOfServerChanges()
			this.isConnecting = false
			return
		}

		// Special handling for built-in PenpotMCP server
		if (serverName === "PenpotMCP") {
			console.log("[McpHub] Restarting built-in PenpotMCP server")
			vscode.window.showInformationMessage("正在重新連接 Penpot MCP 伺服器... (Reconnecting to Penpot MCP server...)")

			// Stop existing server and delete connection
			try {
				await this.stopPenpotServer()
			} catch (stopError) {
				console.log("[McpHub] Error stopping PenpotMCP (ignoring):", stopError)
			}

			try {
				await this.deleteConnection(serverName, source)
			} catch (deleteError) {
				console.log("[McpHub] Error disconnecting PenpotMCP (ignoring):", deleteError)
			}

			// Wait a bit for ports to be released
			await delay(1000)

			// Re-initialize the built-in server
			try {
				await this.initializeBuiltInPenpotServer()
				vscode.window.showInformationMessage("Penpot MCP 伺服器連接成功！(Penpot MCP server connected!)")
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				console.error("[McpHub] PenpotMCP reconnection failed:", errorMsg)
				vscode.window.showErrorMessage(`Penpot MCP 連接失敗: ${errorMsg}`)
			}

			await this.notifyWebviewOfServerChanges()
			this.isConnecting = false
			return
		}

		// Special handling for built-in MCP-UI server
		if (serverName === "MCP-UI") {
			console.log("[McpHub] Manually restarting built-in MCP-UI server")
			vscode.window.showInformationMessage("正在重新連接 MCP-UI 伺服器... (Reconnecting to MCP-UI server...)")

			// Delete existing connection first
			try {
				await this.deleteConnection(serverName, source)
			} catch (deleteError) {
				console.log("[McpHub] Error disconnecting MCP-UI (ignoring):", deleteError)
			}

			// Get extension path for built-in server
			const provider = this.providerRef.deref()
			if (!provider) {
				this.isConnecting = false
				return
			}

			try {
				const state = await provider.getState()
				const mcpUiEnabled = state?.mcpUiEnabled ?? true

				if (!mcpUiEnabled) {
					vscode.window.showWarningMessage("MCP-UI 未啟用，請先在設定中啟用。(MCP-UI is not enabled)")
					this.isConnecting = false
					return
				}

				const extensionPath = provider.context?.extensionPath
				if (!extensionPath) {
					vscode.window.showErrorMessage("MCP-UI: Extension path not available")
					this.isConnecting = false
					return
				}

				const serverPath = `${extensionPath}/tools/mcp-ui-server/server.ts`
				const nodeModulesPath = `${extensionPath}/tools/mcp-ui-server/node_modules`
				const tsxPath = `${nodeModulesPath}/tsx/dist/esm/index.mjs`

				const config = {
					command: "node",
					args: ["--import", tsxPath, serverPath],
					type: "stdio" as const,
					timeout: 60,
					alwaysAllow: ["*"] as string[],
					disabledTools: [] as string[],
					cwd: `${extensionPath}/tools/mcp-ui-server`,
					env: {
						...process.env,
						NODE_PATH: nodeModulesPath,
					},
				}

				console.log(`[McpHub] Connecting to built-in MCP-UI server at ${serverPath}`)
				await this.connectToServer("MCP-UI", config, "global")
				vscode.window.showInformationMessage("MCP-UI 伺服器連接成功！(MCP-UI server connected!)")
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				console.error("[McpHub] MCP-UI connection failed:", errorMsg)
				vscode.window.showErrorMessage(`MCP-UI 連接失敗: ${errorMsg}`)
			}

			await this.notifyWebviewOfServerChanges()
			this.isConnecting = false
			return
		}

		// Get existing connection and update its status
		const connection = this.findConnection(serverName, source)
		const config = connection?.server.config
		if (config) {
			vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }))
			connection.server.status = "connecting"
			connection.server.error = ""
			await this.notifyWebviewOfServerChanges()
			await delay(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName, connection.server.source)
				// Parse the config to validate it
				const parsedConfig = JSON.parse(config)
				try {
					// Validate the config
					const validatedConfig = this.validateServerConfig(parsedConfig, serverName)

					// Try to connect again using validated config
					await this.connectToServer(serverName, validatedConfig, connection.server.source || "global")
					vscode.window.showInformationMessage(t("mcp:info.server_connected", { serverName }))
				} catch (validationError) {
					this.showErrorMessage(`Invalid configuration for MCP server "${serverName}"`, validationError)
				}
			} catch (error) {
				this.showErrorMessage(`Failed to restart ${serverName} MCP server connection`, error)
			}
		}

		await this.notifyWebviewOfServerChanges()
		this.isConnecting = false
	}

	public async refreshAllConnections(): Promise<void> {
		if (this.isConnecting) {
			return
		}

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			// Clear all existing connections
			const existingConnections = [...this.connections]
			for (const conn of existingConnections) {
				await this.deleteConnection(conn.server.name, conn.server.source)
			}

			// Still initialize servers to track them, but they won't connect
			await this.initializeMcpServers("global")
			await this.initializeMcpServers("project")

			await this.notifyWebviewOfServerChanges()
			return
		}

		this.isConnecting = true

		try {
			const globalPath = await this.getMcpSettingsFilePath()
			let globalServers: Record<string, any> = {}
			try {
				const globalContent = await fs.readFile(globalPath, "utf-8")
				const globalConfig = JSON.parse(globalContent)
				globalServers = globalConfig.mcpServers || {}
				const globalServerNames = Object.keys(globalServers)
			} catch (error) {
				console.log("Error reading global MCP config:", error)
			}

			const projectPath = await this.getProjectMcpPath()
			let projectServers: Record<string, any> = {}
			if (projectPath) {
				try {
					const projectContent = await fs.readFile(projectPath, "utf-8")
					const projectConfig = JSON.parse(projectContent)
					projectServers = projectConfig.mcpServers || {}
					const projectServerNames = Object.keys(projectServers)
				} catch (error) {
					console.log("Error reading project MCP config:", error)
				}
			}

			// Clear all existing connections first
			const existingConnections = [...this.connections]
			for (const conn of existingConnections) {
				await this.deleteConnection(conn.server.name, conn.server.source)
			}

			// Reset TalkToFigma initialization tracking
			this.talkToFigmaInitializing = false
			this.lastTalkToFigmaInitTime = 0
			this.resetFigmaChannelConnection()

			// Wait for processes to fully terminate and release ports
			await delay(3000)

			// Re-initialize all servers from scratch
			// This ensures proper initialization including fetching tools, resources, etc.
			await this.initializeMcpServers("global")
			await this.initializeMcpServers("project")

			// Re-initialize built-in servers if not already configured
			const provider = this.providerRef.deref()
			if (provider) {
				await this.initializeBuiltInFigmaWriteServer(provider)
			}
			await this.initializeBuiltInTalkToFigmaServer()

			await delay(100)

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage("Failed to refresh MCP servers", error)
		} finally {
			this.isConnecting = false
		}
	}

	private async notifyWebviewOfServerChanges(): Promise<void> {
		// Get global server order from settings file
		const settingsPath = await this.getMcpSettingsFilePath()
		const content = await fs.readFile(settingsPath, "utf-8")
		const config = JSON.parse(content)
		const globalServerOrder = Object.keys(config.mcpServers || {})

		// Get project server order if available
		const projectMcpPath = await this.getProjectMcpPath()
		let projectServerOrder: string[] = []
		if (projectMcpPath) {
			try {
				const projectContent = await fs.readFile(projectMcpPath, "utf-8")
				const projectConfig = JSON.parse(projectContent)
				projectServerOrder = Object.keys(projectConfig.mcpServers || {})
			} catch (error) {
				// Silently continue with empty project server order
			}
		}

		// Sort connections: first project servers in their defined order, then global servers in their defined order
		// This ensures that when servers have the same name, project servers are prioritized
		const sortedConnections = [...this.connections].sort((a, b) => {
			const aIsGlobal = a.server.source === "global" || !a.server.source
			const bIsGlobal = b.server.source === "global" || !b.server.source

			// If both are global or both are project, sort by their respective order
			if (aIsGlobal && bIsGlobal) {
				const indexA = globalServerOrder.indexOf(a.server.name)
				const indexB = globalServerOrder.indexOf(b.server.name)
				return indexA - indexB
			} else if (!aIsGlobal && !bIsGlobal) {
				const indexA = projectServerOrder.indexOf(a.server.name)
				const indexB = projectServerOrder.indexOf(b.server.name)
				return indexA - indexB
			}

			// Project servers come before global servers (reversed from original)
			return aIsGlobal ? 1 : -1
		})

		// Send sorted servers to webview
		const targetProvider: ClineProvider | undefined = this.providerRef.deref()

		if (targetProvider) {
			const serversToSend = sortedConnections.map((connection) => connection.server)

			const message = {
				type: "mcpServers" as const,
				mcpServers: serversToSend,
			}

			try {
				await targetProvider.postMessageToWebview(message)
			} catch (error) {
				console.error("[McpHub] Error calling targetProvider.postMessageToWebview:", error)
			}
		} else {
			console.error(
				"[McpHub] No target provider available (neither from getInstance nor providerRef) - cannot send mcpServers message to webview",
			)
		}
	}

	public async toggleServerDisabled(
		serverName: string,
		disabled: boolean,
		source?: "global" | "project",
	): Promise<void> {
		try {
			// List of built-in servers that don't have config files
			const builtInServers = ["TalkToFigma", "UIDesignCanvas", "Penpot", "MCP-UI"]
			const isBuiltIn = builtInServers.includes(serverName)

			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			const serverSource = connection.server.source || "global"

			// Special handling for built-in servers - save state to extension state instead of file
			if (isBuiltIn) {
				console.log(`[McpHub] Toggling built-in server ${serverName} disabled=${disabled}`)
				
				// Update connection object directly (built-in servers don't use config files)
				connection.server.disabled = disabled
				
				if (disabled && connection.server.status === "connected") {
					// Disconnect the server
					this.removeFileWatchersForServer(serverName)
					await this.deleteConnection(serverName, serverSource)
					console.log(`[McpHub] Built-in server ${serverName} disabled and disconnected`)
				} else if (!disabled && connection.server.status === "disconnected") {
					// Re-enable: delete and reinitialize
					await this.deleteConnection(serverName, serverSource)
					
					// Reinitialize based on server type
					if (serverName === "TalkToFigma") {
						await this.initializeBuiltInTalkToFigmaServer()
					} else if (serverName === "UIDesignCanvas") {
						await this.initializeBuiltInUIDesignCanvasServer()
					} else if (serverName === "Penpot") {
						await this.initializeBuiltInPenpotServer()
					} else if (serverName === "MCP-UI") {
						await this.initializeBuiltInMcpUiServer()
					}
					console.log(`[McpHub] Built-in server ${serverName} re-enabled`)
				}
				
				await this.notifyWebviewOfServerChanges()
				return
			}

			// Non-built-in servers: Update the server config in the appropriate file
			await this.updateServerConfig(serverName, { disabled }, serverSource)

			// Update the connection object
			if (connection) {
				try {
					connection.server.disabled = disabled

					// If disabling a connected server, disconnect it
					if (disabled && connection.server.status === "connected") {
						// Clean up file watchers when disabling
						this.removeFileWatchersForServer(serverName)
						await this.deleteConnection(serverName, serverSource)
						// Re-add as a disabled connection
						// Re-read config from file to get updated disabled state
						const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource)
						await this.connectToServer(serverName, updatedConfig, serverSource)
					} else if (!disabled && connection.server.status === "disconnected") {
						// If enabling a disabled server, connect it
						// Re-read config from file to get updated disabled state
						const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource)
						await this.deleteConnection(serverName, serverSource)
						// When re-enabling, file watchers will be set up in connectToServer
						await this.connectToServer(serverName, updatedConfig, serverSource)
					} else if (connection.server.status === "connected") {
						// Only refresh capabilities if connected
						connection.server.tools = await this.fetchToolsList(serverName, serverSource)
						connection.server.resources = await this.fetchResourcesList(serverName, serverSource)
						connection.server.resourceTemplates = await this.fetchResourceTemplatesList(
							serverName,
							serverSource,
						)
					}
				} catch (error) {
					console.error(`Failed to refresh capabilities for ${serverName}:`, error)
				}
			}

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage(`Failed to update server ${serverName} state`, error)
			throw error
		}
	}

	/**
	 * Helper method to read a server's configuration from the appropriate settings file
	 * @param serverName The name of the server to read
	 * @param source Whether to read from the global or project config
	 * @returns The validated server configuration
	 */
	private async readServerConfigFromFile(
		serverName: string,
		source: "global" | "project" = "global",
	): Promise<z.infer<typeof ServerConfigSchema>> {
		// Determine which config file to read
		let configPath: string
		if (source === "project") {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			configPath = await this.getMcpSettingsFilePath()
		}

		// Ensure the settings file exists and is accessible
		try {
			await fs.access(configPath)
		} catch (error) {
			console.error("Settings file not accessible:", error)
			throw new Error("Settings file not accessible")
		}

		// Read and parse the config file
		const content = await fs.readFile(configPath, "utf-8")
		const config = JSON.parse(content)

		// Validate the config structure
		if (!config || typeof config !== "object") {
			throw new Error("Invalid config structure")
		}

		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			throw new Error("No mcpServers section in config")
		}

		if (!config.mcpServers[serverName]) {
			throw new Error(`Server ${serverName} not found in config`)
		}

		// Validate and return the server config
		return this.validateServerConfig(config.mcpServers[serverName], serverName)
	}

	/**
	 * Helper method to update a server's configuration in the appropriate settings file
	 * @param serverName The name of the server to update
	 * @param configUpdate The configuration updates to apply
	 * @param source Whether to update the global or project config
	 */
	private async updateServerConfig(
		serverName: string,
		configUpdate: Record<string, any>,
		source: "global" | "project" = "global",
	): Promise<void> {
		// Determine which config file to update
		let configPath: string
		if (source === "project") {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			configPath = await this.getMcpSettingsFilePath()
		}

		// Ensure the settings file exists and is accessible
		try {
			await fs.access(configPath)
		} catch (error) {
			console.error("Settings file not accessible:", error)
			throw new Error("Settings file not accessible")
		}

		// Read and parse the config file
		const content = await fs.readFile(configPath, "utf-8")
		const config = JSON.parse(content)

		// Validate the config structure
		if (!config || typeof config !== "object") {
			throw new Error("Invalid config structure")
		}

		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			config.mcpServers = {}
		}

		if (!config.mcpServers[serverName]) {
			config.mcpServers[serverName] = {}
		}

		// Create a new server config object to ensure clean structure
		const serverConfig = {
			...config.mcpServers[serverName],
			...configUpdate,
		}

		// Ensure required fields exist
		if (!serverConfig.alwaysAllow) {
			serverConfig.alwaysAllow = []
		}

		config.mcpServers[serverName] = serverConfig

		// Write the entire config back
		const updatedConfig = {
			mcpServers: config.mcpServers,
		}

		// Set flag to prevent file watcher from triggering server restart
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
		}
		this.isProgrammaticUpdate = true
		try {
			await safeWriteJson(configPath, updatedConfig, { prettyPrint: true })
		} finally {
			// Reset flag after watcher debounce period (non-blocking)
			this.flagResetTimer = setTimeout(() => {
				this.isProgrammaticUpdate = false
				this.flagResetTimer = undefined
			}, 600)
		}
	}

	public async updateServerTimeout(
		serverName: string,
		timeout: number,
		source?: "global" | "project",
	): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			// Update the server config in the appropriate file
			await this.updateServerConfig(serverName, { timeout }, connection.server.source || "global")

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage(`Failed to update server ${serverName} timeout settings`, error)
			throw error
		}
	}

	public async deleteServer(serverName: string, source?: "global" | "project"): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			const serverSource = connection.server.source || "global"
			// Determine config file based on server source
			const isProjectServer = serverSource === "project"
			let configPath: string

			if (isProjectServer) {
				// Get project MCP config path
				const projectMcpPath = await this.getProjectMcpPath()
				if (!projectMcpPath) {
					throw new Error("Project MCP configuration file not found")
				}
				configPath = projectMcpPath
			} else {
				// Get global MCP settings path
				configPath = await this.getMcpSettingsFilePath()
			}

			// Ensure the settings file exists and is accessible
			try {
				await fs.access(configPath)
			} catch (error) {
				throw new Error("Settings file not accessible")
			}

			const content = await fs.readFile(configPath, "utf-8")
			const config = JSON.parse(content)

			// Validate the config structure
			if (!config || typeof config !== "object") {
				throw new Error("Invalid config structure")
			}

			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			// Remove the server from the settings
			if (config.mcpServers[serverName]) {
				delete config.mcpServers[serverName]

				// Write the entire config back
				const updatedConfig = {
					mcpServers: config.mcpServers,
				}

				await safeWriteJson(configPath, updatedConfig, { prettyPrint: true })

				// Update server connections with the correct source
				await this.updateServerConnections(config.mcpServers, serverSource)

				vscode.window.showInformationMessage(t("mcp:info.server_deleted", { serverName }))
			} else {
				vscode.window.showWarningMessage(t("mcp:info.server_not_found", { serverName }))
			}
		} catch (error) {
			this.showErrorMessage(`Failed to delete MCP server ${serverName}`, error)
			throw error
		}
	}

	async readResource(serverName: string, uri: string, source?: "global" | "project"): Promise<McpResourceResponse> {
		const connection = this.findConnection(serverName, source)
		if (!connection || connection.type !== "connected") {
			throw new Error(`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}`)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}
		return await connection.client.request(
			{
				method: "resources/read",
				params: {
					uri,
				},
			},
			ReadResourceResultSchema,
		)
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments?: Record<string, unknown>,
		source?: "global" | "project",
		retryCount: number = 0,
	): Promise<McpToolCallResponse> {
		const maxRetries = 2 // Maximum number of retries for Figma tools
		const isFigmaServer = serverName === "TalkToFigma" || serverName === "figma-write" || serverName.toLowerCase().includes("figma")

		// For TalkToFigma, ensure Figma channel is connected before calling tools (except join_channel itself)
		if (serverName === "TalkToFigma" && toolName !== "join_channel" && !this.figmaChannelConnected) {
			console.log(`[McpHub] Figma channel not connected, prompting user to connect before calling ${toolName}...`)

			// Show info message to user
			vscode.window.showInformationMessage(
				`正在等待 Figma 連接... (Waiting for Figma connection before ${toolName})`
			)

			// Prompt for channel connection and WAIT for result
			const connected = await this.promptTalkToFigmaChannelConnection(false)

			if (!connected) {
				throw new Error(
					`Figma 頻道未連接，無法執行 ${toolName}。請先連接到 Figma 頻道。\n` +
					`(Figma channel not connected. Please connect to Figma channel first before using ${toolName}.)`
				)
			}

			console.log(`[McpHub] Figma channel connected, proceeding with ${toolName}`)
		}

		const connection = this.findConnection(serverName, source)
		if (!connection || connection.type !== "connected") {
			// Check if this is a Figma server and trigger reconnection
			if (isFigmaServer) {
				console.log(`[McpHub] Figma server "${serverName}" not connected, triggering reconnection...`)
				await this.handleFigmaConnectionError(`Server ${serverName} not connected`)

				// Wait for reconnection and retry if this is the first attempt
				if (retryCount < maxRetries) {
					console.log(`[McpHub] Waiting for Figma reconnection before retry (attempt ${retryCount + 1}/${maxRetries})...`)
					await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait 2 seconds for reconnection

					// Check if now connected
					const newConnection = this.findConnection(serverName, source)
					if (newConnection && newConnection.type === "connected") {
						console.log(`[McpHub] Figma reconnected, retrying tool call: ${toolName}`)
						return this.callTool(serverName, toolName, toolArguments, source, retryCount + 1)
					}
				}
			}
			throw new Error(
				`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
			)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled and cannot be used`)
		}

		let timeout: number
		try {
			const parsedConfig = ServerConfigSchema.parse(JSON.parse(connection.server.config))
			timeout = (parsedConfig.timeout ?? 60) * 1000
		} catch (error) {
			console.error("Failed to parse server config for timeout:", error)
			// Default to 60 seconds if parsing fails
			timeout = 60 * 1000
		}

		// Coerce string numbers to actual numbers for Figma tools
		// LLMs often send "400" instead of 400 for numeric fields
		let processedArguments = toolArguments
		// isFigmaServer is already declared at the start of the function
		if (isFigmaServer && toolArguments) {
			processedArguments = this.coerceNumericArguments(toolArguments)
			// For TalkToFigma, also map tool-specific parameters (like fillColor format)
			if (serverName === "TalkToFigma") {
				processedArguments = this.mapTalkToFigmaArguments(toolName, processedArguments)
			}
		}

		// Auto-open Figma preview when AI is about to create elements
		const figmaCreationTools = [
			"create_rectangle",
			"create_frame",
			"create_text",
			"add_text",
			"create_ellipse",
			"create_line",
			"create_polygon",
			"create_star",
			"place_image_base64",
		]
		if (isFigmaServer && figmaCreationTools.includes(toolName) && !this.figmaPreviewAutoOpened) {
			const provider = this.providerRef.deref()
			if (provider) {
				const figmaWebPreviewEnabled = provider.getValue("figmaWebPreviewEnabled")
				const figmaFileUrl = provider.getValue("figmaFileUrl")
				if (figmaWebPreviewEnabled && figmaFileUrl) {
					console.log(`[McpHub] Auto-opening Figma preview for creation tool: ${toolName}`)
					this.figmaPreviewAutoOpened = true
					// Open Figma preview panel directly
					this.openFigmaPreviewPanel(figmaFileUrl, provider.context.extensionUri).catch((error) => {
						console.error("[McpHub] Failed to auto-open Figma preview:", error)
					})
				}
			}
		}

		try {
			// [MCP LOGGING] Log the request
			const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
			console.log(`[MCP-REQ:${requestId}] Server: ${serverName}, Tool: ${toolName}`)
			console.log(`[MCP-REQ:${requestId}] Arguments:`, JSON.stringify(processedArguments, null, 2))
			
			const startTime = Date.now()
			const result = await connection.client.request(
				{
					method: "tools/call",
					params: {
						name: toolName,
						arguments: processedArguments,
					},
				},
				CallToolResultSchema,
				{
					timeout,
				},
			)
			
			// [MCP LOGGING] Log the response
			const duration = Date.now() - startTime
			const resultSummary = result.content?.map((c: any) => {
				if (c.type === "text") return { type: "text", textPreview: (c.text as string).substring(0, 500) }
				if (c.type === "image") return { type: "image", mimeType: c.mimeType }
				return c
			})
			console.log(`[MCP-RES:${requestId}] Duration: ${duration}ms, isError: ${result.isError}`)
			console.log(`[MCP-RES:${requestId}] Content:`, JSON.stringify(resultSummary, null, 2))


			// Check if the result indicates a Figma connection error
			// Only trigger error handling for tool call failures, not for "please join" messages before connection
			if (isFigmaServer && result.content) {
				const textContent = result.content.find((c: { type: string }) => c.type === "text")
				if (textContent && "text" in textContent) {
					const text = (textContent.text as string).toLowerCase()
					console.log(`[McpHub] Figma tool response:`, (textContent.text as string).substring(0, 200))

					// Check for connection error patterns in tool response
					// These indicate the tool call failed due to connection issues
					const isRealError =
						text.includes("not connected") ||
						text.includes("disconnected") ||
						text.includes("channel not found") ||
						text.includes("no channel") ||
						text.includes("join a channel") ||
						text.includes("please join") ||
						text.includes("not joined") ||
						text.includes("websocket error") ||
						text.includes("socket closed") ||
						text.includes("connection lost") ||
						text.includes("failed to send") ||
						text.includes("no active connection") ||
						text.includes("unable to send") ||
						text.includes("connection refused") ||
						text.includes("timeout") ||
						(text.includes("error") && text.includes("connection"))

					if (isRealError) {
						console.log(`[McpHub] Figma connection error detected in response:`, textContent.text)
						// Trigger reconnection and retry if possible
						await this.handleFigmaConnectionError(textContent.text as string)

						// Retry the tool call if we haven't exceeded max retries
						if (retryCount < maxRetries) {
							console.log(`[McpHub] Retrying tool call after connection error (attempt ${retryCount + 1}/${maxRetries})...`)
							await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait 2 seconds
							return this.callTool(serverName, toolName, toolArguments, source, retryCount + 1)
						}
					}
				}
			}

			// Also check if result has isError flag
			if (isFigmaServer && result.isError) {
				const textContent = result.content?.find((c: { type: string }) => c.type === "text")
				const errorText = textContent && "text" in textContent ? (textContent.text as string) : "Unknown error"
				console.log(`[McpHub] Figma tool returned error:`, errorText)
				await this.handleFigmaConnectionError(errorText)

				// Retry the tool call if we haven't exceeded max retries
				if (retryCount < maxRetries) {
					console.log(`[McpHub] Retrying tool call after error (attempt ${retryCount + 1}/${maxRetries})...`)
					await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait 2 seconds
					return this.callTool(serverName, toolName, toolArguments, source, retryCount + 1)
				}
			}

			return result
		} catch (error) {
			// Check if this is a Figma server and the error looks like a connection issue
			if (isFigmaServer) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				console.log(`[McpHub] Figma tool call failed:`, errorMessage)

				// Check for connection-related errors
				const isConnectionError =
					errorMessage.toLowerCase().includes("timeout") ||
					errorMessage.toLowerCase().includes("disconnect") ||
					errorMessage.toLowerCase().includes("socket") ||
					errorMessage.toLowerCase().includes("connection") ||
					errorMessage.toLowerCase().includes("econnrefused") ||
					errorMessage.toLowerCase().includes("not connected")

				if (isConnectionError) {
					// Trigger reconnection and retry
					await this.handleFigmaConnectionError(errorMessage)

					// Retry the tool call if we haven't exceeded max retries
					if (retryCount < maxRetries) {
						console.log(`[McpHub] Retrying tool call after exception (attempt ${retryCount + 1}/${maxRetries})...`)
						await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait 2 seconds
						return this.callTool(serverName, toolName, toolArguments, source, retryCount + 1)
					}
				}
			}
			throw error
		}
	}

	/**
	 * Coerce string numbers to actual numbers in tool arguments
	 * This handles common LLM mistakes where numbers are sent as strings
	 */
	private coerceNumericArguments(args: Record<string, unknown>): Record<string, unknown> {
		const numericFields = [
			"width",
			"height",
			"x",
			"y",
			"fontSize",
			"opacity",
			"cornerRadius",
			"minItems",
			"r",
			"g",
			"b",
		]
		const result: Record<string, unknown> = { ...args }

		for (const [key, value] of Object.entries(args)) {
			if (numericFields.includes(key) && typeof value === "string") {
				const parsed = parseFloat(value)
				if (!isNaN(parsed)) {
					result[key] = parsed
				}
			}
		}

		return result
	}

	/**
	 * Map arguments for TalkToFigma-specific tools
	 * Handles parameter format differences like fillColor (hex string -> RGB object)
	 */
	private mapTalkToFigmaArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
		const result = { ...args }

		// TalkToFigma uses 'parentId' instead of 'parent' for specifying parent frame
		if (result.parent && !result.parentId) {
			result.parentId = result.parent
			delete result.parent
			console.log(`[McpHub] Mapped 'parent' to 'parentId': ${result.parentId}`)
		}

		// Convert color value to RGB object - handles hex strings, JSON strings, and objects
		const toRgbObject = (value: unknown): { r: number; g: number; b: number } | null => {
			// Already an object with r, g, b
			if (typeof value === "object" && value !== null) {
				const obj = value as Record<string, unknown>
				if (typeof obj.r === "number" && typeof obj.g === "number" && typeof obj.b === "number") {
					return { r: obj.r, g: obj.g, b: obj.b }
				}
			}

			// String value - could be hex or JSON
			if (typeof value === "string") {
				const str = value.trim()

				// Try parsing as JSON first (e.g., '{"r": 1, "g": 1, "b": 1}')
				if (str.startsWith("{")) {
					try {
						const parsed = JSON.parse(str)
						if (
							typeof parsed.r === "number" &&
							typeof parsed.g === "number" &&
							typeof parsed.b === "number"
						) {
							return { r: parsed.r, g: parsed.g, b: parsed.b }
						}
					} catch {
						// Not valid JSON, try hex
					}
				}

				// Try parsing as hex color (e.g., '#ffffff' or 'ffffff')
				const cleanHex = str.replace(/^#/, "")
				if (/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
					return {
						r: parseInt(cleanHex.substring(0, 2), 16) / 255,
						g: parseInt(cleanHex.substring(2, 4), 16) / 255,
						b: parseInt(cleanHex.substring(4, 6), 16) / 255,
					}
				}
			}

			return null
		}

		// create_rectangle: TalkToFigma uses 'radius' instead of 'cornerRadius', 'color' instead of 'hex'
		if (toolName === "create_rectangle") {
			// IMPORTANT: Validate width and height to prevent TalkToFigma's 100x100 default
			if (!result.width || typeof result.width !== "number" || result.width <= 0) {
				console.warn(`[McpHub] create_rectangle: Invalid width (${result.width}), setting default 90`)
				result.width = 90
			}
			if (!result.height || typeof result.height !== "number" || result.height <= 0) {
				console.warn(`[McpHub] create_rectangle: Invalid height (${result.height}), setting default 60`)
				result.height = 60
			}
			// Map cornerRadius to radius
			if (result.cornerRadius !== undefined && result.radius === undefined) {
				result.radius = result.cornerRadius
				delete result.cornerRadius
				console.log(`[McpHub] create_rectangle: Mapped cornerRadius to radius: ${result.radius}`)
			}
			// Ensure radius is a number and has minimum value
			if (typeof result.radius === "string") {
				result.radius = parseFloat(result.radius) || 8
			}
			if (result.radius === undefined || result.radius === null || typeof result.radius !== "number" || result.radius < 8) {
				result.radius = 12 // Use 12 as default for better visibility
				console.log(`[McpHub] create_rectangle: Set default radius: ${result.radius}`)
			}
			// Map hex to color (TalkToFigma might expect RGB object)
			if (result.hex && !result.color) {
				// Try sending as hex string first, TalkToFigma may accept it
				result.color = result.hex
				delete result.hex
				console.log(`[McpHub] create_rectangle: Mapped hex to color: ${result.color}`)
			}
			console.log(`[McpHub] create_rectangle FINAL PARAMS:`, JSON.stringify(result))
		}

		// create_frame expects fillColor as RGB object
		if (toolName === "create_frame") {
			if (result.fillColor) {
				const rgb = toRgbObject(result.fillColor)
				if (rgb) {
					console.log(`[McpHub] Converting fillColor to RGB object:`, rgb)
					result.fillColor = rgb
				}
			}
			if (result.color) {
				const rgb = toRgbObject(result.color)
				if (rgb) {
					console.log(`[McpHub] Converting color to fillColor RGB object:`, rgb)
					result.fillColor = rgb
					delete result.color
				}
			}
			if (result.hex) {
				const rgb = toRgbObject(result.hex)
				if (rgb) {
					console.log(`[McpHub] Converting hex to fillColor RGB object:`, rgb)
					result.fillColor = rgb
					delete result.hex
				}
			}
		}

		// create_text expects fontColor as RGB object
		if (toolName === "create_text") {
			if (result.fontColor) {
				const rgb = toRgbObject(result.fontColor)
				if (rgb) {
					console.log(`[McpHub] Converting fontColor to RGB object:`, rgb)
					result.fontColor = rgb
				}
			}
			if (result.color) {
				const rgb = toRgbObject(result.color)
				if (rgb) {
					console.log(`[McpHub] Converting color to fontColor RGB object:`, rgb)
					result.fontColor = rgb
					delete result.color
				}
			}
		}

		// set_fill_color, set_fill, set_text_color expect r, g, b as separate number parameters
		if (toolName === "set_fill_color" || toolName === "set_fill" || toolName === "set_text_color") {
			// If color object is passed instead of r, g, b separately
			if (result.color && typeof result.color === "object") {
				const colorObj = result.color as Record<string, unknown>
				if (colorObj.r !== undefined) result.r = colorObj.r
				if (colorObj.g !== undefined) result.g = colorObj.g
				if (colorObj.b !== undefined) result.b = colorObj.b
				delete result.color
				console.log(`[McpHub] Extracted r, g, b from color object:`, { r: result.r, g: result.g, b: result.b })
			}
			// If color is a string (hex or JSON), convert it
			if (result.color && typeof result.color === "string") {
				const rgb = toRgbObject(result.color)
				if (rgb) {
					result.r = rgb.r
					result.g = rgb.g
					result.b = rgb.b
					delete result.color
					console.log(`[McpHub] Converted color string to r, g, b:`, rgb)
				}
			}
			// Ensure r, g, b are numbers (coerce from string if needed)
			for (const key of ["r", "g", "b"]) {
				if (typeof result[key] === "string") {
					const parsed = parseFloat(result[key] as string)
					if (!isNaN(parsed)) {
						result[key] = parsed
					}
				}
			}
		}

		// get_nodes_info expects nodeIds as array
		if (toolName === "get_nodes_info") {
			if (typeof result.nodeIds === "string") {
				// Try parsing as JSON array
				const str = (result.nodeIds as string).trim()
				if (str.startsWith("[")) {
					try {
						result.nodeIds = JSON.parse(str)
						console.log(`[McpHub] Parsed nodeIds from JSON string:`, result.nodeIds)
					} catch {
						// If not valid JSON, split by comma
						result.nodeIds = str.split(",").map((s: string) => s.trim())
						console.log(`[McpHub] Split nodeIds by comma:`, result.nodeIds)
					}
				} else {
					// Single node ID or comma-separated
					result.nodeIds = str.split(",").map((s: string) => s.trim())
					console.log(`[McpHub] Split nodeIds by comma:`, result.nodeIds)
				}
			}
		}

		// get_node_info - check if nodeId comes under different key
		if (toolName === "get_node_info") {
			if (result.nodeId === undefined) {
				// Try alternative parameter names
				if (result.id) {
					result.nodeId = result.id
					delete result.id
					console.log(`[McpHub] Renamed 'id' to 'nodeId':`, result.nodeId)
				} else if (result.node_id) {
					result.nodeId = result.node_id
					delete result.node_id
					console.log(`[McpHub] Renamed 'node_id' to 'nodeId':`, result.nodeId)
				}
			}
		}

		// set_corner_radius - Handle different parameter names between figma-write and TalkToFigma
		if (toolName === "set_corner_radius") {
			// Get the radius value from any available parameter
			let radiusValue: number = 8
			const rawRadius = result.radius ?? result.cornerRadius
			if (typeof rawRadius === "string") {
				radiusValue = parseFloat(rawRadius) || 8
			} else if (typeof rawRadius === "number") {
				radiusValue = rawRadius
			}
			// Ensure minimum visibility
			if (radiusValue < 8) {
				radiusValue = 8
			}

			// Send BOTH uniform radius AND per-corner parameters for maximum compatibility
			result.radius = radiusValue
			result.cornerRadius = radiusValue
			result.topLeft = radiusValue
			result.topRight = radiusValue
			result.bottomRight = radiusValue
			result.bottomLeft = radiusValue

			console.log(
				`[McpHub] set_corner_radius: radius=${radiusValue}, all corners=${radiusValue} (nodeId: ${result.nodeId})`,
			)
		}

		return result
	}

	/**
	 * Helper method to update a specific tool list (alwaysAllow or disabledTools)
	 * in the appropriate settings file.
	 * @param serverName The name of the server to update
	 * @param source Whether to update the global or project config
	 * @param toolName The name of the tool to add or remove
	 * @param listName The name of the list to modify ("alwaysAllow" or "disabledTools")
	 * @param addTool Whether to add (true) or remove (false) the tool from the list
	 */
	private async updateServerToolList(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		listName: "alwaysAllow" | "disabledTools",
		addTool: boolean,
	): Promise<void> {
		// Find the connection with matching name and source
		const connection = this.findConnection(serverName, source)

		if (!connection) {
			throw new Error(`Server ${serverName} with source ${source} not found`)
		}

		// Determine the correct config path based on the source
		let configPath: string
		if (source === "project") {
			// Get project MCP config path
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			// Get global MCP settings path
			configPath = await this.getMcpSettingsFilePath()
		}

		// Normalize path for cross-platform compatibility
		// Use a consistent path format for both reading and writing
		const normalizedPath = process.platform === "win32" ? configPath.replace(/\\/g, "/") : configPath

		// Read the appropriate config file
		const content = await fs.readFile(normalizedPath, "utf-8")
		const config = JSON.parse(content)

		if (!config.mcpServers) {
			config.mcpServers = {}
		}

		if (!config.mcpServers[serverName]) {
			config.mcpServers[serverName] = {
				type: "stdio",
				command: "node",
				args: [], // Default to an empty array; can be set later if needed
			}
		}

		if (!config.mcpServers[serverName][listName]) {
			config.mcpServers[serverName][listName] = []
		}

		const targetList = config.mcpServers[serverName][listName]
		const toolIndex = targetList.indexOf(toolName)

		if (addTool && toolIndex === -1) {
			targetList.push(toolName)
		} else if (!addTool && toolIndex !== -1) {
			targetList.splice(toolIndex, 1)
		}

		// Set flag to prevent file watcher from triggering server restart
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
		}
		this.isProgrammaticUpdate = true
		try {
			await safeWriteJson(normalizedPath, config, { prettyPrint: true })
		} finally {
			// Reset flag after watcher debounce period (non-blocking)
			this.flagResetTimer = setTimeout(() => {
				this.isProgrammaticUpdate = false
				this.flagResetTimer = undefined
			}, 600)
		}

		if (connection) {
			connection.server.tools = await this.fetchToolsList(serverName, source)
			await this.notifyWebviewOfServerChanges()
		}
	}

	async toggleToolAlwaysAllow(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		shouldAllow: boolean,
	): Promise<void> {
		try {
			await this.updateServerToolList(serverName, source, toolName, "alwaysAllow", shouldAllow)
		} catch (error) {
			this.showErrorMessage(
				`Failed to toggle always allow for tool "${toolName}" on server "${serverName}" with source "${source}"`,
				error,
			)
			throw error
		}
	}

	async toggleToolEnabledForPrompt(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		isEnabled: boolean,
	): Promise<void> {
		try {
			// When isEnabled is true, we want to remove the tool from the disabledTools list.
			// When isEnabled is false, we want to add the tool to the disabledTools list.
			const addToolToDisabledList = !isEnabled
			await this.updateServerToolList(serverName, source, toolName, "disabledTools", addToolToDisabledList)
		} catch (error) {
			this.showErrorMessage(`Failed to update settings for tool ${toolName}`, error)
			throw error // Re-throw to ensure the error is properly handled
		}
	}

	/**
	 * Handles enabling/disabling TalkToFigma MCP server
	 * When disabled, stops the TalkToFigma server; when enabled, starts it
	 * @param enabled Whether TalkToFigma should be enabled or disabled
	 * @returns Promise<void>
	 */
	async handleTalkToFigmaEnabledChange(enabled: boolean): Promise<void> {
		console.log(`[McpHub] handleTalkToFigmaEnabledChange called with enabled=${enabled}`)
		if (!enabled) {
			// If TalkToFigma is being disabled, disconnect the server
			const talkToFigmaConnection = this.connections.find((conn) => conn.server.name === "TalkToFigma")
			if (talkToFigmaConnection) {
				try {
					console.log("[McpHub] Disconnecting TalkToFigma server...")
					await this.deleteConnection("TalkToFigma", talkToFigmaConnection.server.source)
					console.log("[McpHub] TalkToFigma server disconnected successfully")
					// Notify webview of server changes
					await this.notifyWebviewOfServerChanges()
				} catch (error) {
					console.error(`Failed to disconnect TalkToFigma server: ${error}`)
				}
			} else {
				console.log("[McpHub] TalkToFigma server not found, nothing to disconnect")
			}
		} else {
			// If TalkToFigma is being enabled, initialize the server
			console.log("[McpHub] Enabling TalkToFigma server...")
			await this.initializeBuiltInTalkToFigmaServer()
			// Notify webview of server changes
			await this.notifyWebviewOfServerChanges()
		}
	}

	/**
	 * Handles enabling/disabling MCP globally
	 * @param enabled Whether MCP should be enabled or disabled
	 * @returns Promise<void>
	 */
	async handleMcpEnabledChange(enabled: boolean): Promise<void> {
		if (!enabled) {
			// If MCP is being disabled, disconnect all servers with error handling
			const existingConnections = [...this.connections]
			const disconnectionErrors: Array<{ serverName: string; error: string }> = []

			for (const conn of existingConnections) {
				try {
					await this.deleteConnection(conn.server.name, conn.server.source)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					disconnectionErrors.push({
						serverName: conn.server.name,
						error: errorMessage,
					})
					console.error(`Failed to disconnect MCP server ${conn.server.name}: ${errorMessage}`)
				}
			}

			// If there were errors, notify the user
			if (disconnectionErrors.length > 0) {
				const errorSummary = disconnectionErrors.map((e) => `${e.serverName}: ${e.error}`).join("\n")
				vscode.window.showWarningMessage(
					t("mcp:errors.disconnect_servers_partial", {
						count: disconnectionErrors.length,
						errors: errorSummary,
					}),
				)
			}

			// Re-initialize servers to track them in disconnected state
			try {
				await this.refreshAllConnections()
			} catch (error) {
				console.error(`Failed to refresh MCP connections after disabling: ${error}`)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_disable"))
			}
		} else {
			// If MCP is being enabled, reconnect all servers
			try {
				await this.refreshAllConnections()
			} catch (error) {
				console.error(`Failed to refresh MCP connections after enabling: ${error}`)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_enable"))
			}
		}
	}

	async dispose(): Promise<void> {
		// Prevent multiple disposals
		if (this.isDisposed) {
			return
		}

		this.isDisposed = true

		// Clear all debounce timers
		for (const timer of this.configChangeDebounceTimers.values()) {
			clearTimeout(timer)
		}

		this.configChangeDebounceTimers.clear()

		// Clear flag reset timer and reset programmatic update flag
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
			this.flagResetTimer = undefined
		}

		// Clear all reconnect timers
		for (const timer of this.reconnectTimers.values()) {
			clearTimeout(timer)
		}
		this.reconnectTimers.clear()
		this.reconnectAttempts.clear()

		this.isProgrammaticUpdate = false
		this.removeAllFileWatchers()

		// Stop the bundled Penpot MCP server
		await this.stopPenpotServer()

		// Stop the UI Design Canvas MCP server
		await this.stopUIDesignCanvasServer()

		for (const connection of this.connections) {
			try {
				await this.deleteConnection(connection.server.name, connection.server.source)
			} catch (error) {
				console.error(`Failed to close connection for ${connection.server.name}:`, error)
			}
		}

		this.connections = []

		if (this.settingsWatcher) {
			this.settingsWatcher.dispose()
			this.settingsWatcher = undefined
		}

		if (this.projectMcpWatcher) {
			this.projectMcpWatcher.dispose()
			this.projectMcpWatcher = undefined
		}

		this.disposables.forEach((d) => d.dispose())
	}
}
