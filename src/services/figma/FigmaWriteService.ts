/**
 * Figma Write Service
 * 
 * Connects to the external Figma Write Bridge MCP server via its stdio transport.
 * The server must be running externally: cd tools/figma-write-bridge && npm start
 */

import { spawn, ChildProcess } from "child_process"
import * as path from "path"

interface McpToolCallRequest {
	jsonrpc: "2.0"
	id: number
	method: "tools/call"
	params: {
		name: string
		arguments: Record<string, unknown>
	}
}

interface McpResponse {
	jsonrpc: "2.0"
	id: number
	result?: {
		content?: Array<{ type: string; text: string }>
	}
	error?: {
		code: number
		message: string
	}
}

interface FigmaWriteResult {
	success: boolean
	nodeId?: string
	data?: any
	error?: string
}

export class FigmaWriteService {
	private static instance: FigmaWriteService | null = null
	private process: ChildProcess | null = null
	private requestId: number = 0
	private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map()
	private buffer: string = ""
	private initialized: boolean = false
	private extensionPath: string

	private constructor(extensionPath: string) {
		this.extensionPath = extensionPath
	}

	static initialize(extensionPath: string): FigmaWriteService {
		if (!FigmaWriteService.instance) {
			FigmaWriteService.instance = new FigmaWriteService(extensionPath)
		}
		return FigmaWriteService.instance
	}

	static getInstance(): FigmaWriteService | null {
		return FigmaWriteService.instance
	}

	/**
	 * Start the MCP server process
	 */
	async start(): Promise<boolean> {
		if (this.process && !this.process.killed && this.initialized) {
			return true
		}

		try {
			const bridgePath = path.join(this.extensionPath, "tools", "figma-write-bridge")
			const serverPath = path.join(bridgePath, "server.ts")
			const nodeModulesPath = path.join(bridgePath, "node_modules")
			const tsxPath = path.join(nodeModulesPath, "tsx", "dist", "esm", "index.mjs")

			// Use node --import tsx/esm to run the server (same as McpHub)
			this.process = spawn("node", ["--import", tsxPath, serverPath], {
				stdio: ["pipe", "pipe", "pipe"],
				cwd: bridgePath,
				env: {
					...process.env,
					NODE_PATH: nodeModulesPath,
				},
			})

			if (!this.process.stdout || !this.process.stdin) {
				console.error("[FigmaWrite] Failed to create process pipes")
				return false
			}

			// Handle stdout (MCP responses)
			this.process.stdout.on("data", (data: Buffer) => {
				this.buffer += data.toString()
				this.processBuffer()
			})

			// Handle stderr (logs)
			this.process.stderr?.on("data", (data: Buffer) => {
				const msg = data.toString().trim()
				if (msg) {
					console.log("[FigmaWrite]", msg)
				}
			})

			// Handle process exit
			this.process.on("exit", (code) => {
				console.log(`[FigmaWrite] Server exited with code ${code}`)
				this.process = null
				this.initialized = false
			})

			this.process.on("error", (error: Error) => {
				console.error("[FigmaWrite] Server error:", error)
				this.process = null
			})

			// Wait for server to start
			await new Promise((resolve) => setTimeout(resolve, 3000))

			// Initialize the MCP connection
			try {
				const initResponse = await this.sendRawRequest({
					jsonrpc: "2.0",
					id: ++this.requestId,
					method: "initialize",
					params: {
						protocolVersion: "2024-11-05",
						capabilities: {},
						clientInfo: { name: "roo-code", version: "1.0.0" },
					},
				})
				
				if (initResponse.error) {
					console.error("[FigmaWrite] Initialize failed:", initResponse.error)
					return false
				}
				
				this.initialized = true
				console.log("[FigmaWrite] Server initialized successfully")
				return true
			} catch (error) {
				console.error("[FigmaWrite] Initialize error:", error)
				return false
			}
		} catch (error) {
			console.error("[FigmaWrite] Failed to start server:", error)
			return false
		}
	}

	private processBuffer(): void {
		// Handle newline-delimited JSON responses
		const lines = this.buffer.split("\n")
		this.buffer = lines.pop() || ""

		for (const line of lines) {
			if (!line.trim()) continue
			try {
				const response = JSON.parse(line)
				if (response.id !== undefined) {
					const pending = this.pendingRequests.get(response.id)
					if (pending) {
						this.pendingRequests.delete(response.id)
						pending.resolve(response)
					}
				}
			} catch {
				// Skip non-JSON lines (like server logs)
			}
		}
	}

	private async sendRawRequest(request: any): Promise<any> {
		if (!this.process?.stdin) {
			throw new Error("Server not running")
		}

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(request.id)
				reject(new Error("Request timeout"))
			}, 15000)

			this.pendingRequests.set(request.id, {
				resolve: (response) => {
					clearTimeout(timeout)
					resolve(response)
				},
				reject: (error) => {
					clearTimeout(timeout)
					reject(error)
				},
			})

			const message = JSON.stringify(request) + "\n"
			this.process!.stdin!.write(message)
		})
	}

	async isAvailable(): Promise<boolean> {
		if (!this.initialized) {
			return await this.start()
		}
		return this.process !== null && !this.process.killed
	}

	async callTool(toolName: string, args: Record<string, unknown>): Promise<FigmaWriteResult> {
		try {
			if (!await this.isAvailable()) {
				return {
					success: false,
					error: "Figma Write Bridge not available.\n\nPlease ensure:\n1. npm start is running in tools/figma-write-bridge\n2. Figma plugin 'MCP Figma Write Bridge' is active",
				}
			}

			const request: McpToolCallRequest = {
				jsonrpc: "2.0",
				id: ++this.requestId,
				method: "tools/call",
				params: {
					name: toolName,
					arguments: args,
				},
			}

			const response: McpResponse = await this.sendRawRequest(request)

			if (response.error) {
				return {
					success: false,
					error: response.error.message,
				}
			}

			const content = response.result?.content?.[0]?.text || "{}"
			let data: any
			try {
				data = JSON.parse(content)
			} catch {
				data = { raw: content }
			}

			return {
				success: true,
				nodeId: data.nodeId || data.id,
				data,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	stop(): void {
		if (this.process) {
			this.process.kill()
			this.process = null
			this.initialized = false
		}
	}
}

export function getFigmaWriteService(): FigmaWriteService | null {
	return FigmaWriteService.getInstance()
}

export const FIGMA_WRITE_TOOLS = [
	{ name: "create_frame", description: "Create a frame with width/height and optional name/position" },
	{ name: "add_text", description: "Add a text node (param: text, x, y, fontSize)" },
	{ name: "create_rectangle", description: "Create a rectangle (param: width, height, x, y, radius). NOTE: Use set_fill after to apply color!" },
	{ name: "set_position", description: "Move a node to (x,y)" },
	{ name: "group_nodes", description: "Group nodes together" },
	{ name: "set_fill", description: "REQUIRED after create_rectangle! Apply fill color (param: nodeId, hex)" },
	{ name: "find_nodes", description: "Find nodes by type/name" },
	{ name: "set_text_color", description: "Set text color (param: nodeId, hex)" },
	{ name: "delete_node", description: "Delete a node by ID" },
]
