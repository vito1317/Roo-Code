/**
 * Parallel UI Service
 *
 * Manages parallel execution of multiple AI agents for UI drawing.
 * Each agent handles a specific UI component/section independently.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, buildApiHandler } from "../../api"
import { FIGMA_WRITE_TOOLS } from "./FigmaWriteService"
import { ProviderSettings } from "@roo-code/types"
import type { McpHub } from "../mcp/McpHub"

// Type for MCP tool call response
interface McpToolCallResponse {
	content?: Array<{ type: string; text?: string }>
	isError?: boolean
}

export interface UITaskDefinition {
	/** Unique identifier for this task */
	id: string
	/** Description of what UI element/section to draw */
	description: string
	/** Target frame or container name in Figma */
	targetFrame?: string
	/** Position offset for this task's elements */
	position?: { x: number; y: number }
	/** Specific design requirements */
	designSpec?: {
		width?: number
		height?: number
		style?: string
		/** Colors array: [0] = background, [1] = text/accent */
		colors?: string[]
		/** Corner radius for rounded elements */
		cornerRadius?: number
		/** Font size for text */
		fontSize?: number
		/** Text content to display */
		text?: string
	}
}

export interface UITaskResult {
	taskId: string
	success: boolean
	nodeIds: string[]
	error?: string
	duration: number
}

export interface ParallelUIResult {
	success: boolean
	results: UITaskResult[]
	totalDuration: number
	summary: string
}

// System prompt for UI drawing agents
const UI_AGENT_SYSTEM_PROMPT = `You are a UI designer agent. You create UI buttons in Figma.

## MANDATORY FIRST STEP - CREATE RECTANGLE WITH RADIUS
Your FIRST tool call MUST be create_rectangle with the radius parameter. No exceptions.
⚠️ CRITICAL: Always include "radius" parameter for rounded corners!
If you skip this step, the button will have no background - THIS IS A FAILURE.

## CORRECT TOOL SEQUENCE (FOLLOW EXACTLY)
Step 1: create_rectangle (MANDATORY - creates button background with color)
Step 2: add_text (adds CENTERED button label)
Step 3: set_text_color (MUST use WHITE #FFFFFF for dark backgrounds)

## TOOL PARAMETER NAMES (CRITICAL)
- create_rectangle: width, height, x, y, radius (REQUIRED!), hex (for color)
  ⚠️ "radius" is REQUIRED - without it buttons will be square!
- add_text: text (NOT "content"), x, y, fontSize
- set_text_color: nodeId, hex (NOT "color")

## TEXT CENTERING (VERY IMPORTANT)
To center text on a button:
- For width=90, height=60, fontSize=24:
  - Text x = (90 - fontSize) / 2 = ~33
  - Text y = (60 - fontSize) / 2 = ~18
- General formula: x = (width - charWidth) / 2, y = (height - fontSize) / 2
- For single character (like "7"), charWidth ≈ fontSize * 0.6
- For multi-char text, charWidth ≈ fontSize * 0.6 * numChars

## TEXT COLOR RULES (MANDATORY)
- Dark backgrounds (#333333, #1E1E1E, etc) → WHITE text (#FFFFFF)
- Orange backgrounds (#FF9500, #FF6600) → WHITE text (#FFFFFF)
- Light gray backgrounds (#D4D4D4, #E0E0E0) → DARK text (#333333)
- ALWAYS call set_text_color! Never skip this step!

## EXAMPLE FOR BUTTON "7" (width=90, height=60)
Tool call 1: create_rectangle(width=90, height=60, x=0, y=0, radius=8, hex="#333333")  // radius=8 for rounded!
Tool call 2: add_text(text="7", x=35, y=18, fontSize=24)  // CENTERED!
Tool call 3: set_text_color(nodeId=<from step 2>, hex="#FFFFFF")  // WHITE on dark!

## EXAMPLE FOR OPERATOR "+" (width=90, height=60, orange)
Tool call 1: create_rectangle(width=90, height=60, x=0, y=0, radius=8, hex="#FF9500")  // radius=8 for rounded!
Tool call 2: add_text(text="+", x=35, y=18, fontSize=24)  // CENTERED!
Tool call 3: set_text_color(nodeId=<from step 2>, hex="#FFFFFF")  // WHITE on orange!

## FAILURE CONDITIONS
- NO rectangle created = FAILED
- Text not centered = UGLY (calculate position!)
- Wrong text color = UNREADABLE (use WHITE on dark!)

Always start with create_rectangle, CENTER the text, use CORRECT text color!`

export class ParallelUIService {
	private static instance: ParallelUIService | null = null
	private apiConfiguration: ProviderSettings | null = null
	private extensionPath: string = ""
	private mcpHub: McpHub | null = null
	private activeFigmaServer: string = "figma-write"

	/**
	 * Tool name mapping from figma-write to TalkToFigma (cursor-talk-to-figma-mcp)
	 * figma-write tool name → TalkToFigma tool name
	 */
	private static readonly TOOL_MAPPING: Record<string, string> = {
		// Same names
		create_frame: "create_frame",
		create_rectangle: "create_rectangle",
		delete_node: "delete_node",
		// Different names
		add_text: "create_text",
		set_position: "move_node",
		set_fill: "set_fill_color",
		set_text_color: "set_fill_color", // TalkToFigma uses set_fill_color for text color too
		find_nodes: "get_node_info",
		get_file_url: "get_document_info",
		group_nodes: "clone_node", // TalkToFigma doesn't have group_nodes, use clone as fallback
	}

	private constructor() {}

	static getInstance(): ParallelUIService {
		if (!ParallelUIService.instance) {
			ParallelUIService.instance = new ParallelUIService()
		}
		return ParallelUIService.instance
	}

	/**
	 * Configure the service with API settings and McpHub
	 */
	configure(apiConfiguration: ProviderSettings, extensionPath: string, mcpHub?: McpHub): void {
		this.apiConfiguration = apiConfiguration
		this.extensionPath = extensionPath
		if (mcpHub) {
			this.mcpHub = mcpHub
		}
		// Debug logging
		console.log(`[ParallelUI] Configured with:`, {
			provider: apiConfiguration?.apiProvider,
			modelId: apiConfiguration?.apiModelId,
			baseUrl: apiConfiguration?.openAiBaseUrl,
			hasConfig: !!apiConfiguration,
		})
	}

	/**
	 * Map tool name and arguments for the active Figma server
	 * Handles differences between figma-write and TalkToFigma (ai-figma-mcp) APIs
	 *
	 * TalkToFigma tool parameter differences:
	 * - create_text: uses 'text' parameter (same as figma-write's add_text)
	 * - create_rectangle: uses 'color' instead of 'hex', 'radius' instead of 'cornerRadius'
	 * - set_fill_color: uses 'color' instead of 'hex'
	 * - move_node: same params (nodeId, x, y)
	 */
	private mapToolForServer(
		toolName: string,
		args: Record<string, unknown>,
	): { mappedName: string; mappedArgs: Record<string, unknown> } {
		if (this.activeFigmaServer === "figma-write") {
			// figma-write uses our custom API, no mapping needed
			return { mappedName: toolName, mappedArgs: args }
		}

		// TalkToFigma mapping
		const mappedName = ParallelUIService.TOOL_MAPPING[toolName] || toolName
		let mappedArgs = { ...args }

		// TalkToFigma uses 'parentId' instead of 'parent' for specifying parent frame
		if (args.parent && !args.parentId) {
			mappedArgs.parentId = args.parent
			delete mappedArgs.parent
			console.log(`[ParallelUI] Mapped 'parent' to 'parentId': ${args.parent}`)
		}

		// Handle parameter differences for TalkToFigma (ai-figma-mcp)
		switch (toolName) {
			case "add_text":
				// TalkToFigma's create_text uses 'text' parameter (same as add_text)
				// No parameter renaming needed - just map the tool name
				break
			case "create_frame":
				// TalkToFigma's create_frame expects fillColor as RGB object
				if (args.fillColor) {
					const rgb = this.toRgbObject(args.fillColor)
					if (rgb) mappedArgs = { ...mappedArgs, fillColor: rgb }
				}
				if (args.color) {
					const rgb = this.toRgbObject(args.color)
					if (rgb) {
						mappedArgs = { ...mappedArgs, fillColor: rgb }
						delete mappedArgs.color
					}
				}
				if (args.hex) {
					const rgb = this.toRgbObject(args.hex)
					if (rgb) {
						mappedArgs = { ...mappedArgs, fillColor: rgb }
						delete mappedArgs.hex
					}
				}
				break
			case "create_text":
				// TalkToFigma's create_text expects fontColor as RGB object
				if (args.fontColor) {
					const rgb = this.toRgbObject(args.fontColor)
					if (rgb) mappedArgs = { ...mappedArgs, fontColor: rgb }
				}
				if (args.color) {
					const rgb = this.toRgbObject(args.color)
					if (rgb) {
						mappedArgs = { ...mappedArgs, fontColor: rgb }
						delete mappedArgs.color
					}
				}
				break
			case "create_rectangle":
				// TalkToFigma's create_rectangle uses 'color' instead of 'hex'
				if (args.hex && !args.color) {
					mappedArgs = { ...mappedArgs, color: args.hex }
					delete mappedArgs.hex
				}
				// Handle parent/parentId mapping
				if (args.parent && !args.parentId) {
					mappedArgs = { ...mappedArgs, parentId: args.parent }
					delete mappedArgs.parent
				}
				// TalkToFigma uses 'radius' instead of 'cornerRadius'
				if (args.cornerRadius !== undefined && args.radius === undefined) {
					console.log(`[ParallelUI] Mapping cornerRadius=${args.cornerRadius} to radius for TalkToFigma`)
					mappedArgs = { ...mappedArgs, radius: args.cornerRadius }
					delete mappedArgs.cornerRadius
				} else if (args.radius !== undefined) {
					console.log(`[ParallelUI] radius parameter present: ${args.radius}`)
				} else {
					// FALLBACK: If no radius/cornerRadius provided, use default value of 8
					console.log(`[ParallelUI] WARNING: No radius in create_rectangle, adding default radius=8`)
					mappedArgs = { ...mappedArgs, radius: 8 }
				}
				break
			case "set_fill":
			case "set_text_color":
				// TalkToFigma uses 'color' instead of 'hex'
				if (args.hex && !args.color) {
					mappedArgs = { ...mappedArgs, color: args.hex }
					delete mappedArgs.hex
				}
				break
			case "set_position":
				// TalkToFigma's move_node uses same params
				break
		}

		// Coerce string values to proper types for numeric parameters
		mappedArgs = this.coerceArgumentTypes(mappedName, mappedArgs)

		console.log(
			`[ParallelUI] Tool mapping: ${toolName} -> ${mappedName}, args: ${JSON.stringify(args)} -> ${JSON.stringify(mappedArgs)}`,
		)
		return { mappedName, mappedArgs }
	}

	/**
	 * Extract node ID from MCP tool result
	 * Handles different response formats from figma-write and TalkToFigma
	 */
	private extractNodeIdFromResult(result: McpToolCallResponse): string | null {
		try {
			if (!result.content || result.content.length === 0) {
				return null
			}

			const textContent = result.content.find((c) => c.type === "text")
			if (!textContent || textContent.type !== "text") {
				return null
			}

			const text = textContent.text
			if (!text) {
				return null
			}

			// Try to extract node ID from different response formats
			// Format 1: "Created rectangle/text/frame with ID: 53:738" or "with ID: 53:738"
			const withIdMatch = text.match(/with ID[:\s]+(\d+:\d+)/i)
			if (withIdMatch) {
				console.log(`[ParallelUI] Extracted node ID from 'with ID' format: ${withIdMatch[1]}`)
				return withIdMatch[1]
			}

			// Format 2: "Created rectangle "{"id":"53:738",...}"" - JSON embedded in string
			const embeddedJsonMatch = text.match(/"\{[^}]*"id"\s*:\s*"(\d+:\d+)"[^}]*\}"/)
			if (embeddedJsonMatch) {
				console.log(`[ParallelUI] Extracted node ID from embedded JSON: ${embeddedJsonMatch[1]}`)
				return embeddedJsonMatch[1]
			}

			// Format 3: Just extract any Figma node ID pattern (digits:digits)
			const nodeIdMatch = text.match(/"id"\s*:\s*"(\d+:\d+)"/)
			if (nodeIdMatch) {
				console.log(`[ParallelUI] Extracted node ID from id field: ${nodeIdMatch[1]}`)
				return nodeIdMatch[1]
			}

			// Format 4: Try pure JSON parse (for servers that return clean JSON)
			try {
				const data = JSON.parse(text)
				// Try different fields where node ID might be
				// figma-write format: { nodeId: "xxx" } or { id: "xxx" }
				// TalkToFigma format: { id: "xxx" } or { result: { node: { id: "xxx" } } }
				if (data.nodeId) {
					return data.nodeId
				}
				if (data.id && !data.id.includes("-")) {
					// Figma node IDs are like "123:456", not UUIDs
					return data.id
				}
				if (data.result?.node?.id) {
					return data.result.node.id
				}
				if (data.result?.nodeId) {
					return data.result.nodeId
				}
				// For TalkToFigma, check if it returns the node in a different structure
				if (data.node?.id) {
					return data.node.id
				}
			} catch {
				// Not valid JSON, continue with other extraction methods
			}

			// Format 5: Last resort - find any node ID pattern in the text
			const anyNodeIdMatch = text.match(/\b(\d+:\d+)\b/)
			if (anyNodeIdMatch) {
				console.log(`[ParallelUI] Extracted node ID from text pattern: ${anyNodeIdMatch[1]}`)
				return anyNodeIdMatch[1]
			}

			// Log the response for debugging
			console.log(`[ParallelUI] Could not extract node ID from response:`, text.substring(0, 200))
			return null
		} catch (error) {
			console.warn(`[ParallelUI] Failed to parse MCP result:`, error)
			return null
		}
	}

	/**
	 * Scan existing elements in a container to detect duplicates
	 * Returns a list of text contents that already exist
	 */
	private async scanExistingElements(containerFrame?: string): Promise<string[]> {
		if (!this.mcpHub || !this.activeFigmaServer) {
			return []
		}

		try {
			// Try to scan text nodes in the container
			const scanArgs: Record<string, unknown> = containerFrame ? { nodeId: containerFrame } : {}

			const result = await this.mcpHub.callTool(this.activeFigmaServer, "scan_text_nodes", scanArgs)

			if (result.content) {
				const textContent = result.content.find((c: { type: string }) => c.type === "text")
				if (textContent && "text" in textContent) {
					const text = textContent.text as string
					// Extract text contents from the scan result
					// The result might be JSON or a formatted string
					try {
						const data = JSON.parse(text)
						if (Array.isArray(data)) {
							return data
								.map((item: { text?: string; characters?: string }) => item.text || item.characters || "")
								.filter((t: string) => t.length > 0)
						}
						if (data.textNodes && Array.isArray(data.textNodes)) {
							return data.textNodes
								.map((item: { text?: string; characters?: string }) => item.text || item.characters || "")
								.filter((t: string) => t.length > 0)
						}
					} catch {
						// Not JSON, try to extract text content from the string
						const textMatches = text.match(/["']([^"']+)["']/g)
						if (textMatches) {
							return textMatches.map((m: string) => m.replace(/["']/g, "")).filter((t: string) => t.length > 0)
						}
					}
				}
			}
		} catch (error) {
			console.warn(`[ParallelUI] Failed to scan existing elements:`, error)
		}

		return []
	}

	/**
	 * Filter out tasks that would create duplicate elements
	 */
	private filterDuplicateTasks(
		tasks: UITaskDefinition[],
		existingElements: string[],
	): { filteredTasks: UITaskDefinition[]; skippedTasks: UITaskDefinition[] } {
		const existingSet = new Set(existingElements.map((e) => e.toLowerCase().trim()))
		const filteredTasks: UITaskDefinition[] = []
		const skippedTasks: UITaskDefinition[] = []

		for (const task of tasks) {
			const taskText = (task.designSpec?.text || "").toLowerCase().trim()
			if (taskText && existingSet.has(taskText)) {
				skippedTasks.push(task)
			} else {
				filteredTasks.push(task)
			}
		}

		return { filteredTasks, skippedTasks }
	}

	/**
	 * Coerce argument types to match what MCP tools expect
	 * AI models sometimes return numbers as strings in JSON
	 */
	private coerceArgumentTypes(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
		const result = { ...args }

		// Define which parameters should be numbers for each tool
		const numericParams: Record<string, string[]> = {
			create_rectangle: ["width", "height", "x", "y", "cornerRadius", "radius", "opacity"],
			create_frame: ["width", "height", "x", "y"],
			create_text: ["x", "y", "fontSize"],
			add_text: ["x", "y", "fontSize"],
			move_node: ["x", "y"],
			set_position: ["x", "y"],
			set_fill_color: ["opacity", "r", "g", "b"],
			set_fill: ["opacity", "r", "g", "b"],
			set_text_color: ["opacity", "r", "g", "b"],
		}

		// Handle set_fill_color, set_fill, set_text_color - extract r, g, b from color object
		if (toolName === "set_fill_color" || toolName === "set_fill" || toolName === "set_text_color") {
			// If color object is passed instead of r, g, b separately
			if (result.color && typeof result.color === "object") {
				const colorObj = result.color as Record<string, unknown>
				if (colorObj.r !== undefined) result.r = colorObj.r
				if (colorObj.g !== undefined) result.g = colorObj.g
				if (colorObj.b !== undefined) result.b = colorObj.b
				delete result.color
				console.log(`[ParallelUI] Extracted r, g, b from color object:`, {
					r: result.r,
					g: result.g,
					b: result.b,
				})
			}
			// If color is a string (hex or JSON), convert it
			if (result.color && typeof result.color === "string") {
				const rgb = this.toRgbObject(result.color)
				if (rgb) {
					result.r = rgb.r
					result.g = rgb.g
					result.b = rgb.b
					delete result.color
					console.log(`[ParallelUI] Converted color string to r, g, b:`, rgb)
				}
			}
		}

		// Handle get_nodes_info - nodeIds should be an array
		if (toolName === "get_nodes_info") {
			if (typeof result.nodeIds === "string") {
				const str = (result.nodeIds as string).trim()
				if (str.startsWith("[")) {
					try {
						result.nodeIds = JSON.parse(str)
						console.log(`[ParallelUI] Parsed nodeIds from JSON string:`, result.nodeIds)
					} catch {
						result.nodeIds = str.split(",").map((s: string) => s.trim())
						console.log(`[ParallelUI] Split nodeIds by comma:`, result.nodeIds)
					}
				} else {
					result.nodeIds = str.split(",").map((s: string) => s.trim())
					console.log(`[ParallelUI] Split nodeIds by comma:`, result.nodeIds)
				}
			}
		}

		// Handle get_node_info - check alternative parameter names
		if (toolName === "get_node_info") {
			if (result.nodeId === undefined) {
				if (result.id) {
					result.nodeId = result.id
					delete result.id
					console.log(`[ParallelUI] Renamed 'id' to 'nodeId':`, result.nodeId)
				} else if (result.node_id) {
					result.nodeId = result.node_id
					delete result.node_id
					console.log(`[ParallelUI] Renamed 'node_id' to 'nodeId':`, result.nodeId)
				}
			}
		}

		const paramsToCoerce = numericParams[toolName] || []
		for (const param of paramsToCoerce) {
			if (result[param] !== undefined && typeof result[param] === "string") {
				const numValue = parseFloat(result[param] as string)
				if (!isNaN(numValue)) {
					result[param] = numValue
					console.log(`[ParallelUI] Coerced ${param}: "${args[param]}" -> ${numValue}`)
				}
			}
		}

		return result
	}

	/**
	 * Convert hex color string to Figma RGB object format
	 * TalkToFigma (ai-figma-mcp) expects colors as {r, g, b} with values 0-1
	 * @param value Color value - can be hex string, JSON string, or RGB object
	 * @returns RGB object like {r: 0.2, g: 0.2, b: 0.2} or null if invalid
	 */
	private toRgbObject(value: unknown): { r: number; g: number; b: number } | null {
		// Already an object with r, g, b
		if (typeof value === "object" && value !== null) {
			const obj = value as Record<string, unknown>
			if (typeof obj.r === "number" && typeof obj.g === "number" && typeof obj.b === "number") {
				console.log(`[ParallelUI] Color already RGB object:`, obj)
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
					if (typeof parsed.r === "number" && typeof parsed.g === "number" && typeof parsed.b === "number") {
						console.log(`[ParallelUI] Parsed JSON color to RGB:`, parsed)
						return { r: parsed.r, g: parsed.g, b: parsed.b }
					}
				} catch {
					// Not valid JSON, try hex
				}
			}

			// Try parsing as hex color (e.g., '#ffffff' or 'ffffff')
			const cleanHex = str.replace(/^#/, "")
			if (/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
				const r = parseInt(cleanHex.substring(0, 2), 16) / 255
				const g = parseInt(cleanHex.substring(2, 4), 16) / 255
				const b = parseInt(cleanHex.substring(4, 6), 16) / 255
				console.log(
					`[ParallelUI] Converted hex "${str}" to RGB: {r: ${r.toFixed(3)}, g: ${g.toFixed(3)}, b: ${b.toFixed(3)}}`,
				)
				return { r, g, b }
			}
		}

		console.warn(`[ParallelUI] Could not convert color value to RGB:`, value)
		return null
	}

	/**
	 * Execute multiple UI tasks in parallel
	 * @param containerFrame Optional parent frame ID to create all elements inside
	 */
	async executeParallelTasks(
		tasks: UITaskDefinition[],
		onProgress?: (taskId: string, status: string) => void,
		containerFrame?: string,
	): Promise<ParallelUIResult> {
		const startTime = Date.now()

		if (!this.apiConfiguration) {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "Service not configured. Call configure() first.",
			}
		}

		// Check if McpHub is available
		if (!this.mcpHub) {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "McpHub not available. Figma integration requires McpHub connection.",
			}
		}

		// Check if any Figma MCP server is connected (figma-write or TalkToFigma)
		const figmaServer = this.mcpHub
			.getServers()
			.find((s) => (s.name === "figma-write" || s.name === "TalkToFigma") && s.status === "connected")
		if (!figmaServer) {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "No Figma MCP server connected. Please ensure figma-write or TalkToFigma plugin is running.",
			}
		}

		// Store which server we're using for tool calls
		this.activeFigmaServer = figmaServer.name
		console.log(`[ParallelUI] Using Figma server: ${this.activeFigmaServer}`)

		// Check if the provider supports tool use
		// Parallel UI requires models that support function/tool calling
		const provider = this.apiConfiguration.apiProvider
		const modelId = this.apiConfiguration.apiModelId || ""
		// Providers that support tool/function calling
		const supportedProviders = [
			"anthropic",
			"openrouter",
			"bedrock",
			"vertex",
			"openai",
			"openai-compatible",
			"azure",
			"gemini",
			"openai-native",
			"deepseek",
			"mistral",
			"groq",
			"xai",
			"fireworks",
			"litellm",
			"cerebras",
			"sambanova",
		]

		// Log provider info for debugging
		const baseUrl = this.apiConfiguration.openAiBaseUrl?.toLowerCase() || ""
		console.log(`[ParallelUI] Provider: ${provider}, Model: ${modelId}, BaseUrl: ${baseUrl || "(not set)"}`)

		// Check if we should use direct MCP mode (fallback when tool use isn't supported)
		// Local models (ollama, lmstudio) typically don't support tool use well
		const isNativeLocalProvider = provider === "ollama" || provider === "lmstudio"
		const useDirectMcpMode = isNativeLocalProvider || !supportedProviders.includes(provider || "")

		if (useDirectMcpMode) {
			console.log(`[ParallelUI] Using direct MCP mode (provider "${provider}" may not support tool use)`)
			return this.executeTasksDirectMcp(tasks, onProgress, containerFrame)
		}

		console.log(
			`[ParallelUI] Starting ${tasks.length} parallel UI tasks using McpHub${containerFrame ? ` (inside frame ${containerFrame})` : ""}`,
		)

		// Scan existing elements to inform sub-AI about what already exists
		const existingElements = await this.scanExistingElements(containerFrame)
		if (existingElements.length > 0) {
			console.log(`[ParallelUI] Found ${existingElements.length} existing elements in container:`, existingElements)
		}

		// Build color context from all tasks to inform each sub-AI about the overall color scheme
		// This helps sub-AIs understand the design consistency requirements
		const colorContext: { bgColors: string[]; textColors: string[] } = {
			bgColors: [],
			textColors: [],
		}
		for (const task of tasks) {
			if (task.designSpec?.colors) {
				if (task.designSpec.colors[0]) {
					colorContext.bgColors.push(task.designSpec.colors[0])
				}
				if (task.designSpec.colors[1]) {
					colorContext.textColors.push(task.designSpec.colors[1])
				}
			}
		}
		if (colorContext.bgColors.length > 0 || colorContext.textColors.length > 0) {
			console.log(
				`[ParallelUI] Color context: ${[...new Set(colorContext.bgColors)].length} unique bg colors, ` +
					`${[...new Set(colorContext.textColors)].length} unique text colors`,
			)
		}

		// Execute all tasks in parallel using sub-AI agents
		// Pass existing elements info and color context so AI knows what already exists and color scheme
		const taskPromises = tasks.map((task) =>
			this.executeSingleTask(task, onProgress, containerFrame, existingElements, colorContext),
		)

		const results = await Promise.all(taskPromises)

		// Check if all tasks failed due to tool use issues - fallback to direct MCP
		const allFailedToolUse = results.every((r) => !r.success && r.error?.includes("工具調用"))
		if (allFailedToolUse && results.length > 0) {
			console.log(`[ParallelUI] All tasks failed due to tool use issues, falling back to direct MCP mode`)
			return this.executeTasksDirectMcp(tasks, onProgress, containerFrame)
		}

		const totalDuration = Date.now() - startTime
		const successCount = results.filter((r) => r.success).length
		const allNodeIds = results.flatMap((r) => r.nodeIds)

		return {
			success: successCount === tasks.length,
			results,
			totalDuration,
			summary: `Completed ${successCount}/${tasks.length} UI tasks in ${totalDuration}ms. Created ${allNodeIds.length} nodes.`,
		}
	}

	/**
	 * Execute tasks using direct MCP calls (fallback when tool use isn't available)
	 * This mode doesn't use sub-AI agents, instead it creates UI elements directly via MCP
	 */
	private async executeTasksDirectMcp(
		tasks: UITaskDefinition[],
		onProgress?: (taskId: string, status: string) => void,
		containerFrame?: string,
	): Promise<ParallelUIResult> {
		const startTime = Date.now()
		const results: UITaskResult[] = []

		console.log(`[ParallelUI] Direct MCP mode: Creating ${tasks.length} UI elements`)

		// Execute tasks in parallel batches (to avoid overwhelming the MCP server)
		const BATCH_SIZE = 5
		let connectionErrorDetected = false

		for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
			const batch = tasks.slice(i, i + BATCH_SIZE)
			const batchResults = await Promise.all(
				batch.map((task) => this.executeTaskDirectMcp(task, onProgress, containerFrame)),
			)
			results.push(...batchResults)

			// Check if any task failed due to connection error
			const connectionErrors = batchResults.filter((r) => !r.success && this.isConnectionError(r.error))

			if (connectionErrors.length > 0 && !connectionErrorDetected) {
				connectionErrorDetected = true
				console.log(`[ParallelUI] Connection error detected, attempting reconnection...`)

				// Try to reconnect
				const reconnected = await this.handleConnectionError(connectionErrors[0].error)
				if (reconnected) {
					console.log(`[ParallelUI] Reconnected successfully, retrying remaining tasks...`)
					// Continue with remaining tasks after reconnection
				} else {
					console.log(`[ParallelUI] Reconnection failed or cancelled, aborting remaining tasks`)
					// Mark remaining tasks as failed
					for (let j = i + BATCH_SIZE; j < tasks.length; j++) {
						results.push({
							taskId: tasks[j].id,
							success: false,
							nodeIds: [],
							error: "Skipped due to connection failure",
							duration: 0,
						})
					}
					break
				}
			}
		}

		const totalDuration = Date.now() - startTime
		const successCount = results.filter((r) => r.success).length
		const allNodeIds = results.flatMap((r) => r.nodeIds)

		return {
			success: successCount === tasks.length,
			results,
			totalDuration,
			summary: `[Direct MCP] Completed ${successCount}/${tasks.length} UI tasks in ${totalDuration}ms. Created ${allNodeIds.length} nodes.`,
		}
	}

	/**
	 * Check if an error message indicates a connection problem
	 */
	private isConnectionError(errorMessage?: string): boolean {
		if (!errorMessage) return false
		const lowerError = errorMessage.toLowerCase()
		return (
			lowerError.includes("disconnect") ||
			lowerError.includes("timeout") ||
			lowerError.includes("not connected") ||
			lowerError.includes("channel") ||
			lowerError.includes("socket") ||
			lowerError.includes("websocket") ||
			lowerError.includes("econnrefused") ||
			lowerError.includes("connection") ||
			lowerError.includes("failed to") ||
			lowerError.includes("no response")
		)
	}

	/**
	 * Handle connection error by prompting for reconnection
	 */
	private async handleConnectionError(errorMessage?: string): Promise<boolean> {
		if (!this.mcpHub) return false

		console.log(`[ParallelUI] Handling connection error:`, errorMessage)

		// Use McpHub's reconnection handler
		return this.mcpHub.handleFigmaConnectionError(errorMessage)
	}

	/**
	 * Execute a single task using direct MCP calls
	 */
	private async executeTaskDirectMcp(
		task: UITaskDefinition,
		onProgress?: (taskId: string, status: string) => void,
		containerFrame?: string,
	): Promise<UITaskResult> {
		const startTime = Date.now()
		const nodeIds: string[] = []

		try {
			onProgress?.(task.id, "creating (direct)")

			// Extract design specs
			const width = task.designSpec?.width || 90
			const height = task.designSpec?.height || 60
			// SAFETY: Ensure positions are never negative when inside a container frame
			// Negative coordinates would place elements outside the visible frame area
			let posX = task.position?.x || 0
			let posY = task.position?.y || 0
			if (containerFrame) {
				if (posX < 0) {
					console.warn(`[ParallelUI Direct] Task ${task.id} has negative X (${posX}), clamping to 10`)
					posX = 10
				}
				if (posY < 0) {
					console.warn(`[ParallelUI Direct] Task ${task.id} has negative Y (${posY}), clamping to 10`)
					posY = 10
				}
			}
			const bgColor = task.designSpec?.colors?.[0] || "#333333"
			const textColor = task.designSpec?.colors?.[1] || "#FFFFFF"
			const cornerRadius = task.designSpec?.cornerRadius || 8
			const fontSize = task.designSpec?.fontSize || 24
			const textContent = task.designSpec?.text || "?"

			// Calculate text centering
			const textLength = textContent.length
			const estimatedTextWidth = fontSize * 0.6 * textLength
			const textX = posX + Math.floor((width - estimatedTextWidth) / 2)
			const textY = posY + Math.floor((height - fontSize) / 2)

			console.log(`[ParallelUI Direct] Task ${task.id}: Creating button "${textContent}" at (${posX}, ${posY})`)

			// Step 1: Create rectangle (button background)
			const rectArgs: Record<string, unknown> = {
				width,
				height,
				x: posX,
				y: posY,
				cornerRadius,
				hex: bgColor,
			}
			if (containerFrame) {
				rectArgs.parent = containerFrame
			}

			const { mappedName: rectToolName, mappedArgs: rectMappedArgs } = this.mapToolForServer(
				"create_rectangle",
				rectArgs,
			)
			const rectResult = await this.mcpHub!.callTool(this.activeFigmaServer, rectToolName, rectMappedArgs)

			// Extract rect node ID - handle different response formats
			const rectNodeId = this.extractNodeIdFromResult(rectResult)
			if (rectNodeId) {
				nodeIds.push(rectNodeId)
				console.log(`[ParallelUI Direct] Rectangle created with ID: ${rectNodeId}`)

				// Step 1.5: ALWAYS set corner radius explicitly after creating rectangle
				// This ensures rounded corners work regardless of whether create_rectangle supports radius parameter
				if (cornerRadius > 0) {
					try {
						// Send BOTH radius and per-corner parameters for maximum TalkToFigma compatibility
						console.log(
							`[ParallelUI Direct] Setting corner radius ${cornerRadius} for rectangle ${rectNodeId} (server: ${this.activeFigmaServer})`,
						)
						await this.mcpHub!.callTool(this.activeFigmaServer, "set_corner_radius", {
							nodeId: rectNodeId,
							radius: cornerRadius,
							cornerRadius: cornerRadius,
							// Per-corner parameters for TalkToFigma compatibility
							topLeft: cornerRadius,
							topRight: cornerRadius,
							bottomRight: cornerRadius,
							bottomLeft: cornerRadius,
						})
						console.log(
							`[ParallelUI Direct] ✓ Corner radius ${cornerRadius} set successfully for rectangle ${rectNodeId}`,
						)
					} catch (e) {
						console.error(
							`[ParallelUI Direct] ✗ Failed to set corner radius ${cornerRadius} for ${rectNodeId}:`,
							e,
						)
					}
				} else {
					console.log(`[ParallelUI Direct] Skipping corner radius (value is 0 or undefined)`)
				}
			}

			// Step 2: Add text
			const textArgs: Record<string, unknown> = {
				text: textContent,
				x: textX,
				y: textY,
				fontSize,
			}
			if (containerFrame) {
				textArgs.parent = containerFrame
			}

			const { mappedName: textToolName, mappedArgs: textMappedArgs } = this.mapToolForServer("add_text", textArgs)
			const textResult = await this.mcpHub!.callTool(this.activeFigmaServer, textToolName, textMappedArgs)

			// Extract text node ID and set color
			let textNodeId: string | null = this.extractNodeIdFromResult(textResult)
			if (textNodeId) {
				nodeIds.push(textNodeId)
				console.log(`[ParallelUI Direct] Text created with ID: ${textNodeId}`)
			}

			// Step 3: Set text color
			if (textNodeId) {
				const colorArgs: Record<string, unknown> = {
					nodeId: textNodeId,
					hex: textColor,
				}
				const { mappedName: colorToolName, mappedArgs: colorMappedArgs } = this.mapToolForServer(
					"set_text_color",
					colorArgs,
				)
				await this.mcpHub!.callTool(this.activeFigmaServer, colorToolName, colorMappedArgs)
			}

			onProgress?.(task.id, "completed")

			return {
				taskId: task.id,
				success: true,
				nodeIds,
				duration: Date.now() - startTime,
			}
		} catch (error) {
			onProgress?.(task.id, "failed")
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error(`[ParallelUI Direct] Task ${task.id} failed:`, errorMessage)

			// Check if this is a connection error
			if (this.isConnectionError(errorMessage)) {
				console.log(`[ParallelUI Direct] Task ${task.id} failed due to connection error`)
			}

			return {
				taskId: task.id,
				success: false,
				nodeIds,
				error: errorMessage,
				duration: Date.now() - startTime,
			}
		}
	}

	/**
	 * Safely call an MCP tool with connection error detection
	 * Returns the result or throws an error with connection info
	 */
	private async safeMcpToolCall(toolName: string, args: Record<string, unknown>): Promise<McpToolCallResponse> {
		if (!this.mcpHub) {
			throw new Error("McpHub not available - connection lost")
		}

		const { mappedName, mappedArgs } = this.mapToolForServer(toolName, args)

		try {
			const result = await this.mcpHub.callTool(this.activeFigmaServer, mappedName, mappedArgs)

			// Check if result indicates an error
			if (result.content && result.content.length > 0) {
				const textContent = result.content.find((c) => c.type === "text")
				if (textContent && textContent.type === "text") {
					const text = textContent.text.toLowerCase()
					if (text.includes("error") && (text.includes("channel") || text.includes("connect"))) {
						throw new Error(`Figma connection error: ${textContent.text}`)
					}
				}
			}

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error(`[ParallelUI] MCP tool call failed: ${mappedName}`, errorMessage)
			throw error
		}
	}

	/**
	 * Execute a single UI task using an AI agent
	 * @param colorContext Color scheme context containing all colors being used in this session
	 */
	private async executeSingleTask(
		task: UITaskDefinition,
		onProgress?: (taskId: string, status: string) => void,
		containerFrame?: string,
		existingElements?: string[],
		colorContext?: { bgColors: string[]; textColors: string[] },
	): Promise<UITaskResult> {
		const startTime = Date.now()
		const nodeIds: string[] = []

		try {
			onProgress?.(task.id, "starting")

			// Build the prompt for this specific task with color context
			const taskPrompt = this.buildTaskPrompt(task, containerFrame, existingElements, colorContext)

			// Create API handler for this task
			const api = buildApiHandler(this.apiConfiguration!)

			// Make the API call
			await this.callAIForUITask(api, taskPrompt, task, nodeIds, onProgress)

			// Check if any nodes were actually created
			if (nodeIds.length === 0) {
				console.warn(
					`[ParallelUI] Task ${task.id} completed but created 0 nodes - model may not support tool calling`,
				)
				onProgress?.(task.id, "no nodes created")
				return {
					taskId: task.id,
					success: false,
					nodeIds,
					error: "模型未生成工具調用 - 請確認使用支援 tool use 的模型 (如 Claude)",
					duration: Date.now() - startTime,
				}
			}

			onProgress?.(task.id, "completed")

			return {
				taskId: task.id,
				success: true,
				nodeIds,
				duration: Date.now() - startTime,
			}
		} catch (error) {
			onProgress?.(task.id, "failed")
			return {
				taskId: task.id,
				success: false,
				nodeIds,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			}
		}
	}

	/**
	 * Build the prompt for a specific UI task
	 * NOTE: Positions are now ABSOLUTE - we tell the sub-AI exactly where to place elements
	 * If containerFrame is provided, elements will be created inside that frame
	 * @param colorContext Optional color scheme context to inform the sub-AI about overall colors
	 */
	private buildTaskPrompt(
		task: UITaskDefinition,
		containerFrame?: string,
		existingElements?: string[],
		colorContext?: { bgColors: string[]; textColors: string[] },
	): string {
		const width = task.designSpec?.width || 90
		const height = task.designSpec?.height || 60

		// Get absolute position (this is the final position, no offset will be added later)
		const posX = task.position?.x || 0
		const posY = task.position?.y || 0

		// Extract design specs with defaults
		const bgColor = task.designSpec?.colors?.[0] || "#333333"
		const textColor = task.designSpec?.colors?.[1] || "#FFFFFF"
		const cornerRadius = task.designSpec?.cornerRadius || 8
		const fontSize = task.designSpec?.fontSize || 24
		const textContent = task.designSpec?.text || "?"

		// Calculate text centering - text position is relative to rectangle position
		const textLength = textContent.length
		const estimatedTextWidth = fontSize * 0.6 * textLength
		const textX = posX + Math.floor((width - estimatedTextWidth) / 2)
		const textY = posY + Math.floor((height - fontSize) / 2)

		const parentParam = containerFrame ? `, parent="${containerFrame}"` : ""

		// Check if this element already exists
		const elementExists =
			existingElements &&
			existingElements.some((e) => e.toLowerCase().trim() === textContent.toLowerCase().trim())

		console.log(
			`[ParallelUI] Task ${task.id}: text="${textContent}", pos=(${posX}, ${posY}), size=${width}x${height}, textPos=(${textX}, ${textY})${containerFrame ? `, parent=${containerFrame}` : ""}${elementExists ? " [EXISTS]" : ""}, colors: bg=${bgColor}, text=${textColor}`,
		)

		// Simple, direct prompt with EXACT coordinates - sub-AI must use these exact values
		// IMPORTANT: Use "radius" (not "cornerRadius") for TalkToFigma compatibility
		let prompt = `Create a UI element "${textContent}" at EXACT position (${posX}, ${posY})\n\n`

		// Add color context to inform sub-AI about the overall color scheme
		if (colorContext && (colorContext.bgColors.length > 0 || colorContext.textColors.length > 0)) {
			prompt += `🎨 **Color Scheme Context (顏色配置資訊):**\n`
			if (colorContext.bgColors.length > 0) {
				prompt += `- Background colors in use: ${[...new Set(colorContext.bgColors)].join(", ")}\n`
			}
			if (colorContext.textColors.length > 0) {
				prompt += `- Text colors in use: ${[...new Set(colorContext.textColors)].join(", ")}\n`
			}
			prompt += `- YOUR element's colors: Background=${bgColor}, Text=${textColor}\n\n`
		}

		// Handle existing elements - tell AI to delete first or move instead of create duplicate
		if (existingElements && existingElements.length > 0) {
			prompt += `📋 **Existing Elements:** [${existingElements.join(", ")}]\n\n`

			if (elementExists) {
				// Element already exists - instruct AI to DELETE first then create new, or MOVE existing
				prompt += `⚠️ **IMPORTANT: Element "${textContent}" ALREADY EXISTS!**\n`
				prompt += `DO NOT create a duplicate. Choose ONE of these approaches:\n\n`
				prompt += `**Option A (Recommended): Delete existing, then create new**\n`
				prompt += `1. find_nodes to locate the existing "${textContent}" element\n`
				prompt += `2. delete_node with the found nodeId to remove it\n`
				prompt += `3. Then create fresh elements at the new position (continue with normal creation steps below)\n\n`
				prompt += `**Option B: Move existing element**\n`
				prompt += `1. find_nodes to locate existing "${textContent}"\n`
				prompt += `2. move_node to reposition to (${posX}, ${posY})\n\n`
				prompt += `Proceed with Option A (delete then create):\n\n`
			}
		}

		prompt += `⚠️ CRITICAL: You MUST use the EXACT coordinates, colors and parameters provided. Do NOT change ANY values!\n\n`
		prompt += `EXECUTE THESE 3 TOOL CALLS IN ORDER:\n\n`
		prompt += `1. create_rectangle with EXACTLY these parameters:\n`
		prompt += `   - width: ${width}\n`
		prompt += `   - height: ${height}\n`
		prompt += `   - x: ${posX}\n`
		prompt += `   - y: ${posY}\n`
		prompt += `   - radius: ${cornerRadius}  ← REQUIRED for rounded corners!\n`
		prompt += `   - hex: "${bgColor}"  ← EXACT color, do not change!\n`
		if (containerFrame) {
			prompt += `   - parentId: "${containerFrame}"\n`
		}
		prompt += `\n`
		prompt += `2. add_text with: text="${textContent}", x=${textX}, y=${textY}, fontSize=${fontSize}${containerFrame ? `, parentId="${containerFrame}"` : ""}\n\n`
		prompt += `3. set_text_color with: nodeId=<the ID returned from step 2>, hex="${textColor}"  ← EXACT color!\n\n`
		prompt += `⚠️ MANDATORY PARAMETERS - DO NOT SKIP:\n`
		prompt += `- radius=${cornerRadius} is REQUIRED in create_rectangle (creates ${cornerRadius >= Math.min(width, height) / 2 ? "circular" : "rounded"} button)\n`
		prompt += `- All positions, sizes, and COLORS must be EXACT as specified\n`
		prompt += `\nSTART NOW with create_rectangle including radius=${cornerRadius}.`

		return prompt
	}

	/**
	 * Call AI to create UI and execute Figma commands
	 */
	private async callAIForUITask(
		api: ApiHandler,
		prompt: string,
		task: UITaskDefinition,
		nodeIds: string[],
		onProgress?: (taskId: string, status: string) => void,
	): Promise<void> {
		// Build tools list for the AI in OpenAI format
		const tools = FIGMA_WRITE_TOOLS.map((tool) => ({
			type: "function" as const,
			function: {
				name: `figma_${tool.name}`,
				description: tool.description,
				parameters: this.getToolSchema(tool.name),
			},
		}))

		console.log(`[ParallelUI] Task ${task.id} - Tools configured: ${tools.map((t) => t.function.name).join(", ")}`)

		// Make the API call with tool use
		const messages: Anthropic.MessageParam[] = [
			{
				role: "user",
				content: prompt,
			},
		]

		let continueLoop = true
		let iterations = 0
		const maxIterations = 10 // Prevent infinite loops

		while (continueLoop && iterations < maxIterations) {
			iterations++
			onProgress?.(task.id, `iteration ${iterations}`)

			try {
				// DEBUG: Log the request being sent
				console.log(`\n========== [ParallelUI] Task ${task.id} - REQUEST ==========`)
				console.log(`[ParallelUI] System Prompt: ${UI_AGENT_SYSTEM_PROMPT.substring(0, 200)}...`)
				console.log(`[ParallelUI] Messages count: ${messages.length}`)
				console.log(`[ParallelUI] Last message role: ${messages[messages.length - 1]?.role}`)
				console.log(`[ParallelUI] Tools count: ${tools.length}`)
				console.log(`[ParallelUI] Tools: ${JSON.stringify(tools.map((t) => t.function.name))}`)
				console.log(
					`[ParallelUI] Full request metadata:`,
					JSON.stringify(
						{
							taskId: `parallel-ui-${task.id}`,
							tools: tools,
							tool_choice: "auto",
							parallelToolCalls: true,
						},
						null,
						2,
					),
				)
				console.log(`==========================================================\n`)

				// Pass tools in metadata for OpenAI-compatible providers
				// Use "required" to force tool usage on first iteration, then "auto" for subsequent
				const toolChoiceValue = iterations === 1 ? "required" : "auto"
				console.log(`[ParallelUI] Task ${task.id} - Using tool_choice: ${toolChoiceValue}`)

				const stream = api.createMessage(UI_AGENT_SYSTEM_PROMPT, messages, {
					taskId: `parallel-ui-${task.id}`,
					tools: tools,
					tool_choice: toolChoiceValue,
					parallelToolCalls: true,
				})

				let assistantContent: Anthropic.ContentBlock[] = []
				let textContent = ""
				// Track tool calls by index (OpenAI uses index-based streaming)
				const toolCallsByIndex: Map<number, { id: string; name: string; arguments: string }> = new Map()
				const toolCalls: Map<string, { id: string; name: string; arguments: string }> = new Map()

				console.log(`\n========== [ParallelUI] Task ${task.id} - RESPONSE CHUNKS ==========`)
				let chunkCount = 0
				for await (const chunk of stream) {
					chunkCount++
					// DEBUG: Log every chunk received
					console.log(
						`[ParallelUI] Chunk #${chunkCount} type: ${chunk.type}`,
						JSON.stringify(chunk).substring(0, 300),
					)

					if (chunk.type === "text") {
						textContent += chunk.text
					} else if (chunk.type === "tool_call") {
						// Complete tool call (Anthropic format)
						toolCalls.set(chunk.id, {
							id: chunk.id,
							name: chunk.name,
							arguments: chunk.arguments,
						})
					} else if (chunk.type === "tool_call_start") {
						// Start of a streamed tool call (Anthropic format)
						toolCalls.set(chunk.id, {
							id: chunk.id,
							name: chunk.name,
							arguments: "",
						})
					} else if (chunk.type === "tool_call_delta") {
						// Delta for a streamed tool call (Anthropic format)
						const existing = toolCalls.get(chunk.id)
						if (existing) {
							existing.arguments += chunk.delta
						}
					} else if (chunk.type === "tool_call_partial") {
						// OpenAI format: partial tool call with index
						const partialChunk = chunk as {
							type: "tool_call_partial"
							index: number
							id?: string
							name?: string
							arguments?: string
						}
						let existing = toolCallsByIndex.get(partialChunk.index)
						if (!existing) {
							existing = { id: partialChunk.id || `tool-${partialChunk.index}`, name: "", arguments: "" }
							toolCallsByIndex.set(partialChunk.index, existing)
						}
						if (partialChunk.id) existing.id = partialChunk.id
						if (partialChunk.name) existing.name = partialChunk.name
						if (partialChunk.arguments) existing.arguments += partialChunk.arguments
					} else if (chunk.type === "tool_call_end") {
						// Tool call completed - move from index-based to id-based map
						const endChunk = chunk as { type: "tool_call_end"; id: string }
						for (const [, tc] of toolCallsByIndex) {
							if (tc.id === endChunk.id && tc.name) {
								toolCalls.set(tc.id, tc)
							}
						}
					}
				}

				// Also add any remaining partial tool calls that didn't get an end event
				for (const [, tc] of toolCallsByIndex) {
					if (tc.id && tc.name && !toolCalls.has(tc.id)) {
						toolCalls.set(tc.id, tc)
					}
				}

				// DEBUG: Summary of what was received
				console.log(`\n========== [ParallelUI] Task ${task.id} - RESPONSE SUMMARY ==========`)
				console.log(`[ParallelUI] Total chunks received: ${chunkCount}`)
				console.log(`[ParallelUI] Text content length: ${textContent.length}`)
				console.log(`[ParallelUI] Tool calls by index: ${toolCallsByIndex.size}`)
				console.log(`[ParallelUI] Tool calls collected: ${toolCalls.size}`)
				if (toolCallsByIndex.size > 0) {
					console.log(`[ParallelUI] Tool calls by index details:`)
					for (const [idx, tc] of toolCallsByIndex) {
						console.log(
							`  [${idx}] id=${tc.id}, name=${tc.name}, args=${tc.arguments.substring(0, 100)}...`,
						)
					}
				}
				if (toolCalls.size > 0) {
					console.log(`[ParallelUI] Final tool calls:`)
					for (const [id, tc] of toolCalls) {
						console.log(`  [${id}] name=${tc.name}, args=${tc.arguments.substring(0, 100)}...`)
					}
				}
				console.log(`==========================================================\n`)

				// Add text content if any
				if (textContent) {
					assistantContent.push({ type: "text", text: textContent } as Anthropic.ContentBlock)
					console.log(
						`[ParallelUI] Task ${task.id} - AI responded with text: ${textContent.substring(0, 200)}...`,
					)
				}

				// Convert tool calls to ContentBlocks
				console.log(`[ParallelUI] Task ${task.id} - Tool calls received: ${toolCalls.size}`)
				for (const [, toolCall] of toolCalls) {
					try {
						console.log(
							`[ParallelUI] Task ${task.id} - Tool call: ${toolCall.name}(${toolCall.arguments.substring(0, 100)}...)`,
						)
						assistantContent.push({
							type: "tool_use",
							id: toolCall.id,
							name: toolCall.name,
							input: JSON.parse(toolCall.arguments || "{}"),
						})
					} catch {
						console.warn(`[ParallelUI] Failed to parse tool arguments: ${toolCall.arguments}`)
					}
				}

				// Process tool calls
				const toolUseBlocks = assistantContent.filter(
					(block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
				)

				if (toolUseBlocks.length === 0) {
					// No tool calls - this often means the model doesn't support tool use
					console.warn(
						`[ParallelUI] Task ${task.id} - No tool calls generated on iteration ${iterations}. Model may not support tool use.`,
					)
					console.warn(`[ParallelUI] Task ${task.id} - Text response was: ${textContent.substring(0, 500)}`)

					// If this is the first iteration and no tool calls, the model likely doesn't support tool use
					if (iterations === 1) {
						console.error(
							`[ParallelUI] Task ${task.id} - CRITICAL: First iteration produced no tool calls. Model "${this.apiConfiguration?.apiModelId}" likely does not support native tool calling.`,
						)
						throw new Error(
							`模型 "${this.apiConfiguration?.apiModelId}" 未生成任何工具調用。\n` +
								`並行 UI 功能需要支援原生 tool use 的模型 (如 Claude Sonnet/Opus)。\n` +
								`請切換到 Anthropic Claude 或其他支援工具調用的模型。`,
						)
					}
					continueLoop = false
					break
				}

				// Execute tool calls in parallel using McpHub
				const toolResults = await Promise.all(
					toolUseBlocks.map(async (toolUse) => {
						const toolName = toolUse.name.replace("figma_", "")
						const args = toolUse.input as Record<string, unknown>

						// Log the position being used (positions are now absolute from buildTaskPrompt)
						const positioningTools = ["create_rectangle", "add_text", "create_frame", "set_position"]
						if (positioningTools.includes(toolName)) {
							console.log(
								`[ParallelUI] Task ${task.id} - ${toolName} at position: (${args.x}, ${args.y})`,
							)
						}

						onProgress?.(task.id, `calling ${toolName}`)

						try {
							// Map tool name and args based on active server
							const { mappedName, mappedArgs } = this.mapToolForServer(toolName, args)
							console.log(`[ParallelUI] Using ${this.activeFigmaServer}.${mappedName}`)

							// Use McpHub to execute the tool call
							const mcpResult = await this.mcpHub!.callTool(
								this.activeFigmaServer,
								mappedName,
								mappedArgs,
							)

							// Parse the result - use robust extraction like extractNodeIdFromResult
							let resultData: any = {}
							let createdNodeId: string | null = null

							if (mcpResult.content && mcpResult.content.length > 0) {
								const textContentBlock = mcpResult.content.find((c) => c.type === "text")
								if (textContentBlock && textContentBlock.type === "text") {
									const text = textContentBlock.text

									// Try JSON parse first
									try {
										resultData = JSON.parse(text)
										createdNodeId =
											resultData.nodeId ||
											resultData.id ||
											resultData.result?.nodeId ||
											resultData.result?.node?.id ||
											resultData.node?.id
									} catch {
										resultData = { raw: text }
									}

									// If JSON parse didn't get nodeId, try regex extraction (like extractNodeIdFromResult)
									if (!createdNodeId) {
										// Format 1: "with ID: 53:738"
										const withIdMatch = text.match(/with ID[:\s]+(\d+:\d+)/i)
										if (withIdMatch) {
											createdNodeId = withIdMatch[1]
											console.log(
												`[ParallelUI] Extracted node ID from 'with ID' format: ${createdNodeId}`,
											)
										}
									}

									if (!createdNodeId) {
										// Format 2: "id":"53:738" in JSON-like text
										const nodeIdMatch = text.match(/"id"\s*:\s*"(\d+:\d+)"/)
										if (nodeIdMatch) {
											createdNodeId = nodeIdMatch[1]
											console.log(
												`[ParallelUI] Extracted node ID from id field: ${createdNodeId}`,
											)
										}
									}

									if (!createdNodeId) {
										// Format 3: Any node ID pattern (digits:digits)
										const anyNodeIdMatch = text.match(/\b(\d+:\d+)\b/)
										if (anyNodeIdMatch) {
											createdNodeId = anyNodeIdMatch[1]
											console.log(
												`[ParallelUI] Extracted node ID from text pattern: ${createdNodeId}`,
											)
										}
									}

									if (!createdNodeId) {
										console.warn(
											`[ParallelUI] Could not extract node ID from response:`,
											text.substring(0, 200),
										)
									}
								}
							}

							if (createdNodeId) {
								nodeIds.push(createdNodeId)

								// IMPORTANT: After create_rectangle, automatically set corner radius
								// This ensures rounded corners even if sub-AI didn't pass cornerRadius parameter
								if (toolName === "create_rectangle") {
									const cornerRadius = task.designSpec?.cornerRadius || 8
									if (cornerRadius > 0) {
										try {
											// Send BOTH radius and per-corner parameters for TalkToFigma compatibility
											console.log(
												`[ParallelUI] Auto-setting corner radius ${cornerRadius} for rectangle ${createdNodeId}`,
											)
											await this.mcpHub!.callTool(this.activeFigmaServer, "set_corner_radius", {
												nodeId: createdNodeId,
												radius: cornerRadius,
												cornerRadius: cornerRadius,
												topLeft: cornerRadius,
												topRight: cornerRadius,
												bottomRight: cornerRadius,
												bottomLeft: cornerRadius,
											})
											console.log(
												`[ParallelUI] ✓ Corner radius ${cornerRadius} set successfully for ${createdNodeId}`,
											)
										} catch (e) {
											console.warn(`[ParallelUI] ✗ Failed to auto-set corner radius:`, e)
										}
									}
								}
							}

							return {
								type: "tool_result" as const,
								tool_use_id: toolUse.id,
								content: JSON.stringify({ success: true, nodeId: createdNodeId, data: resultData }),
							}
						} catch (error) {
							return {
								type: "tool_result" as const,
								tool_use_id: toolUse.id,
								content: JSON.stringify({
									success: false,
									error: error instanceof Error ? error.message : String(error),
								}),
							}
						}
					}),
				)

				// Add assistant message and tool results to messages
				messages.push({
					role: "assistant",
					content: assistantContent,
				})

				messages.push({
					role: "user",
					content: toolResults,
				})

				// Check if we should continue (no tool calls means we're done)
				if (toolCalls.size === 0) {
					continueLoop = false
				}
			} catch (error) {
				console.error(`[ParallelUI] Error in task ${task.id}:`, error)
				throw error
			}
		}
	}

	/**
	 * Get the input schema for a Figma tool
	 * NOTE: Parameter names must match the Figma Write Bridge exactly!
	 */
	private getToolSchema(toolName: string): Anthropic.Tool["input_schema"] {
		const schemas: Record<string, Anthropic.Tool["input_schema"]> = {
			create_frame: {
				type: "object",
				properties: {
					name: { type: "string", description: "Frame name" },
					width: { type: "number", description: "Frame width in pixels" },
					height: { type: "number", description: "Frame height in pixels" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
					parent: { type: "string", description: "Parent frame ID to create inside (optional)" },
				},
				required: ["width", "height"],
			},
			add_text: {
				type: "object",
				properties: {
					text: { type: "string", description: "Text content to display" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
					fontSize: { type: "number", description: "Font size in pixels" },
					fontFamily: { type: "string", description: "Font family (default: Inter)" },
					parent: { type: "string", description: "Parent frame ID to create inside (optional)" },
				},
				required: ["text"],
			},
			create_rectangle: {
				type: "object",
				properties: {
					width: { type: "number", description: "Rectangle width in pixels" },
					height: { type: "number", description: "Rectangle height in pixels" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
					radius: {
						type: "number",
						description:
							"REQUIRED! Corner radius for rounded corners (8 for normal buttons, width/2 for circular)",
					},
					hex: { type: "string", description: "Fill color as hex (e.g. #007AFF)" },
					color: { type: "string", description: "Alternative: Fill color as hex (same as hex)" },
					parent: { type: "string", description: "Parent frame ID to create inside (optional)" },
					parentId: { type: "string", description: "Alternative: Parent frame ID (same as parent)" },
				},
				required: ["width", "height", "radius"],
			},
			set_fill: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "Node ID to apply fill to" },
					hex: { type: "string", description: "Color as hex (e.g. #FF0000)" },
					opacity: { type: "number", description: "Opacity 0-1" },
				},
				required: ["nodeId", "hex"],
			},
			set_position: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "Node ID to move" },
					x: { type: "number", description: "X position" },
					y: { type: "number", description: "Y position" },
				},
				required: ["nodeId", "x", "y"],
			},
			group_nodes: {
				type: "object",
				properties: {
					nodeIds: {
						type: "array",
						items: { type: "string" },
						description: "Array of node IDs to group",
					},
					name: { type: "string", description: "Group name" },
				},
				required: ["nodeIds"],
			},
			set_text_color: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "Text node ID" },
					hex: { type: "string", description: "Color as hex (e.g. #FFFFFF)" },
					opacity: { type: "number", description: "Opacity 0-1" },
				},
				required: ["nodeId", "hex"],
			},
			find_nodes: {
				type: "object",
				properties: {
					type: { type: "string", description: "Node type filter (e.g. TEXT, FRAME, RECTANGLE)" },
					nameContains: { type: "string", description: "Filter by name containing this string" },
					within: { type: "string", description: "Search within this node ID" },
				},
				required: [],
			},
			delete_node: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "ID of the node to delete" },
				},
				required: ["nodeId"],
			},
		}

		return schemas[toolName] || { type: "object", properties: {} }
	}
}

// Export singleton getter
export function getParallelUIService(): ParallelUIService {
	return ParallelUIService.getInstance()
}
