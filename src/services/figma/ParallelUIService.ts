/**
 * Parallel UI Service
 *
 * Manages parallel execution of multiple AI agents for UI drawing.
 * Each agent handles a specific UI component/section independently.
 * Each agent has its own isolated context (conversation history).
 */

import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, buildApiHandler } from "../../api"
import { FIGMA_WRITE_TOOLS } from "./FigmaWriteService"
import { ProviderSettings } from "@roo-code/types"
import type { McpHub } from "../mcp/McpHub"
import { AgentContextManager, AgentContext } from "./AgentContextManager"

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

// System prompt for UI drawing agents - universal for all UI types
const UI_AGENT_SYSTEM_PROMPT = `You are a professional UI designer agent specializing in MODERN MINIMALIST design.

## DESIGN PHILOSOPHY - MODERN MINIMALIST (現代簡約)
1. CLEAN & SIMPLE - Less is more, remove unnecessary elements
2. GENEROUS WHITESPACE - Elements need breathing room
3. SUBTLE COLORS - Soft, muted tones, not harsh or saturated
4. VISUAL HIERARCHY - Clear distinction between primary and secondary elements
5. CONSISTENCY - Same corner radius, spacing, and style throughout
6. NO EMOJIS - Use simple geometric shapes or text, never emoji icons

## MODERN COLOR PALETTE (USE THESE!)
**Background colors:**
- App background: #F8FAFC (very light gray-blue) or #FFFFFF (white)
- Card/Container: #FFFFFF (white) with subtle shadow effect
- Section headers: #F1F5F9 (light slate)

**Primary accent (for main actions):**
- #3B82F6 (blue) or #6366F1 (indigo) or #8B5CF6 (violet)

**Text colors:**
- Primary text: #1E293B (dark slate)
- Secondary text: #64748B (medium slate)
- Muted text: #94A3B8 (light slate)

**Interactive elements:**
- Primary button: #3B82F6 bg + #FFFFFF text
- Secondary button: #F1F5F9 bg + #475569 text
- Danger button: #EF4444 bg + #FFFFFF text (use sparingly)

**List items:**
- Background: #FFFFFF
- Hover/selected: #F8FAFC
- Text: #334155 (slate-700)

## TOOL SEQUENCE (FOLLOW EXACTLY - 5 STEPS!)
Step 1: create_rectangle (shape only, NO color or radius applied by this call!)
Step 2: set_corner_radius (REQUIRED! Apply rounded corners)
Step 3: set_fill (REQUIRED! Apply background color)
Step 4: add_text (centered label)
Step 5: set_text_color (apply text color)

⚠️ IMPORTANT: TalkToFigma's create_rectangle does NOT apply radius or color!
You MUST call set_corner_radius AND set_fill separately after creating the rectangle!

## TOOL PARAMETERS
- create_rectangle: width, height, x, y, parentId (optional) ← NO radius/color here!
- set_corner_radius: nodeId (from step 1), radius (8-12 for buttons)
- set_fill: nodeId (from step 1), hex
- add_text: text, x, y, fontSize, parentId (optional)
- set_text_color: nodeId (from step 4), hex

## MODERN DESIGN RULES
1. Corner radius: Use 8-12px for buttons/cards, be CONSISTENT
2. Font sizes: 14-16px for body, 18-24px for headings
3. Spacing: Minimum 12px between elements, 16-24px padding in containers
4. Buttons: Height 40-48px, horizontal padding 16-24px
5. Cards: Use white background (#FFFFFF) on light gray app background (#F8FAFC)

## TEXT CENTERING FORMULA
- textX = rectX + (rectWidth - textWidth) / 2
- textY = rectY + (rectHeight - fontSize) / 2
- Estimate textWidth = fontSize × 0.6 × characterCount

## CONTRAST RULES
- Light backgrounds (#FFFFFF, #F8FAFC) → Dark text (#1E293B)
- Colored backgrounds (#3B82F6, etc.) → White text (#FFFFFF)
- NEVER use pure black (#000000), use dark slate (#1E293B) instead

## FORBIDDEN (避免這些!)
- NO emoji icons (use text or simple shapes)
- NO pure gray (#808080, #999999) - use slate colors instead
- NO harsh saturated colors - keep it subtle and modern
- NO inconsistent spacing or sizing`

export class ParallelUIService {
	private static instance: ParallelUIService | null = null
	private apiConfiguration: ProviderSettings | null = null
	private extensionPath: string = ""
	private mcpHub: McpHub | null = null
	private activeFigmaServer: string = "TalkToFigma"
	// Active design server can be Figma or UIDesignCanvas
	private activeDesignServer: "TalkToFigma" | "figma-write" | "UIDesignCanvas" = "TalkToFigma"
	// Figma server preferences from global settings
	private talkToFigmaEnabled: boolean = true
	private figmaWriteEnabled: boolean = false
	// UIDesignCanvas enabled flag
	private uiDesignCanvasEnabled: boolean = true

	// Track created frame names to prevent duplicates within a session
	// This is reset at the start of each executeTasks call
	private createdFrameNames: Set<string> = new Set()
	// Track existing frame names scanned from Figma
	private existingFrameNames: Set<string> = new Set()

	// Agent Context Manager for isolated contexts per AI agent
	private contextManager: AgentContextManager = AgentContextManager.getInstance()
	// Map task IDs to their agent context IDs for cleanup
	private taskContextMap: Map<string, string> = new Map()

	/**
	 * Tool name mapping from figma-write to TalkToFigma
	 * Based on TalkToFigma MCP documentation
	 * figma-write tool name → TalkToFigma tool name
	 */
	private static readonly TOOL_MAPPING: Record<string, string> = {
		// Same names (no mapping needed but listed for clarity)
		create_frame: "create_frame",
		create_rectangle: "create_rectangle",
		delete_node: "delete_node",
		clone_node: "clone_node",
		resize_node: "resize_node",
		set_corner_radius: "set_corner_radius",
		// Different names - Position/Movement
		set_position: "move_node",
		// Different names - Text
		add_text: "create_text",
		// Different names - Colors
		set_fill: "set_fill_color",
		set_text_color: "set_fill_color", // TalkToFigma uses set_fill_color for text color too
		// Different names - Document/Node info
		get_file_url: "get_document_info",
		find_nodes: "scan_nodes_by_types", // For scanning nodes by type
		get_node: "get_node_info", // For getting single node info
		get_nodes: "get_nodes_info", // For getting multiple nodes info
	}

	/**
	 * Tool name mapping from Figma tools to UIDesignCanvas tools
	 * UIDesignCanvas has its own tool set optimized for AI design
	 */
	private static readonly UI_DESIGN_CANVAS_TOOL_MAPPING: Record<string, string> = {
		// Same names
		create_frame: "create_frame",
		create_rectangle: "create_rectangle",
		create_text: "create_text",
		// Different names
		move_node: "move_element",
		set_position: "move_element",
		resize_node: "resize_element",
		delete_node: "delete_element",
		clone_node: "update_element", // UIDesignCanvas doesn't have clone, will need special handling
		// Color/Style operations map to set_style
		set_fill: "set_style",
		set_fill_color: "set_style",
		set_text_color: "set_style",
		set_corner_radius: "set_style",
		// Document info
		get_document_info: "get_design",
		get_file_url: "get_design",
		get_node_info: "get_element",
		get_node: "get_element",
		// Create operations
		add_text: "create_text",
		create_ellipse: "create_ellipse",
	}

	private constructor() {}

	static getInstance(): ParallelUIService {
		if (!ParallelUIService.instance) {
			ParallelUIService.instance = new ParallelUIService()
		}
		return ParallelUIService.instance
	}

	/**
	 * Configure the service with API settings, McpHub, and design tool preferences
	 */
	configure(
		apiConfiguration: ProviderSettings,
		extensionPath: string,
		mcpHub?: McpHub,
		figmaSettings?: { talkToFigmaEnabled?: boolean; figmaWriteEnabled?: boolean; uiDesignCanvasEnabled?: boolean },
	): void {
		this.apiConfiguration = apiConfiguration
		this.extensionPath = extensionPath
		if (mcpHub) {
			this.mcpHub = mcpHub
		}
		// Store design tool preferences
		if (figmaSettings) {
			this.talkToFigmaEnabled = figmaSettings.talkToFigmaEnabled ?? true
			this.figmaWriteEnabled = figmaSettings.figmaWriteEnabled ?? false
			this.uiDesignCanvasEnabled = figmaSettings.uiDesignCanvasEnabled ?? true
		}
		// Debug logging
		console.log(`[ParallelUI] Configured with:`, {
			provider: apiConfiguration?.apiProvider,
			modelId: apiConfiguration?.apiModelId,
			baseUrl: apiConfiguration?.openAiBaseUrl,
			hasConfig: !!apiConfiguration,
			talkToFigmaEnabled: this.talkToFigmaEnabled,
			figmaWriteEnabled: this.figmaWriteEnabled,
			uiDesignCanvasEnabled: this.uiDesignCanvasEnabled,
		})
	}

	/**
	 * Map tool name and arguments for the active design server
	 * Handles differences between figma-write, TalkToFigma, and UIDesignCanvas APIs
	 *
	 * TalkToFigma tool parameter differences:
	 * - create_text: uses 'text' parameter (same as figma-write's add_text)
	 * - create_rectangle: uses 'color' instead of 'hex', 'radius' instead of 'cornerRadius'
	 * - set_fill_color: uses 'color' instead of 'hex'
	 * - move_node: same params (nodeId, x, y)
	 *
	 * UIDesignCanvas tool parameter differences:
	 * - Uses 'id' instead of 'nodeId' for element identification
	 * - Uses set_style for all styling operations (fill, stroke, radius, etc.)
	 * - Position uses x, y directly in create operations
	 */
	private mapToolForServer(
		toolName: string,
		args: Record<string, unknown>,
	): { mappedName: string; mappedArgs: Record<string, unknown> } {
		if (this.activeDesignServer === "figma-write") {
			// figma-write uses our custom API, no mapping needed
			return { mappedName: toolName, mappedArgs: args }
		}

		if (this.activeDesignServer === "UIDesignCanvas") {
			// UIDesignCanvas mapping
			return this.mapToolForUIDesignCanvas(toolName, args)
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
				// TalkToFigma's create_rectangle expects color as RGB object {r, g, b} with values 0-1
				// Convert hex string to RGB object for proper color application
				if (args.hex) {
					const rgb = this.toRgbObject(args.hex)
					if (rgb) {
						mappedArgs = { ...mappedArgs, color: rgb }
						console.log(`[ParallelUI] Converted hex "${args.hex}" to RGB for create_rectangle:`, rgb)
					} else {
						// Fallback: pass hex as-is if conversion fails
						mappedArgs = { ...mappedArgs, color: args.hex }
						console.warn(`[ParallelUI] Could not convert hex "${args.hex}" to RGB, passing as-is`)
					}
					delete mappedArgs.hex
				} else if (args.color && typeof args.color === "string") {
					// Color is already a string (hex), convert to RGB
					const rgb = this.toRgbObject(args.color)
					if (rgb) {
						mappedArgs = { ...mappedArgs, color: rgb }
						console.log(`[ParallelUI] Converted color string to RGB for create_rectangle:`, rgb)
					}
				} else {
					// FALLBACK: If no color provided, use a modern minimalist default
					// Use subtle light slate instead of harsh colors
					const defaultColor = "#F1F5F9" // Light slate - modern minimalist default
					const rgb = this.toRgbObject(defaultColor)
					if (rgb) {
						mappedArgs = { ...mappedArgs, color: rgb }
						console.warn(`[ParallelUI] No color provided for create_rectangle, using default: ${defaultColor}`)
					}
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
				// TalkToFigma's set_fill_color expects color as RGB object {r, g, b} with values 0-1
				if (args.hex) {
					const rgb = this.toRgbObject(args.hex)
					if (rgb) {
						mappedArgs = { ...mappedArgs, color: rgb }
						console.log(`[ParallelUI] Converted hex "${args.hex}" to RGB for ${toolName}:`, rgb)
					} else {
						mappedArgs = { ...mappedArgs, color: args.hex }
					}
					delete mappedArgs.hex
				} else if (args.color && typeof args.color === "string") {
					const rgb = this.toRgbObject(args.color)
					if (rgb) {
						mappedArgs = { ...mappedArgs, color: rgb }
						console.log(`[ParallelUI] Converted color string to RGB for ${toolName}:`, rgb)
					}
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
	 * Map tool name and arguments for UIDesignCanvas
	 * Converts Figma tool calls to UIDesignCanvas equivalents
	 */
	private mapToolForUIDesignCanvas(
		toolName: string,
		args: Record<string, unknown>,
	): { mappedName: string; mappedArgs: Record<string, unknown> } {
		const mappedName = ParallelUIService.UI_DESIGN_CANVAS_TOOL_MAPPING[toolName] || toolName
		let mappedArgs = { ...args }

		// UIDesignCanvas uses 'id' instead of 'nodeId'
		if (args.nodeId && !args.id) {
			mappedArgs.id = args.nodeId
			delete mappedArgs.nodeId
		}

		// UIDesignCanvas uses 'parentId' same as TalkToFigma
		if (args.parent && !args.parentId) {
			mappedArgs.parentId = args.parent
			delete mappedArgs.parent
		}

		// Handle tool-specific parameter mappings
		switch (toolName) {
			case "create_frame":
			case "create_rectangle":
				// UIDesignCanvas uses 'fill' instead of 'color' or 'hex'
				if (args.hex) {
					mappedArgs.fill = args.hex
					delete mappedArgs.hex
				}
				if (args.color && typeof args.color === "string") {
					mappedArgs.fill = args.color
					delete mappedArgs.color
				} else if (args.color && typeof args.color === "object") {
					// Convert RGB object {r, g, b} (0-1) to hex string
					const rgb = args.color as { r: number; g: number; b: number }
					const hex = this.rgbToHex(rgb)
					mappedArgs.fill = hex
					delete mappedArgs.color
				}
				// cornerRadius maps to radius
				if (args.cornerRadius !== undefined) {
					mappedArgs.radius = args.cornerRadius
					delete mappedArgs.cornerRadius
				}
				break

			case "create_text":
			case "add_text":
				// UIDesignCanvas uses 'content' for text content
				if (args.text && !args.content) {
					mappedArgs.content = args.text
					delete mappedArgs.text
				}
				// Map fontColor/color to fill for text
				if (args.fontColor) {
					if (typeof args.fontColor === "string") {
						mappedArgs.fill = args.fontColor
					} else if (typeof args.fontColor === "object") {
						const rgb = args.fontColor as { r: number; g: number; b: number }
						mappedArgs.fill = this.rgbToHex(rgb)
					}
					delete mappedArgs.fontColor
				}
				if (args.color && !mappedArgs.fill) {
					if (typeof args.color === "string") {
						mappedArgs.fill = args.color
					} else if (typeof args.color === "object") {
						const rgb = args.color as { r: number; g: number; b: number }
						mappedArgs.fill = this.rgbToHex(rgb)
					}
					delete mappedArgs.color
				}
				break

			case "move_node":
			case "set_position":
				// UIDesignCanvas move_element uses id, x, y
				if (args.nodeId) {
					mappedArgs.id = args.nodeId
					delete mappedArgs.nodeId
				}
				break

			case "set_fill":
			case "set_fill_color":
			case "set_text_color":
				// Map to set_style with fill property
				mappedArgs = { id: args.nodeId || args.id }
				if (args.hex) {
					mappedArgs.fill = args.hex
				} else if (args.color) {
					if (typeof args.color === "string") {
						mappedArgs.fill = args.color
					} else if (typeof args.color === "object") {
						const rgb = args.color as { r: number; g: number; b: number }
						mappedArgs.fill = this.rgbToHex(rgb)
					}
				}
				break

			case "set_corner_radius":
				// Map to set_style with radius property
				mappedArgs = {
					id: args.nodeId || args.id,
					radius: args.radius || args.cornerRadius,
				}
				break

			case "resize_node":
				// UIDesignCanvas uses resize_element
				if (args.nodeId) {
					mappedArgs.id = args.nodeId
					delete mappedArgs.nodeId
				}
				break

			case "delete_node":
				// UIDesignCanvas uses delete_element
				if (args.nodeId) {
					mappedArgs.id = args.nodeId
					delete mappedArgs.nodeId
				}
				break
		}

		console.log(`[ParallelUI] UIDesignCanvas tool mapping: ${toolName} -> ${mappedName}`, {
			original: args,
			mapped: mappedArgs,
		})

		return { mappedName, mappedArgs }
	}

	/**
	 * Convert RGB object (0-1 range) to hex string
	 */
	private rgbToHex(rgb: { r: number; g: number; b: number }): string {
		const toHex = (n: number) => {
			// Handle both 0-1 and 0-255 ranges
			const value = n <= 1 ? Math.round(n * 255) : Math.round(n)
			return value.toString(16).padStart(2, "0")
		}
		return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
	}

	/**
	 * Extract node ID from MCP tool result
	 * Handles different response formats from figma-write, TalkToFigma, and UIDesignCanvas
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

			// UIDesignCanvas format: "id": "el-abc123" or element ID pattern
			const uiCanvasIdMatch = text.match(/"id"\s*:\s*"(el-[a-z0-9]+)"/i)
			if (uiCanvasIdMatch) {
				console.log(`[ParallelUI] Extracted UIDesignCanvas element ID: ${uiCanvasIdMatch[1]}`)
				return uiCanvasIdMatch[1]
			}

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
	 * Get frame dimensions from Figma
	 * Returns the width and height of the specified frame
	 */
	private async getFrameInfo(frameId: string): Promise<{ width: number; height: number; name: string } | null> {
		if (!this.mcpHub || !this.activeFigmaServer) {
			return null
		}

		try {
			const { mappedName } = this.mapToolForServer("get_node", {})
			const result = await this.mcpHub.callTool(this.activeFigmaServer, mappedName, { nodeId: frameId })

			if (result.content) {
				const textContent = result.content.find((c: { type: string }) => c.type === "text")
				if (textContent && "text" in textContent) {
					const text = textContent.text as string
					try {
						const data = JSON.parse(text)
						// Handle different response formats
						const node = data.node || data.result?.node || data
						if (node) {
							const width = node.width || node.absoluteBoundingBox?.width || 0
							const height = node.height || node.absoluteBoundingBox?.height || 0
							const name = node.name || "Unknown"
							console.log(`[ParallelUI] Frame info for ${frameId}: ${name} (${width}x${height})`)
							return { width, height, name }
						}
					} catch {
						// Try regex extraction
						const widthMatch = text.match(/"width"\s*:\s*(\d+(?:\.\d+)?)/i)
						const heightMatch = text.match(/"height"\s*:\s*(\d+(?:\.\d+)?)/i)
						const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/i)
						if (widthMatch && heightMatch) {
							const width = parseFloat(widthMatch[1])
							const height = parseFloat(heightMatch[1])
							const name = nameMatch ? nameMatch[1] : "Unknown"
							console.log(`[ParallelUI] Frame info (regex) for ${frameId}: ${name} (${width}x${height})`)
							return { width, height, name }
						}
					}
				}
			}
		} catch (error) {
			console.warn(`[ParallelUI] Failed to get frame info for ${frameId}:`, error)
		}

		return null
	}

	/**
	 * Reset frame tracking and context management for a new task execution session
	 * Should be called at the start of executeTasks
	 */
	private resetFrameTracking(): void {
		this.createdFrameNames.clear()
		this.existingFrameNames.clear()
		this.taskContextMap.clear()
		// Cleanup any stale contexts from previous sessions
		this.contextManager.cleanupStaleContexts(10 * 60 * 1000) // 10 minutes
		console.log("[ParallelUI] Frame tracking and context management reset for new session")
	}

	/**
	 * Initialize existing frame names from Figma scan results
	 */
	private initializeExistingFrames(frames: string[]): void {
		this.existingFrameNames = new Set(frames.map((f) => f.toLowerCase().trim()))
		console.log(`[ParallelUI] Initialized ${this.existingFrameNames.size} existing frame names`)
	}

	/**
	 * Atomically try to claim a frame name for creation.
	 * This is thread-safe: it checks AND registers in one operation to prevent race conditions.
	 * Returns true if the frame can be created (name was successfully claimed).
	 * Returns false if the frame already exists or was already claimed by another task.
	 */
	private tryClaimFrameName(frameName: string): boolean {
		if (!frameName) return true // Allow anonymous frames

		const normalizedName = frameName.toLowerCase().trim()

		// Check if frame already exists in Figma
		if (this.existingFrameNames.has(normalizedName)) {
			console.log(`[ParallelUI] ⚠️ Frame "${frameName}" already exists in Figma, skipping creation`)
			return false
		}

		// Atomic check-and-set: if already in the set, another task claimed it first
		if (this.createdFrameNames.has(normalizedName)) {
			console.log(`[ParallelUI] ⚠️ Frame "${frameName}" was already claimed by another task, skipping duplicate`)
			return false
		}

		// Claim the name immediately (before any async operation)
		this.createdFrameNames.add(normalizedName)
		console.log(`[ParallelUI] ✓ Claimed frame name: "${frameName}" (total claimed: ${this.createdFrameNames.size})`)
		return true
	}

	/**
	 * Scan existing elements in a container to detect duplicates
	 * Returns a list of text contents and frame names that already exist
	 */
	private async scanExistingElements(containerFrame?: string): Promise<{ texts: string[]; frames: string[] }> {
		if (!this.mcpHub || !this.activeFigmaServer) {
			return { texts: [], frames: [] }
		}

		const existingTexts: string[] = []
		const existingFrames: string[] = []

		// Scan for text nodes
		try {
			const scanArgs: Record<string, unknown> = containerFrame ? { nodeId: containerFrame } : {}
			const result = await this.mcpHub.callTool(this.activeFigmaServer, "scan_text_nodes", scanArgs)

			if (result.content) {
				const textContent = result.content.find((c: { type: string }) => c.type === "text")
				if (textContent && "text" in textContent) {
					const text = textContent.text as string
					try {
						const data = JSON.parse(text)
						if (Array.isArray(data)) {
							existingTexts.push(
								...data
									.map(
										(item: { text?: string; characters?: string }) =>
											item.text || item.characters || "",
									)
									.filter((t: string) => t.length > 0),
							)
						}
						if (data.textNodes && Array.isArray(data.textNodes)) {
							existingTexts.push(
								...data.textNodes
									.map(
										(item: { text?: string; characters?: string }) =>
											item.text || item.characters || "",
									)
									.filter((t: string) => t.length > 0),
							)
						}
					} catch {
						const textMatches = text.match(/["']([^"']+)["']/g)
						if (textMatches) {
							existingTexts.push(
								...textMatches
									.map((m: string) => m.replace(/["']/g, ""))
									.filter((t: string) => t.length > 0),
							)
						}
					}
				}
			}
		} catch (error) {
			console.warn(`[ParallelUI] Failed to scan text nodes:`, error)
		}

		// Scan for frame nodes using scan_nodes_by_types or find_nodes
		try {
			const { mappedName: scanToolName } = this.mapToolForServer("find_nodes", {})
			const scanArgs: Record<string, unknown> = { types: ["FRAME"] }
			if (containerFrame) {
				scanArgs.nodeId = containerFrame
			}

			const result = await this.mcpHub.callTool(this.activeFigmaServer, scanToolName, scanArgs)

			if (result.content) {
				const textContent = result.content.find((c: { type: string }) => c.type === "text")
				if (textContent && "text" in textContent) {
					const text = textContent.text as string
					try {
						const data = JSON.parse(text)
						// Handle different response formats
						const nodes = Array.isArray(data) ? data : data.nodes || data.frames || []
						for (const node of nodes) {
							if (node.name) {
								existingFrames.push(node.name)
							}
						}
					} catch {
						// Try to extract frame names from text
						const nameMatches = text.match(/"name"\s*:\s*"([^"]+)"/g)
						if (nameMatches) {
							for (const match of nameMatches) {
								const nameMatch = match.match(/"name"\s*:\s*"([^"]+)"/)
								if (nameMatch && nameMatch[1]) {
									existingFrames.push(nameMatch[1])
								}
							}
						}
					}
				}
			}
		} catch (error) {
			console.warn(`[ParallelUI] Failed to scan frame nodes:`, error)
		}

		console.log(
			`[ParallelUI] Scanned existing elements: ${existingTexts.length} texts, ${existingFrames.length} frames`,
		)
		if (existingFrames.length > 0) {
			console.log(`[ParallelUI] Existing frames: [${existingFrames.join(", ")}]`)
		}

		return { texts: existingTexts, frames: existingFrames }
	}

	/**
	 * Filter out tasks that would create duplicate elements
	 * Checks both text content and frame names for duplicates
	 */
	/**
	 * Extract frame name from task description
	 * Looks for patterns like "Create XXX frame", "XXX UI", "XXX container", etc.
	 */
	private extractFrameNameFromDescription(description: string): string | null {
		const lowerDesc = description.toLowerCase()

		// Common patterns for frame/container creation
		const patterns = [
			// "Create Calculator UI frame" -> "calculator ui"
			/create\s+(?:a\s+)?["']?([^"']+?)["']?\s+(?:frame|container|section|panel|card|box)/i,
			// "Calculator UI frame" -> "calculator ui"
			/["']?([^"']+?)["']?\s+(?:frame|container|section|panel|card|box)/i,
			// "Main frame: Calculator" -> "calculator"
			/(?:main|primary|root)\s+(?:frame|container):\s*["']?([^"']+?)["']?/i,
			// "frame named Calculator UI" -> "calculator ui"
			/(?:frame|container)\s+(?:named|called)\s+["']?([^"']+?)["']?/i,
		]

		for (const pattern of patterns) {
			const match = description.match(pattern)
			if (match && match[1]) {
				const frameName = match[1].trim().toLowerCase()
				// Skip generic words
				if (!["the", "a", "an", "new", "main", "primary"].includes(frameName)) {
					return frameName
				}
			}
		}

		// Also check for explicit frame names like "Calculator UI" at the start
		const explicitNameMatch = description.match(/^["']?([A-Z][a-zA-Z0-9\s]+(?:UI|Frame|Container|Panel|Card))["']?/i)
		if (explicitNameMatch && explicitNameMatch[1]) {
			return explicitNameMatch[1].trim().toLowerCase()
		}

		return null
	}

	private filterDuplicateTasks(
		tasks: UITaskDefinition[],
		existingElements: { texts: string[]; frames: string[] },
	): { filteredTasks: UITaskDefinition[]; skippedTasks: UITaskDefinition[] } {
		const existingTexts = new Set(existingElements.texts.map((e) => e.toLowerCase().trim()))
		const existingFrames = new Set(existingElements.frames.map((e) => e.toLowerCase().trim()))
		const filteredTasks: UITaskDefinition[] = []
		const skippedTasks: UITaskDefinition[] = []

		// Track frame names being created within this batch to detect within-batch duplicates
		const frameNamesInBatch = new Set<string>()

		for (const task of tasks) {
			let isDuplicate = false
			let reason = ""

			// Check if task text already exists
			const taskText = (task.designSpec?.text || "").toLowerCase().trim()
			if (taskText && existingTexts.has(taskText)) {
				isDuplicate = true
				reason = `text "${taskText}" already exists`
			}

			// Check if task is creating a frame that already exists (by targetFrame name or description)
			if (!isDuplicate) {
				const targetFrame = (task.targetFrame || "").toLowerCase().trim()
				if (targetFrame && existingFrames.has(targetFrame)) {
					isDuplicate = true
					reason = `frame "${targetFrame}" already exists`
				}
			}

			// Check if task description mentions creating a frame that already exists
			if (!isDuplicate) {
				const description = (task.description || "").toLowerCase()
				for (const frame of existingFrames) {
					if (description.includes(frame)) {
						isDuplicate = true
						reason = `description references existing frame "${frame}"`
						break
					}
				}
			}

			// Extract potential frame name from task description and check for within-batch duplicates
			if (!isDuplicate) {
				const extractedFrameName = this.extractFrameNameFromDescription(task.description || "")
				if (extractedFrameName) {
					// Check if this frame name already exists
					if (existingFrames.has(extractedFrameName)) {
						isDuplicate = true
						reason = `frame "${extractedFrameName}" already exists in Figma`
					}
					// Check if another task in this batch is already creating this frame
					else if (frameNamesInBatch.has(extractedFrameName)) {
						isDuplicate = true
						reason = `frame "${extractedFrameName}" is already being created by another task in this batch`
					}
					// Track this frame name as being created
					else {
						frameNamesInBatch.add(extractedFrameName)
					}
				}
			}

			// Also check task ID for frame name patterns (e.g., "calculator-ui-frame-1")
			if (!isDuplicate) {
				const taskIdLower = task.id.toLowerCase()
				// Extract base name from task ID (remove numbers and suffixes)
				const baseTaskId = taskIdLower.replace(/-\d+$/, "").replace(/_\d+$/, "")

				for (const frame of existingFrames) {
					const normalizedFrame = frame.replace(/\s+/g, "-").toLowerCase()
					if (baseTaskId.includes(normalizedFrame) || normalizedFrame.includes(baseTaskId)) {
						isDuplicate = true
						reason = `task ID "${task.id}" matches existing frame "${frame}"`
						break
					}
				}
			}

			if (isDuplicate) {
				console.log(`[ParallelUI] Skipping duplicate task ${task.id}: ${reason}`)
				skippedTasks.push(task)
			} else {
				filteredTasks.push(task)
			}
		}

		if (skippedTasks.length > 0) {
			console.log(
				`[ParallelUI] Filtered out ${skippedTasks.length} duplicate tasks: ${skippedTasks.map((t) => t.id).join(", ")}`,
			)
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
	 * Extract meaningful text content from task ID or description
	 * Used when designSpec.text is not provided
	 * @param taskId Task ID like "add-btn", "task-input", "app-header"
	 * @param description Task description
	 * @returns Extracted text or null
	 */
	private extractTextFromTaskId(taskId: string, description?: string): string | null {
		// Common UI element mappings
		const textMappings: Record<string, string> = {
			// Buttons
			"add-btn": "+",
			"add-button": "+",
			"plus-btn": "+",
			"submit-btn": "Submit",
			"submit-button": "Submit",
			"save-btn": "Save",
			"save-button": "Save",
			"cancel-btn": "Cancel",
			"cancel-button": "Cancel",
			"delete-btn": "Delete",
			"delete-button": "Delete",
			"edit-btn": "Edit",
			"edit-button": "Edit",
			"close-btn": "×",
			"close-button": "×",
			"clear-btn": "Clear",
			"clear-button": "Clear",
			"clear-completed": "Clear Completed",
			// Headers
			"app-header": "App Title",
			"header": "Header",
			"title": "Title",
			// Inputs
			"task-input": "Enter task...",
			"search-input": "Search...",
			"input-field": "Enter text...",
			// Filters
			"all-filter": "All",
			"active-filter": "Active",
			"completed-filter": "Completed",
			"filter-all": "All",
			"filter-active": "Active",
			"filter-completed": "Completed",
			// List items
			"task-item": "Task Item",
			"list-item": "List Item",
		}

		// Check direct mapping first
		const lowerTaskId = taskId.toLowerCase()
		if (textMappings[lowerTaskId]) {
			console.log(`[ParallelUI] Extracted text from mapping: "${taskId}" -> "${textMappings[lowerTaskId]}"`)
			return textMappings[lowerTaskId]
		}

		// Check if taskId contains a known pattern
		for (const [pattern, text] of Object.entries(textMappings)) {
			if (lowerTaskId.includes(pattern.replace("-", ""))) {
				console.log(`[ParallelUI] Extracted text from partial match: "${taskId}" -> "${text}"`)
				return text
			}
		}

		// Try to extract from description (look for quoted text or key phrases)
		if (description) {
			// Look for quoted text in description
			const quotedMatch = description.match(/["']([^"']+)["']/)
			if (quotedMatch) {
				console.log(`[ParallelUI] Extracted text from description quotes: "${quotedMatch[1]}"`)
				return quotedMatch[1]
			}

			// Look for "text: xxx" pattern
			const textMatch = description.match(/text[:\s]+([^\s,]+)/i)
			if (textMatch) {
				console.log(`[ParallelUI] Extracted text from description pattern: "${textMatch[1]}"`)
				return textMatch[1]
			}
		}

		// Convert task ID to readable text (e.g., "my-task-btn" -> "My Task")
		const readable = taskId
			.replace(/[-_]/g, " ")
			.replace(/\b(btn|button|input|field|item|section|container)\b/gi, "")
			.trim()
			.replace(/\s+/g, " ")
			.split(" ")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join(" ")
			.trim()

		if (readable && readable.length > 0) {
			console.log(`[ParallelUI] Extracted text from ID conversion: "${taskId}" -> "${readable}"`)
			return readable
		}

		return null
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

		// Check if any design MCP server is connected based on user settings
		const servers = this.mcpHub.getServers()
		const talkToFigmaConnected = servers.find((s) => s.name === "TalkToFigma" && s.status === "connected")
		const figmaWriteConnected = servers.find((s) => s.name === "figma-write" && s.status === "connected")
		const uiDesignCanvasConnected = servers.find((s) => s.name === "UIDesignCanvas" && s.status === "connected")

		let designServer: typeof talkToFigmaConnected = undefined

		// Use the ENABLED design tool - only one should be enabled at a time
		// Priority is based on which tool the user has enabled in settings
		if (this.uiDesignCanvasEnabled && uiDesignCanvasConnected) {
			// UIDesignCanvas takes priority when enabled (built-in tool)
			designServer = uiDesignCanvasConnected
			this.activeDesignServer = "UIDesignCanvas"
			console.log(`[ParallelUI] Using UIDesignCanvas (enabled and connected)`)
		} else if (this.talkToFigmaEnabled && talkToFigmaConnected) {
			designServer = talkToFigmaConnected
			this.activeDesignServer = "TalkToFigma"
			console.log(`[ParallelUI] Using TalkToFigma (enabled and connected)`)
		} else if (this.figmaWriteEnabled && figmaWriteConnected) {
			designServer = figmaWriteConnected
			this.activeDesignServer = "figma-write"
			console.log(`[ParallelUI] Using figma-write (enabled and connected)`)
		} else {
			// Fallback: try any connected server if none explicitly enabled
			if (uiDesignCanvasConnected) {
				designServer = uiDesignCanvasConnected
				this.activeDesignServer = "UIDesignCanvas"
			} else if (talkToFigmaConnected) {
				designServer = talkToFigmaConnected
				this.activeDesignServer = "TalkToFigma"
			} else if (figmaWriteConnected) {
				designServer = figmaWriteConnected
				this.activeDesignServer = "figma-write"
			}
		}

		if (!designServer) {
			return {
				success: false,
				results: [],
				totalDuration: 0,
				summary: "No design MCP server connected. Please ensure UIDesignCanvas, figma-write, or TalkToFigma is running.",
			}
		}

		// Store which server we're using for tool calls
		this.activeFigmaServer = designServer.name
		console.log(
			`[ParallelUI] Using design server: ${this.activeFigmaServer} (type: ${this.activeDesignServer}, settings: talkToFigma=${this.talkToFigmaEnabled}, figmaWrite=${this.figmaWriteEnabled}, uiDesignCanvas=${this.uiDesignCanvasEnabled})`,
		)

		// Reset frame tracking for this new execution session
		this.resetFrameTracking()

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

			// Also filter duplicates in direct MCP mode
			const existingElements = await this.scanExistingElements(containerFrame)
			// Initialize frame tracking with existing frames
			this.initializeExistingFrames(existingElements.frames)

			// If containerFrame is provided, also add its name to prevent nested duplicates
			if (containerFrame) {
				const containerInfo = await this.getFrameInfo(containerFrame)
				if (containerInfo) {
					const containerName = containerInfo.name.toLowerCase().trim()
					if (!this.existingFrameNames.has(containerName)) {
						this.existingFrameNames.add(containerName)
						console.log(`[ParallelUI Direct] Added container frame "${containerInfo.name}" to existing frames set`)
					}
				}
			}

			const { filteredTasks: directModeTasks, skippedTasks: directModeSkipped } = this.filterDuplicateTasks(
				tasks,
				existingElements,
			)

			if (directModeSkipped.length > 0) {
				console.log(`[ParallelUI] Direct mode: Skipping ${directModeSkipped.length} duplicate tasks`)
				for (const skipped of directModeSkipped) {
					onProgress?.(skipped.id, "skipped (duplicate)")
				}
			}

			if (directModeTasks.length === 0) {
				const totalDuration = Date.now() - startTime
				return {
					success: true,
					results: directModeSkipped.map((task) => ({
						taskId: task.id,
						success: true,
						nodeIds: [],
						duration: 0,
						error: "Skipped: element already exists",
					})),
					totalDuration,
					summary: `[Direct MCP] All ${tasks.length} tasks skipped - elements already exist.`,
				}
			}

			return this.executeTasksDirectMcp(directModeTasks, onProgress, containerFrame)
		}

		console.log(
			`[ParallelUI] Starting ${tasks.length} parallel UI tasks using McpHub${containerFrame ? ` (inside frame ${containerFrame})` : ""}`,
		)

		// Scan existing elements to detect duplicates
		const existingElements = await this.scanExistingElements(containerFrame)
		// Initialize frame tracking with existing frames
		this.initializeExistingFrames(existingElements.frames)
		if (existingElements.texts.length > 0 || existingElements.frames.length > 0) {
			console.log(
				`[ParallelUI] Found existing elements: ${existingElements.texts.length} texts, ${existingElements.frames.length} frames`,
			)
		}

		// Get frame dimensions if containerFrame is provided
		let frameInfo: { width: number; height: number; name: string } | null = null
		if (containerFrame) {
			frameInfo = await this.getFrameInfo(containerFrame)
			if (frameInfo) {
				console.log(`[ParallelUI] Container frame: "${frameInfo.name}" (${frameInfo.width}x${frameInfo.height})`)
				// IMPORTANT: Also add the container frame name to the tracking set
				// This prevents sub-tasks from creating a nested frame with the same name as the container
				const containerName = frameInfo.name.toLowerCase().trim()
				if (!this.existingFrameNames.has(containerName)) {
					this.existingFrameNames.add(containerName)
					console.log(`[ParallelUI] Added container frame "${frameInfo.name}" to existing frames set`)
				}
			}
		}

		// Filter out duplicate tasks BEFORE executing
		const { filteredTasks, skippedTasks } = this.filterDuplicateTasks(tasks, existingElements)
		if (skippedTasks.length > 0) {
			console.log(`[ParallelUI] ⚠️ Skipping ${skippedTasks.length} duplicate tasks to prevent re-creation`)
			for (const skipped of skippedTasks) {
				onProgress?.(skipped.id, "skipped (duplicate)")
			}
		}

		// If all tasks were duplicates, return early
		if (filteredTasks.length === 0) {
			const totalDuration = Date.now() - startTime
			return {
				success: true,
				results: skippedTasks.map((task) => ({
					taskId: task.id,
					success: true,
					nodeIds: [],
					duration: 0,
					error: "Skipped: element already exists",
				})),
				totalDuration,
				summary: `All ${tasks.length} tasks skipped - elements already exist. No duplicates created.`,
			}
		}

		// Build color context from all tasks to inform each sub-AI about the overall color scheme
		// This helps sub-AIs understand the design consistency requirements
		const colorContext: { bgColors: string[]; textColors: string[] } = {
			bgColors: [],
			textColors: [],
		}
		for (const task of filteredTasks) {
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

		// Execute only non-duplicate tasks in parallel using sub-AI agents
		// Pass existing elements info, color context, and frame dimensions so AI knows boundaries
		const taskPromises = filteredTasks.map((task) =>
			this.executeSingleTask(task, onProgress, containerFrame, existingElements.texts, colorContext, frameInfo),
		)

		const results = await Promise.all(taskPromises)

		// Cleanup: Log and optionally remove completed agent contexts
		this.cleanupTaskContexts(filteredTasks)

		// Check if all tasks failed due to tool use issues - fallback to direct MCP
		const allFailedToolUse = results.every((r) => !r.success && r.error?.includes("工具調用"))
		if (allFailedToolUse && results.length > 0) {
			console.log(`[ParallelUI] All tasks failed due to tool use issues, falling back to direct MCP mode`)
			return this.executeTasksDirectMcp(filteredTasks, onProgress, containerFrame)
		}

		// Add skipped tasks to results with success status
		const skippedResults: UITaskResult[] = skippedTasks.map((task) => ({
			taskId: task.id,
			success: true,
			nodeIds: [],
			duration: 0,
			error: "Skipped: element already exists",
		}))

		const allResults = [...results, ...skippedResults]
		const totalDuration = Date.now() - startTime
		const successCount = results.filter((r) => r.success).length
		const allNodeIds = results.flatMap((r) => r.nodeIds)

		// Log context isolation stats
		const contextStats = this.contextManager.getStats()
		console.log(
			`[ParallelUI] Context isolation stats: ${contextStats.totalContexts} total contexts, ` +
				`${contextStats.totalApiCalls} total API calls, ` +
				`${contextStats.totalTokens.input + contextStats.totalTokens.output} total tokens`,
		)

		const skippedInfo = skippedTasks.length > 0 ? ` (${skippedTasks.length} duplicates skipped)` : ""

		return {
			success: successCount === filteredTasks.length,
			results: allResults,
			totalDuration,
			summary: `Completed ${successCount}/${filteredTasks.length} UI tasks in ${totalDuration}ms. Created ${allNodeIds.length} nodes.${skippedInfo}`,
		}
	}

	/**
	 * Cleanup agent contexts after task execution
	 * Removes contexts for completed/failed tasks to free memory
	 */
	private cleanupTaskContexts(tasks: UITaskDefinition[]): void {
		let cleanedCount = 0

		for (const task of tasks) {
			const contextId = this.taskContextMap.get(task.id)
			if (contextId) {
				const context = this.contextManager.getContext(contextId)
				if (context && (context.state === "completed" || context.state === "failed")) {
					// Log final context stats before cleanup
					console.log(
						`[ParallelUI] Cleaning up context ${contextId} for task ${task.id}: ` +
							`${context.messages.length} messages, ` +
							`${context.metadata.apiCallCount} API calls`,
					)
					// Don't delete immediately - let stale cleanup handle it
					// This allows for debugging if needed
					cleanedCount++
				}
				this.taskContextMap.delete(task.id)
			}
		}

		// Cleanup truly stale contexts (older than 5 minutes)
		this.contextManager.cleanupStaleContexts(5 * 60 * 1000)

		if (cleanedCount > 0) {
			console.log(`[ParallelUI] Marked ${cleanedCount} contexts for cleanup`)
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
			// Get text content - try to extract from various sources if not explicitly provided
			let textContent: string = task.designSpec?.text || ""
			if (!textContent) {
				// Try to extract from task ID (e.g., "add-btn" -> "Add", "task-input" -> "Task Input")
				const extracted = this.extractTextFromTaskId(task.id, task.description)
				textContent = extracted || "Button" // Better default than "?"
			}

			// For direct execution (non-AI path), use modern minimalist colors as fallback
			// Modern design uses subtle backgrounds with clean text colors
			const bgColor = task.designSpec?.colors?.[0] || "#F1F5F9" // Modern light slate (subtle, not harsh)
			const textColor = task.designSpec?.colors?.[1] || "#1E293B" // Dark slate text (not pure black)
			const cornerRadius = task.designSpec?.cornerRadius || 12 // Slightly larger radius for modern look
			const fontSize = task.designSpec?.fontSize || 16 // Standard modern font size
			// textContent already declared above for color detection

			// Calculate text centering
			const textLength = textContent.length
			const estimatedTextWidth = fontSize * 0.6 * textLength
			const textX = posX + Math.floor((width - estimatedTextWidth) / 2)
			const textY = posY + Math.floor((height - fontSize) / 2)

			console.log(`[ParallelUI Direct] Task ${task.id}: Creating button "${textContent}" at (${posX}, ${posY})`)

			// Use UIDesignCanvas convenience tools for better-looking UI with shadows and modern styling
			if (this.activeDesignServer === "UIDesignCanvas") {
				// Use create_button convenience tool which auto-applies shadows, rounded corners, and styling
				// Determine button variant based on colors or default to primary
				let variant = "primary" // Default to primary for best styling
				if (bgColor) {
					const lowerBg = bgColor.toLowerCase()
					if (lowerBg.includes("ef4444") || lowerBg.includes("dc2626") || lowerBg.includes("red")) {
						variant = "danger"
					} else if (lowerBg.includes("f1f5f9") || lowerBg.includes("e5e7eb") || lowerBg.includes("gray") || lowerBg.includes("secondary")) {
						variant = "secondary"
					} else if (lowerBg === "transparent" || lowerBg.includes("outline")) {
						variant = "outline"
					}
				}
				
				// Determine size based on height
				let size = "md"
				if (height >= 52) {
					size = "lg"
				} else if (height <= 32) {
					size = "sm"
				}
				
				const buttonArgs: Record<string, unknown> = {
					x: posX,
					y: posY,
					width,
					label: textContent,
					variant,
					size,
				}
				if (containerFrame) {
					buttonArgs.parentId = containerFrame
				}

				try {
					console.log(`[ParallelUI Direct] Using UIDesignCanvas create_button for "${textContent}"`)
					const buttonResult = await this.mcpHub!.callTool("UIDesignCanvas", "create_button", buttonArgs)
					const buttonNodeId = this.extractNodeIdFromResult(buttonResult)
					if (buttonNodeId) {
						nodeIds.push(buttonNodeId)
						console.log(`[ParallelUI Direct] ✓ Button created with create_button, ID: ${buttonNodeId}`)
					}
					onProgress?.(task.id, "completed")
					return {
						taskId: task.id,
						success: true,
						nodeIds,
						duration: Date.now() - startTime,
					}
				} catch (err) {
					console.warn(`[ParallelUI Direct] create_button failed, falling back to basic tools:`, err)
					// Fall through to basic tool approach
				}
			}

			// Fallback: Use basic create_rectangle + text approach for other design servers
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

				// Step 1.6: Set fill color - TalkToFigma's create_rectangle doesn't accept color parameter
				// We MUST call set_fill_color separately to apply the background color
				try {
					console.log(`[ParallelUI Direct] Setting fill color ${bgColor} for rectangle ${rectNodeId}`)
					const fillColorArgs: Record<string, unknown> = {
						nodeId: rectNodeId,
						hex: bgColor,
					}
					const { mappedName: fillColorToolName, mappedArgs: fillColorMappedArgs } = this.mapToolForServer(
						"set_fill",
						fillColorArgs,
					)
					await this.mcpHub!.callTool(this.activeFigmaServer, fillColorToolName, fillColorMappedArgs)
					console.log(`[ParallelUI Direct] ✓ Fill color ${bgColor} set successfully for rectangle ${rectNodeId}`)
				} catch (e) {
					console.error(`[ParallelUI Direct] ✗ Failed to set fill color for ${rectNodeId}:`, e)
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

		// Check for duplicate frame creation
		if (toolName === "create_frame") {
			const frameName = args.name as string | undefined
			if (frameName && !this.tryClaimFrameName(frameName)) {
				console.log(`[ParallelUI] ⚠️ safeMcpToolCall: Skipping duplicate create_frame for "${frameName}"`)
				// Return a mock success response
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								skipped: true,
								message: `Frame "${frameName}" already exists or was claimed, skipping`,
							}),
						},
					],
				}
			}
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
	 * Execute a single UI task using an AI agent with ISOLATED CONTEXT
	 * Each task gets its own separate conversation history
	 * @param colorContext Color scheme context containing all colors being used in this session
	 * @param frameInfo Container frame dimensions to inform AI about boundaries
	 */
	private async executeSingleTask(
		task: UITaskDefinition,
		onProgress?: (taskId: string, status: string) => void,
		containerFrame?: string,
		existingElements?: string[],
		colorContext?: { bgColors: string[]; textColors: string[] },
		frameInfo?: { width: number; height: number; name: string } | null,
	): Promise<UITaskResult> {
		const startTime = Date.now()
		const nodeIds: string[] = []

		// Create ISOLATED context for this specific task
		// Each AI agent gets its own conversation history
		const agentRole = this.determineAgentRole(task)
		const agentContext = this.contextManager.createContext({
			role: agentRole,
			taskData: {
				taskId: task.id,
				description: task.description,
				containerFrame,
				position: task.position,
				designSpec: task.designSpec,
			},
		})

		// Map task ID to context ID for cleanup
		this.taskContextMap.set(task.id, agentContext.id)
		console.log(`[ParallelUI] Task ${task.id} assigned to isolated context ${agentContext.id} (role: ${agentRole})`)

		try {
			onProgress?.(task.id, "starting")
			this.contextManager.setState(agentContext.id, "active")

			// Build the prompt for this specific task with color context and frame info
			const taskPrompt = this.buildTaskPrompt(task, containerFrame, existingElements, colorContext, frameInfo)

			// Create API handler for this task (each task gets its own handler)
			const api = buildApiHandler(this.apiConfiguration!)

			// Make the API call with ISOLATED context
			await this.callAIForUITask(api, taskPrompt, task, nodeIds, onProgress, agentContext)

			// Check if any nodes were actually created
			if (nodeIds.length === 0) {
				console.warn(
					`[ParallelUI] Task ${task.id} completed but created 0 nodes - model may not support tool calling`,
				)
				onProgress?.(task.id, "no nodes created")
				this.contextManager.setState(agentContext.id, "failed")
				return {
					taskId: task.id,
					success: false,
					nodeIds,
					error: "模型未生成工具調用 - 請確認使用支援 tool use 的模型 (如 Claude)",
					duration: Date.now() - startTime,
				}
			}

			onProgress?.(task.id, "completed")
			this.contextManager.setState(agentContext.id, "completed")

			// Log context stats for this task
			const context = this.contextManager.getContext(agentContext.id)
			if (context) {
				console.log(
					`[ParallelUI] Task ${task.id} context stats: ${context.messages.length} messages, ` +
						`${context.metadata.apiCallCount} API calls, ` +
						`${context.metadata.tokenUsage.input + context.metadata.tokenUsage.output} tokens`,
				)
			}

			return {
				taskId: task.id,
				success: true,
				nodeIds,
				duration: Date.now() - startTime,
			}
		} catch (error) {
			onProgress?.(task.id, "failed")
			this.contextManager.setState(agentContext.id, "failed")
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
	 * Determine the agent role based on task characteristics
	 */
	private determineAgentRole(task: UITaskDefinition): string {
		const description = (task.description || "").toLowerCase()
		const text = (task.designSpec?.text || "").toLowerCase()

		// Check for frame/container tasks
		if (description.includes("frame") || description.includes("container")) {
			return "ui-frame"
		}

		// Check for display/screen tasks
		if (
			description.includes("display") ||
			description.includes("screen") ||
			description.includes("result") ||
			text === "0" && (task.designSpec?.width || 0) > 100
		) {
			return "ui-display"
		}

		// Check for layout tasks
		if (description.includes("layout") || description.includes("arrange") || description.includes("position")) {
			return "ui-layout"
		}

		// Default to button for most UI elements
		return "ui-button"
	}

	/**
	 * Build the prompt for a specific UI task
	 * NOTE: Positions are now ABSOLUTE - we tell the sub-AI exactly where to place elements
	 * If containerFrame is provided, elements will be created inside that frame
	 * @param colorContext Optional color scheme context to inform the sub-AI about overall colors
	 * @param frameInfo Optional frame dimensions to inform the sub-AI about boundaries
	 */
	private buildTaskPrompt(
		task: UITaskDefinition,
		containerFrame?: string,
		existingElements?: string[],
		colorContext?: { bgColors: string[]; textColors: string[] },
		frameInfo?: { width: number; height: number; name: string } | null,
	): string {
		const width = task.designSpec?.width || 90
		const height = task.designSpec?.height || 60

		// Get absolute position (this is the final position, no offset will be added later)
		const posX = task.position?.x || 0
		const posY = task.position?.y || 0

		// Extract design specs with defaults
		const cornerRadius = task.designSpec?.cornerRadius || 12 // Modern rounded corners
		const fontSize = task.designSpec?.fontSize || 16 // Modern font size

		// Get text content - try to extract from various sources if not explicitly provided
		let textContent: string = task.designSpec?.text || ""
		if (!textContent) {
			const extracted = this.extractTextFromTaskId(task.id, task.description)
			textContent = extracted || "Button" // Better default than "?"
		}

		// Check if colors are explicitly provided by user
		const hasExplicitColors = task.designSpec?.colors && task.designSpec.colors.length > 0
		const bgColor = task.designSpec?.colors?.[0] || null // null means AI decides
		const textColor = task.designSpec?.colors?.[1] || null // null means AI decides

		// Determine element type for AI color guidance
		const isOperator = ["+", "-", "×", "÷", "*", "/", "="].includes(textContent)
		const isClear = ["C", "AC", "CE", "CLR"].includes(textContent.toUpperCase())
		const isNumber = /^[0-9.]$/.test(textContent)
		const isActionButton = ["submit", "ok", "save", "add", "確認", "送出", "添加", "新增"].some((k) =>
			textContent.toLowerCase().includes(k.toLowerCase()),
		)
		const isDisplay = task.description?.toLowerCase().includes("display") || task.id?.toLowerCase().includes("display")

		// Build element type hint for AI
		let elementTypeHint = "button"
		if (isOperator) elementTypeHint = "operator button (like +, -, ×, ÷, =)"
		else if (isClear) elementTypeHint = "clear/reset button (like C, AC)"
		else if (isNumber) elementTypeHint = "number button (0-9)"
		else if (isActionButton) elementTypeHint = "action button (submit, confirm, save)"
		else if (isDisplay) elementTypeHint = "display/screen area"

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
			`[ParallelUI] Task ${task.id}: text="${textContent}", type="${elementTypeHint}", pos=(${posX}, ${posY}), size=${width}x${height}, colors: ${hasExplicitColors ? `bg=${bgColor}, text=${textColor}` : "AI decides"}`,
		)

		// Simple, direct prompt with EXACT coordinates - sub-AI must use these exact values
		// IMPORTANT: Use "radius" (not "cornerRadius") for TalkToFigma compatibility
		let prompt = `Create a UI element "${textContent}" at EXACT position (${posX}, ${posY})\n\n`

		// Add element type for AI color decision
		prompt += `🎯 **Element Type:** ${elementTypeHint}\n\n`

		// Add frame boundary information if available
		if (frameInfo) {
			prompt += `📐 **Container Frame Info (容器 Frame 資訊):**\n`
			prompt += `- Frame name: "${frameInfo.name}"\n`
			prompt += `- Frame size: ${frameInfo.width}px × ${frameInfo.height}px\n`
			prompt += `- Valid X range: 0 to ${frameInfo.width - width} (your element width is ${width})\n`
			prompt += `- Valid Y range: 0 to ${frameInfo.height - height} (your element height is ${height})\n`
			prompt += `- ⚠️ IMPORTANT: All elements MUST be placed WITHIN these boundaries!\n\n`
		}

		// Add color context to inform sub-AI about the overall color scheme
		if (colorContext && (colorContext.bgColors.length > 0 || colorContext.textColors.length > 0)) {
			prompt += `🎨 **Color Scheme Context (其他元素使用的顏色，供參考):**\n`
			if (colorContext.bgColors.length > 0) {
				prompt += `- Other background colors: ${[...new Set(colorContext.bgColors)].join(", ")}\n`
			}
			if (colorContext.textColors.length > 0) {
				prompt += `- Other text colors: ${[...new Set(colorContext.textColors)].join(", ")}\n`
			}
			prompt += `\n`
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

		// Build color instructions - either explicit or AI-decided
		let colorInstructions: string
		let textColorInstructions: string
		if (hasExplicitColors) {
			// User provided explicit colors - use them exactly
			colorInstructions = `   - hex: "${bgColor}"  ← Use this EXACT color!\n`
			textColorInstructions = `hex="${textColor}"`
			prompt += `⚠️ CRITICAL: You MUST use the EXACT coordinates and parameters provided.\n\n`
		} else {
			// Let AI decide colors based on element type - provide specific suggestions
			prompt += `🎨 **MODERN MINIMALIST COLOR (現代簡約配色):**\n`
			prompt += `Element type: "${elementTypeHint}"\n\n`

			// Modern minimalist color palette - softer, more sophisticated colors
			let suggestedBg = "#3B82F6" // default: modern blue
			let suggestedText = "#FFFFFF"

			if (isNumber) {
				suggestedBg = "#F1F5F9" // light slate for numbers (modern, not dark)
				suggestedText = "#1E293B" // dark slate text
			} else if (isOperator) {
				suggestedBg = "#6366F1" // indigo for operators (more modern than orange)
				suggestedText = "#FFFFFF"
			} else if (isClear) {
				suggestedBg = "#F1F5F9" // subtle light for clear (not harsh red)
				suggestedText = "#EF4444" // red text instead
			} else if (isActionButton) {
				suggestedBg = "#3B82F6" // blue for primary actions
				suggestedText = "#FFFFFF"
			} else if (isDisplay) {
				suggestedBg = "#F8FAFC" // very light for display (modern minimalist)
				suggestedText = "#1E293B" // dark text
			} else if (task.description?.toLowerCase().includes("input")) {
				suggestedBg = "#FFFFFF" // white for input
				suggestedText = "#64748B" // placeholder gray
			} else if (task.description?.toLowerCase().includes("title") || task.description?.toLowerCase().includes("header")) {
				suggestedBg = "#FFFFFF" // clean white header (minimalist)
				suggestedText = "#1E293B" // dark text
			} else if (task.description?.toLowerCase().includes("list") || task.description?.toLowerCase().includes("item")) {
				suggestedBg = "#FFFFFF" // white for list items
				suggestedText = "#334155" // slate-700 text
			} else if (task.description?.toLowerCase().includes("card") || task.description?.toLowerCase().includes("container")) {
				suggestedBg = "#FFFFFF" // white cards
				suggestedText = "#334155"
			} else if (task.description?.toLowerCase().includes("secondary") || task.description?.toLowerCase().includes("cancel")) {
				suggestedBg = "#F1F5F9" // light slate for secondary
				suggestedText = "#475569" // medium slate text
			} else if (task.description?.toLowerCase().includes("delete") || task.description?.toLowerCase().includes("remove")) {
				suggestedBg = "#FEE2E2" // very light red (subtle, not harsh)
				suggestedText = "#DC2626" // red text
			}

			prompt += `**MODERN MINIMALIST colors for this element:**\n`
			prompt += `- Background: ${suggestedBg} (subtle, clean)\n`
			prompt += `- Text: ${suggestedText} (high contrast but not harsh)\n`
			prompt += `- Remember: NO emoji, NO harsh colors, keep it CLEAN!\n\n`

			colorInstructions = `   - hex: "${suggestedBg}"  ← Modern minimalist color\n`
			textColorInstructions = `hex="${suggestedText}"`
		}

		prompt += `EXECUTE THESE 4 TOOL CALLS IN ORDER:\n\n`
		prompt += `1. create_rectangle with these parameters:\n`
		prompt += `   - width: ${width}\n`
		prompt += `   - height: ${height}\n`
		prompt += `   - x: ${posX}\n`
		prompt += `   - y: ${posY}\n`
		prompt += `   - radius: ${cornerRadius}  ← REQUIRED for rounded corners!\n`
		if (containerFrame) {
			prompt += `   - parentId: "${containerFrame}"\n`
		}
		prompt += `   (Note: Rectangle will be created without color - we set color in step 2)\n`
		prompt += `\n`
		prompt += `2. set_fill with: nodeId=<the ID returned from step 1>, ${hasExplicitColors ? `hex="${bgColor}"` : `hex="${colorInstructions.match(/"#[A-Fa-f0-9]{6}"/)?.[0]?.replace(/"/g, "") || "#3B82F6"}"  ← Background color for ${elementTypeHint}`}\n\n`

		prompt += `3. add_text with: text="${textContent}", x=${textX}, y=${textY}, fontSize=${fontSize}${containerFrame ? `, parentId="${containerFrame}"` : ""}\n\n`

		prompt += `4. set_text_color with: nodeId=<the ID returned from step 3>, ${textColorInstructions}\n\n`

		prompt += `⚠️ MANDATORY SEQUENCE - DO NOT SKIP ANY STEP:\n`
		prompt += `- Step 1: create_rectangle (radius=${cornerRadius} is REQUIRED)\n`
		prompt += `- Step 2: set_fill (MUST call this to apply background color!)\n`
		prompt += `- Step 3: add_text\n`
		prompt += `- Step 4: set_text_color\n`
		prompt += `- Position (x=${posX}, y=${posY}) must be EXACT\n`
		prompt += `\nSTART NOW with create_rectangle including radius=${cornerRadius}.`

		return prompt
	}

	/**
	 * Call AI to create UI and execute Figma commands
	 * Uses ISOLATED context for each agent - no shared conversation history
	 * @param agentContext The isolated context for this specific agent
	 */
	private async callAIForUITask(
		api: ApiHandler,
		prompt: string,
		task: UITaskDefinition,
		nodeIds: string[],
		onProgress?: (taskId: string, status: string) => void,
		agentContext?: AgentContext,
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

		// Use isolated context if provided, otherwise create local messages
		// Each agent has its OWN conversation history - complete context isolation
		const contextId = agentContext?.id
		const systemPrompt = agentContext
			? this.contextManager.getSystemPrompt(contextId!)
			: UI_AGENT_SYSTEM_PROMPT

		// Add initial user message to isolated context
		if (contextId) {
			this.contextManager.addUserMessage(contextId, prompt)
			console.log(`[ParallelUI] Task ${task.id} - Using ISOLATED context: ${contextId}`)
		}

		// Get messages from context (isolated per agent)
		const getMessages = (): Anthropic.MessageParam[] => {
			if (contextId) {
				return this.contextManager.getMessages(contextId)
			}
			// Fallback for backward compatibility
			return [{ role: "user", content: prompt }]
		}

		let continueLoop = true
		let iterations = 0
		const maxIterations = 10 // Prevent infinite loops

		while (continueLoop && iterations < maxIterations) {
			iterations++
			onProgress?.(task.id, `iteration ${iterations}`)

			// Get current messages from isolated context
			const messages = getMessages()

			try {
				// DEBUG: Log the request being sent
				console.log(`\n========== [ParallelUI] Task ${task.id} - REQUEST (Context: ${contextId || 'local'}) ==========`)
				console.log(`[ParallelUI] System Prompt: ${systemPrompt.substring(0, 200)}...`)
				console.log(`[ParallelUI] Messages count: ${messages.length} (ISOLATED per agent)`)
				console.log(`[ParallelUI] Last message role: ${messages[messages.length - 1]?.role}`)
				console.log(`[ParallelUI] Tools count: ${tools.length}`)
				console.log(`[ParallelUI] Tools: ${JSON.stringify(tools.map((t) => t.function.name))}`)
				console.log(
					`[ParallelUI] Full request metadata:`,
					JSON.stringify(
						{
							taskId: `parallel-ui-${task.id}`,
							contextId: contextId || "local",
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

				const stream = api.createMessage(systemPrompt, messages, {
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
							// Check for duplicate frame creation BEFORE executing
							// Use atomic tryClaimFrameName to prevent race conditions between parallel tasks
							if (toolName === "create_frame") {
								const frameName = args.name as string | undefined
								if (frameName && !this.tryClaimFrameName(frameName)) {
									console.log(`[ParallelUI] ⚠️ Skipping duplicate create_frame for "${frameName}"`)
									return {
										type: "tool_result" as const,
										tool_use_id: toolUse.id,
										content: JSON.stringify({
											success: true,
											skipped: true,
											message: `Frame "${frameName}" already exists or was claimed by another task, skipping creation`,
										}),
									}
								}
								// Frame name already claimed in tryClaimFrameName if successful
							}

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

				// Add assistant message and tool results to ISOLATED context
				// Each agent's conversation history is completely separate
				if (contextId) {
					this.contextManager.addAssistantMessage(contextId, assistantContent)
					this.contextManager.addUserMessage(contextId, toolResults)

					// Record tool results in context
					for (const toolResult of toolResults) {
						const toolUse = toolUseBlocks.find((t) => t.id === toolResult.tool_use_id)
						if (toolUse) {
							this.contextManager.recordToolResult(
								contextId,
								toolResult.tool_use_id,
								toolUse.name,
								toolResult.content,
							)
						}
					}

					console.log(`[ParallelUI] Task ${task.id} - Added messages to isolated context ${contextId}`)
				}

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
					hex: {
						type: "string",
						description:
							"(Optional) Fill color - NOTE: This may be ignored. Use set_fill after create_rectangle to reliably apply color.",
					},
					color: { type: "string", description: "Alternative: Fill color as hex (may be ignored - use set_fill instead)" },
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
