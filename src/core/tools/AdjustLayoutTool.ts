/**
 * Adjust Layout Tool
 *
 * Automatically arranges Figma nodes in a specified layout (grid, row, column).
 * Supports two modes:
 * 1. Algorithm mode: Calculates positions mathematically
 * 2. AI mode: Uses parallel AI agents to intelligently adjust position, layer, and color
 */

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

// Maximum number of parallel AI adjustments
const MAX_PARALLEL_AGENTS = 8

interface AdjustLayoutParams {
	layout: string // "grid" | "row" | "column"
	columns?: string // Number of columns for grid layout
	gap?: string // Gap between elements in pixels
	gapX?: string // Horizontal gap (overrides gap)
	gapY?: string // Vertical gap (overrides gap)
	startX?: string // Starting X position
	startY?: string // Starting Y position
	within?: string // Optional: container node ID to search within
	nodeIds?: string // Optional: JSON array of node IDs (if not provided, finds all nodes within container)
	excludeTypes?: string // Optional: node types to exclude (e.g., "FRAME,GROUP")
	sortBy?: string // Optional: "name" | "x" | "y" | "created" (default: "name")
	useAI?: string // Optional: "true" to use parallel AI agents for intelligent adjustment
	adjustColors?: string // Optional: "true" to let AI adjust colors
	adjustLayers?: string // Optional: "true" to let AI adjust layer order
}

interface NodeInfo {
	id: string
	name: string
	type: string
	x: number
	y: number
	width: number
	height: number
	fills?: unknown[]
	characters?: string // Actual text content for TEXT nodes
}

interface ColorInfo {
	nodeId: string
	nodeName: string
	nodeType: string
	backgroundColor?: string // Hex color for rectangles
	textColor?: string // Hex color for text nodes
}

interface LayoutContext {
	containerWidth: number
	containerHeight: number
	/** Frame's X position on canvas - must be added to all element positions */
	offsetX: number
	/** Frame's Y position on canvas - must be added to all element positions */
	offsetY: number
	totalElements: number
	displayElements: number
	buttonElements: number
	layout: string
	columns: number
	gapX: number
	gapY: number
	startX: number
	startY: number
}

export class AdjustLayoutTool extends BaseTool<"adjust_layout"> {
	readonly name = "adjust_layout" as const

	parseLegacy(params: Partial<Record<string, string>>): AdjustLayoutParams {
		return {
			layout: params.layout || "grid",
			columns: params.columns,
			gap: params.gap,
			gapX: params.gapX,
			gapY: params.gapY,
			startX: params.startX,
			startY: params.startY,
			within: params.within,
			nodeIds: params.nodeIds,
			excludeTypes: params.excludeTypes,
			sortBy: params.sortBy,
			useAI: params.useAI,
			adjustColors: params.adjustColors,
			adjustLayers: params.adjustLayers,
		}
	}

	async execute(params: AdjustLayoutParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Parse numeric parameters with defaults
			const layout = params.layout || "grid"
			const columns = parseInt(params.columns || "4", 10)
			const gap = parseInt(params.gap || "10", 10)
			const gapX = parseInt(params.gapX || String(gap), 10)
			const gapY = parseInt(params.gapY || String(gap), 10)
			const startX = parseInt(params.startX || "20", 10)
			const startY = parseInt(params.startY || "20", 10)
			const sortBy = params.sortBy || "name"
			// Algorithm mode is now the default (AI mode often makes bad decisions)
			// Use useAI="true" to enable AI-based layout
			const useAI = params.useAI === "true"
			const adjustColors = params.adjustColors === "true"
			// adjustLayers defaults to true for better text visibility
			const adjustLayers = params.adjustLayers !== "false"

			// Validate layout type
			if (!["grid", "row", "column"].includes(layout)) {
				task.consecutiveMistakeCount++
				task.recordToolError("adjust_layout")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Invalid layout type: "${layout}". ` + `Supported types: "grid", "row", "column"`,
					),
				)
				return
			}

			// Get McpHub
			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const mcpHub = provider.getMcpHub?.()
			if (!mcpHub) {
				pushToolResult(formatResponse.toolError("McpHub not available"))
				return
			}

			// Determine which Figma server to use based on user settings
			const state = await provider.getState()
			const talkToFigmaEnabled = state.talkToFigmaEnabled ?? true  // Default true
			const figmaWriteEnabled = state.figmaWriteEnabled ?? false   // Default false

			const servers = mcpHub.getServers()
			const talkToFigmaConnected = servers.find((s) => s.name === "TalkToFigma" && s.status === "connected")
			const figmaWriteConnected = servers.find((s) => s.name === "figma-write" && s.status === "connected")

			let figmaServer: typeof talkToFigmaConnected = undefined

			// Use settings to determine preferred server
			if (talkToFigmaEnabled && talkToFigmaConnected) {
				figmaServer = talkToFigmaConnected
			} else if (figmaWriteEnabled && figmaWriteConnected) {
				figmaServer = figmaWriteConnected
			} else if (talkToFigmaConnected) {
				// Fallback: use TalkToFigma if connected
				figmaServer = talkToFigmaConnected
			} else if (figmaWriteConnected) {
				// Fallback: use figma-write if connected
				figmaServer = figmaWriteConnected
			}

			if (!figmaServer) {
				pushToolResult(
					formatResponse.toolError(
						"No Figma MCP server connected. Please ensure figma-write or TalkToFigma is running.",
					),
				)
				return
			}
			const serverName = figmaServer.name
			console.log(`[AdjustLayout] Using Figma server: ${serverName} (settings: talkToFigma=${talkToFigmaEnabled}, figmaWrite=${figmaWriteEnabled}), AI mode: ${useAI}`)

			// Helper to call Figma tools with server-appropriate mapping
			const callFigmaTool = async (toolName: string, args: Record<string, unknown>) => {
				let mappedName = toolName
				const mappedArgs = { ...args }

				if (serverName === "TalkToFigma") {
					// Map tool names for TalkToFigma based on MCP documentation
					const toolMapping: Record<string, string> = {
						set_position: "move_node",
						find_nodes: "scan_nodes_by_types",
						set_fill: "set_fill_color",
						set_text_color: "set_fill_color",
						add_text: "create_text",
					}
					mappedName = toolMapping[toolName] || toolName
				}

				return mcpHub.callTool(serverName, mappedName, mappedArgs)
			}

			// Get nodes to arrange
			let nodes: NodeInfo[] = []
			let containerInfo: { width: number; height: number; offsetX: number; offsetY: number } = {
				width: 400, height: 600, offsetX: 0, offsetY: 0
			}

			// Parse nodeIds if provided
			let nodeIds: string[] = []
			if (params.nodeIds) {
				try {
					nodeIds = JSON.parse(params.nodeIds)
					// Filter out empty strings and invalid IDs
					nodeIds = nodeIds.filter((id) => id && typeof id === "string" && id.trim().length > 0)
				} catch {
					console.warn("[AdjustLayout] Invalid nodeIds format, will try 'within' parameter")
				}
			}

			// Use nodeIds if we have valid IDs, otherwise fallback to 'within'
			if (nodeIds.length > 0) {
				await task.say("text", `🔍 正在獲取 ${nodeIds.length} 個節點的資訊...`)

				if (serverName === "TalkToFigma") {
					const result = await callFigmaTool("get_nodes_info", { nodeIds })
					nodes = this.parseNodesFromResult(result)
				} else {
					const findResult = await callFigmaTool("find_nodes", { within: params.within })
					const allNodes = this.parseNodesFromResult(findResult)
					nodes = allNodes.filter((n) => nodeIds.includes(n.id))
				}
			} else if (params.within) {
				// Find all nodes within the specified container
				await task.say("text", `🔍 正在搜索容器 ${params.within} 內的節點...`)

				if (serverName === "TalkToFigma") {
					const result = await callFigmaTool("get_node_info", { nodeId: params.within })
					const containerData = this.parseContainerInfo(result)
					containerInfo = {
						width: containerData.width,
						height: containerData.height,
						offsetX: containerData.offsetX,
						offsetY: containerData.offsetY,
					}

					const { nodes: parsedNodes, duplicateIds } = this.parseChildrenFromNodeInfo(result, params.within)
					nodes = parsedNodes

					// Delete duplicate nodes from Figma to clean up
					if (duplicateIds.length > 0) {
						await task.say("text", `🗑️ 發現 ${duplicateIds.length} 個重複元素，正在清理...`)
						const deleteResults = await Promise.allSettled(
							duplicateIds.map((id) => callFigmaTool("delete_node", { nodeId: id })),
						)
						const successCount = deleteResults.filter((r) => r.status === "fulfilled").length
						console.log(`[AdjustLayout] Deleted ${successCount}/${duplicateIds.length} duplicate nodes`)
					}
				} else {
					const findResult = await callFigmaTool("find_nodes", { within: params.within })
					nodes = this.parseNodesFromResult(findResult)
				}

				// Exclude specified types
				if (params.excludeTypes) {
					const excludeList = params.excludeTypes.split(",").map((t) => t.trim().toUpperCase())
					nodes = nodes.filter((n) => !excludeList.includes(n.type))
				}

				// Exclude the container itself
				nodes = nodes.filter((n) => n.id !== params.within)
			} else {
				pushToolResult(
					formatResponse.toolError("Please specify 'within' (container frame ID) or 'nodeIds' parameter."),
				)
				return
			}

			if (nodes.length === 0) {
				// Provide more helpful error message
				let helpMsg =
					"No nodes found to arrange.\n\n" +
					"Tips:\n" +
					"1. Make sure you provide a valid 'within' parameter (container frame ID)\n" +
					"2. Or provide 'nodeIds' with valid node IDs from previous create operations\n" +
					"3. Use TalkToFigma's get_selection or get_document_info to find frame IDs"

				if (params.within) {
					helpMsg += `\n\nYou provided within="${params.within}" but no children were found. The frame might be empty or the ID might be incorrect.`
				}
				if (params.nodeIds) {
					helpMsg += `\n\nYou provided nodeIds but the array was empty or contained invalid IDs.`
				}

				pushToolResult(formatResponse.toolResult(helpMsg))
				return
			}

			task.consecutiveMistakeCount = 0

			// Group elements
			const { paired, standalone, display } = this.groupButtonPairs(nodes)

			// Build layout context
			const layoutContext: LayoutContext = {
				containerWidth: containerInfo.width,
				containerHeight: containerInfo.height,
				offsetX: containerInfo.offsetX,
				offsetY: containerInfo.offsetY,
				totalElements: nodes.length,
				displayElements: display.length,
				buttonElements: paired.length,
				layout,
				columns,
				gapX,
				gapY,
				startX,
				startY,
			}

			const totalItems = paired.length + standalone.length + display.length

			// Show approval message
			const toolMessage = JSON.stringify({
				tool: "adjustLayout",
				mode: useAI ? "AI" : "algorithm",
				layout,
				nodeCount: nodes.length,
				displayElements: display.length,
				buttonPairs: paired.length,
				standaloneNodes: standalone.length,
				adjustColors,
				adjustLayers,
				columns: layout === "grid" ? columns : undefined,
				gap: { x: gapX, y: gapY },
				start: { x: startX, y: startY },
			})

			const modeDescription = useAI ? "🤖 AI 模式 - 每個元素由 AI 智能調整" : "📐 演算法模式 - 數學計算位置"

			await task.say(
				"text",
				`${modeDescription}\n\n` +
					`將 ${totalItems} 個元素排列為 ${layout} 佈局：\n` +
					`- 顯示器: ${display.length} 個\n` +
					`- 按鈕對 (Rectangle+Text): ${paired.length} 個\n` +
					`- 獨立節點: ${standalone.length} 個\n` +
					`- 起始位置: (${startX}, ${startY})\n` +
					`- 間距: ${gapX}px × ${gapY}px\n` +
					(layout === "grid" ? `- 欄數: ${columns}\n` : "") +
					(useAI ? `- 調整顏色: ${adjustColors ? "是" : "否"}\n` : "") +
					(useAI ? `- 調整圖層: ${adjustLayers ? "是" : "否"}\n` : ""),
			)

			const didApprove = await askApproval("tool", toolMessage)
			if (!didApprove) {
				return
			}

			const startTime = Date.now()

			if (useAI) {
				// AI MODE: Use parallel AI agents
				await this.executeWithParallelAI(
					task,
					mcpHub,
					serverName,
					paired,
					standalone,
					display,
					layoutContext,
					adjustColors,
					adjustLayers,
					pushToolResult,
				)
			} else {
				// ALGORITHM MODE: Mathematical calculation
				await this.executeWithAlgorithm(
					task,
					callFigmaTool,
					paired,
					standalone,
					display,
					layoutContext,
					pushToolResult,
				)
			}

			const duration = Date.now() - startTime
			console.log(`[AdjustLayout] Completed in ${duration}ms`)
		} catch (error) {
			await handleError("adjusting layout", error as Error)
		}
	}

	/**
	 * Execute layout adjustment using AI to decide positions
	 * AI analyzes elements and decides optimal positions for each one
	 */
	private async executeWithParallelAI(
		task: Task,
		mcpHub: any,
		serverName: string,
		paired: Array<{ rect: NodeInfo; text: NodeInfo }>,
		standalone: NodeInfo[],
		display: Array<{ rect: NodeInfo; text?: NodeInfo }>,
		context: LayoutContext,
		adjustColors: boolean,
		adjustLayers: boolean,
		pushToolResult: (result: string) => void,
	): Promise<void> {
		await task.say("text", `🤖 正在分析佈局...`)

		// Build element descriptions
		const allElements: Array<{
			id: string
			name: string
			type: "display" | "button" | "standalone"
			rectId: string
			textId?: string
			width: number
			height: number
			currentX: number
			currentY: number
			text?: string
		}> = []

		// Add display elements
		for (let i = 0; i < display.length; i++) {
			const disp = display[i]
			allElements.push({
				id: `display-${i}`,
				name: disp.rect.name,
				type: "display",
				rectId: disp.rect.id,
				textId: disp.text?.id,
				width: disp.rect.width,
				height: disp.rect.height,
				currentX: disp.rect.x,
				currentY: disp.rect.y,
				text: disp.text?.name,
			})
		}

		// Add button pairs
		for (let i = 0; i < paired.length; i++) {
			const pair = paired[i]
			// Try to extract button text/label from text node name or text content
			const buttonText = this.extractButtonText(pair.text)
			allElements.push({
				id: `button-${i}`,
				name: pair.rect.name,
				type: "button",
				rectId: pair.rect.id,
				textId: pair.text.id,
				width: pair.rect.width,
				height: pair.rect.height,
				currentX: pair.rect.x,
				currentY: pair.rect.y,
				text: buttonText,
			})
		}

		// Add standalone elements
		for (let i = 0; i < standalone.length; i++) {
			const node = standalone[i]
			allElements.push({
				id: `standalone-${i}`,
				name: node.name,
				type: "standalone",
				rectId: node.id,
				width: node.width,
				height: node.height,
				currentX: node.x,
				currentY: node.y,
			})
		}

		// Detect UI type for logging
		const uiType = this.detectUIType(allElements)
		await task.say("text", `🤖 AI 正在分析 ${uiType} UI 並決定最佳佈局...`)

		// Ask AI to decide positions
		const aiPrompt = this.buildLayoutAIPrompt(allElements, context)

		try {
			let aiPositions = await this.getAIPositionDecisions(task, aiPrompt, allElements, context)

			// Apply boundary checking to ensure elements stay within container
			aiPositions = this.clampPositionsToContainer(
				aiPositions,
				allElements.map((e) => ({ id: e.id, width: e.width, height: e.height })),
				context.containerWidth,
				context.containerHeight,
				context.startX, // Use startX as margin
			)

			await task.say("text", `🎯 AI 已決定 ${aiPositions.length} 個元素的位置...`)

			// If adjustColors is enabled, extract and show color info for approval
			let colorInfoList: ColorInfo[] = []
			if (adjustColors) {
				await task.say("text", `🎨 正在提取顏色資訊以供審批...`)

				// Collect all nodes for color extraction
				const allNodes: NodeInfo[] = [
					...display.map((d) => d.rect),
					...display.filter((d) => d.text).map((d) => d.text!),
					...paired.map((p) => p.rect),
					...paired.map((p) => p.text),
					...standalone,
				]

				colorInfoList = await this.extractColorInfo(mcpHub, serverName, allNodes)

				if (colorInfoList.length > 0) {
					const colorSummary = this.buildColorSummary(colorInfoList)

					// Show color info and ask for approval
					const colorApprovalMessage = JSON.stringify({
						tool: "colorApproval",
						action: "審批顏色 (Color Approval)",
						colors: colorInfoList.map((c) => ({
							name: c.nodeName,
							type: c.nodeType,
							bg: c.backgroundColor,
							text: c.textColor,
						})),
					})

					await task.say(
						"text",
						`🎨 **顏色審批 (Color Approval)**\n\n` +
							colorSummary +
							`\n請確認以上顏色是否正確。如需調整顏色，請取消並指定新的顏色。`,
					)

					// Ask for color approval
					const colorApproved = await task.ask("tool", colorApprovalMessage)

					if (colorApproved.response !== "yesButtonClicked") {
						await task.say("text", `❌ 顏色審批被取消，請重新指定顏色後再試。`)
						pushToolResult(
							formatResponse.toolResult(
								`Color approval was cancelled. Please specify the desired colors and try again.`,
							) as string,
						)
						return
					}

					await task.say("text", `✅ 顏色已審批通過，繼續執行佈局調整...`)
				}
			}

			await task.say("text", `🚀 開始執行佈局調整...`)

			// Execute all position changes
			// NOTE: move_node uses coordinates RELATIVE to parent frame, not absolute canvas coordinates
			console.log(`[AdjustLayout] Positions are relative to frame (no offset needed)`)

			const calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = []

			for (const pos of aiPositions) {
				const element = allElements.find((e) => e.id === pos.id)
				if (!element) continue

				// Move rectangle - positions are relative to parent frame
				calls.push({
					server: serverName,
					tool: serverName === "TalkToFigma" ? "move_node" : "set_position",
					args: {
						nodeId: element.rectId,
						x: pos.x,
						y: pos.y,
					},
				})

				// Move text (centered within rectangle)
				if (element.textId) {
					// Calculate text centering
					const textElement =
						element.type === "button"
							? paired.find((p) => p.rect.id === element.rectId)?.text
							: display.find((d) => d.rect.id === element.rectId)?.text

					if (textElement) {
						const textX = pos.x + Math.floor((element.width - textElement.width) / 2)
						const textY = pos.y + Math.floor((element.height - textElement.height) / 2)

						calls.push({
							server: serverName,
							tool: serverName === "TalkToFigma" ? "move_node" : "set_position",
							args: {
								nodeId: element.textId,
								x: textX,
								y: textY,
							},
						})
					}
				}

				// Set corner radius if it's a rectangle
				if (element.type === "button" || element.type === "display") {
					const cornerRadius = element.type === "button" ? 8 : 8
					calls.push({
						server: serverName,
						tool: "set_corner_radius",
						args: {
							nodeId: element.rectId,
							radius: cornerRadius,
							cornerRadius: cornerRadius,
							// Per-corner parameters for TalkToFigma compatibility
							topLeft: cornerRadius,
							topRight: cornerRadius,
							bottomRight: cornerRadius,
							bottomLeft: cornerRadius,
						},
					})
				}

				// Adjust layer order if requested
				if (adjustLayers && element.textId) {
					calls.push({
						server: serverName,
						tool: "reorder_node",
						args: {
							nodeId: element.textId,
							position: "front",
						},
					})
				}
			}

			// Execute in batches
			let successCount = 0
			let failedCount = 0
			const errors: string[] = []

			for (let i = 0; i < calls.length; i += MAX_PARALLEL_AGENTS) {
				const batch = calls.slice(i, i + MAX_PARALLEL_AGENTS)

				const results = await Promise.allSettled(
					batch.map(async (call) => {
						try {
							await mcpHub.callTool(call.server, call.tool, call.args)
							return { success: true }
						} catch (error) {
							return {
								success: false,
								error: `${call.tool}: ${error instanceof Error ? error.message : String(error)}`,
							}
						}
					}),
				)

				for (const result of results) {
					if (result.status === "fulfilled" && result.value.success) {
						successCount++
					} else if (result.status === "fulfilled" && !result.value.success) {
						errors.push(result.value.error || "Unknown error")
						failedCount++
					} else if (result.status === "rejected") {
						errors.push(String(result.reason))
						failedCount++
					}
				}
			}

			if (failedCount === 0) {
				await task.say("text", `✅ AI 佈局調整完成！成功處理 ${allElements.length} 個元素`)
			} else {
				await task.say(
					"text",
					`⚠️ 部分完成：${successCount} 成功，${failedCount} 失敗\n` +
						errors
							.slice(0, 3)
							.map((e) => `  • ${e}`)
							.join("\n"),
				)
			}

			pushToolResult(
				formatResponse.toolResult(
					`AI Layout adjustment completed.\n` +
						`- Elements: ${allElements.length}\n` +
						`- Success: ${successCount}\n` +
						`- Failed: ${failedCount}`,
				) as string,
			)
		} catch (error) {
			console.error(`[AdjustLayout AI] Error:`, error)
			await task.say("text", `❌ AI 佈局失敗，回退到演算法模式...`)

			// Fallback to algorithm mode
			await this.executeWithAlgorithm(
				task,
				(toolName, args) =>
					mcpHub.callTool(
						serverName,
						toolName === "set_position" && serverName === "TalkToFigma" ? "move_node" : toolName,
						args,
					),
				paired,
				standalone,
				display,
				context,
				pushToolResult,
			)
		}
	}

	/**
	 * Extract button text from text node
	 * Priority: characters (actual text content) > name (if meaningful)
	 */
	private extractButtonText(textNode: NodeInfo): string {
		// First try to use the actual text content (characters field)
		if (textNode.characters && textNode.characters.length > 0) {
			return textNode.characters.trim()
		}
		// Fall back to name if it's meaningful (not generic "Text")
		const name = textNode.name
		if (name && name !== "Text" && name !== "text" && name.length <= 10) {
			return name
		}
		return "?"
	}

	/**
	 * Build prompt for AI to decide layout positions
	 * Dynamically generates layout hints based on detected elements
	 */
	private buildLayoutAIPrompt(
		elements: Array<{ id: string; name: string; type: string; width: number; height: number; text?: string }>,
		context: LayoutContext,
	): string {
		const buttonElements = elements.filter((e) => e.type === "button")
		const displayElements = elements.filter((e) => e.type === "display")
		const standaloneElements = elements.filter((e) => e.type === "standalone")

		// Build element list with IDs and text content for AI reference
		const elementDetails = elements.map((e) => ({
			id: e.id,
			type: e.type,
			text: e.text || "(無文字)",
			width: e.width,
			height: e.height,
		}))

		// Calculate available space and grid coordinates
		const buttonWidth = buttonElements[0]?.width || 60
		const buttonHeight = buttonElements[0]?.height || 60
		const gap = context.gapX
		const startX = context.startX
		const startY = context.startY

		// Pre-calculate display position
		const displayHeight = displayElements[0]?.height || 80
		const buttonsStartY = displayElements.length > 0 ? startY + displayHeight + gap : startY

		// Dynamically generate position mapping based on detected elements
		const dynamicPositionMapping = this.generateDynamicPositionMapping(
			buttonElements,
			displayElements,
			{
				startX,
				startY,
				buttonsStartY,
				buttonWidth,
				buttonHeight,
				gap,
				containerWidth: context.containerWidth,
				containerHeight: context.containerHeight,
			}
		)

		return `你是一個智能 UI 佈局專家。你的任務是根據下方的「元素位置對照表」為每個元素指定座標。

## 容器資訊
- 容器尺寸: ${context.containerWidth}px × ${context.containerHeight}px
- 起始位置: (${startX}, ${startY})
- 間距: ${gap}px

## 元素列表 (共 ${elements.length} 個)
\`\`\`json
${JSON.stringify(elementDetails, null, 2)}
\`\`\`

## 元素統計
- 顯示區域 (display): ${displayElements.length} 個
- 按鈕 (button): ${buttonElements.length} 個 - [${buttonElements.map((b) => b.text || "?").join(", ")}]
- 獨立元素 (standalone): ${standaloneElements.length} 個

${dynamicPositionMapping}

## 輸出要求

**直接使用上面「元素位置對照表」中的座標！**

輸出格式：
\`\`\`json
[
  {"id": "元素ID", "x": 對照表中的X, "y": 對照表中的Y},
  ...
]
\`\`\`

⚠️ 只返回 JSON 陣列，不要任何解釋文字！`
	}

	/**
	 * Dynamically generate position mapping based on detected elements
	 * Analyzes button texts to determine UI type and generates appropriate grid
	 */
	private generateDynamicPositionMapping(
		buttons: Array<{ id: string; text?: string; width: number; height: number }>,
		displays: Array<{ id: string; width: number; height: number }>,
		grid: {
			startX: number
			startY: number
			buttonsStartY: number
			buttonWidth: number
			buttonHeight: number
			gap: number
			containerWidth: number
			containerHeight: number
		}
	): string {
		const { startX, startY, buttonsStartY, buttonWidth, buttonHeight, gap } = grid

		// Helper to calculate grid position
		const col = (c: number) => startX + c * (buttonWidth + gap)
		const row = (r: number) => buttonsStartY + r * (buttonHeight + gap)

		// Analyze button texts to detect UI type
		const buttonTexts = buttons.map(b => b.text || "").filter(t => t.length > 0)
		const hasNumbers = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].some(n => buttonTexts.includes(n))
		const hasOperators = ["+", "-", "×", "÷", "*", "/", "="].some(op => buttonTexts.some(t => t === op))
		const hasClear = ["C", "AC", "CE"].some(c => buttonTexts.some(t => t === c || t.toUpperCase() === c))

		// Detect form-type UI (has action buttons like submit, cancel, add, etc.)
		const formKeywords = ["submit", "cancel", "ok", "確認", "取消", "送出", "save", "reset", "add", "添加", "新增", "delete", "刪除", "清除"]
		const isFormUI = formKeywords.some(k => buttonTexts.some(t => t.toLowerCase().includes(k.toLowerCase())))
		const isCalculator = hasNumbers && (hasOperators || hasClear) && buttons.length >= 10

		let mapping = "## 元素位置對照表\n\n"

		// For form UI: stack all elements vertically
		if (isFormUI || (!isCalculator && displays.length > 0)) {
			mapping += "### 表單佈局 (垂直堆疊)\n"
			mapping += "| ID | 類型 | X | Y |\n|-----|-----|-----|-----|\n"

			let currentY = startY

			// Display elements first (full width, stacked)
			displays.forEach((d, i) => {
				mapping += `| display-${i} | display | ${startX} | ${currentY} |\n`
				currentY += d.height + gap
			})

			// Then buttons (stacked or side by side for action buttons)
			if (buttons.length <= 3) {
				// Few buttons - arrange horizontally at bottom
				const totalBtnWidth = buttons.reduce((sum, b) => sum + b.width, 0) + (buttons.length - 1) * gap
				let btnX = startX + Math.max(0, (grid.containerWidth - 2 * startX - totalBtnWidth) / 2)
				buttons.forEach((btn, i) => {
					mapping += `| button-${i} | ${btn.text || "button"} | ${btnX} | ${currentY} |\n`
					btnX += btn.width + gap
				})
			} else {
				// More buttons - stack vertically
				buttons.forEach((btn, i) => {
					mapping += `| button-${i} | ${btn.text || "button"} | ${startX} | ${currentY} |\n`
					currentY += btn.height + gap
				})
			}

			return mapping
		}

		// Add display positions for calculator
		if (displays.length > 0) {
			mapping += "### 顯示區域\n"
			mapping += "| ID | X | Y |\n|-----|-----|-----|\n"
			displays.forEach((d, i) => {
				mapping += `| display-${i} | ${startX} | ${startY} |\n`
			})
			mapping += "\n"
		}

		// Detect calculator and generate specific mapping
		if (isCalculator) {
			mapping += "### 按鈕 (計算機佈局 - 4列)\n"
			mapping += "| ID | 文字 | X | Y |\n|-----|-----|-----|-----|\n"

			// Track used positions to avoid conflicts
			const usedPositions = new Set<string>()
			const getPositionKey = (c: number, r: number) => `${c},${r}`

			// Standard calculator layout - priority order for each position
			// Each position has a list of possible button texts, first match wins
			const calcPositions: Array<{ col: number; row: number; texts: string[] }> = [
				// Row 0: Function keys
				{ col: 0, row: 0, texts: ["C", "AC", "CE", "CLR"] },
				{ col: 1, row: 0, texts: ["±", "⌫", "+/-", "DEL", "←"] },
				{ col: 2, row: 0, texts: ["%"] },
				{ col: 3, row: 0, texts: ["÷", "/"] },
				// Row 1: 7, 8, 9, ×
				{ col: 0, row: 1, texts: ["7"] },
				{ col: 1, row: 1, texts: ["8"] },
				{ col: 2, row: 1, texts: ["9"] },
				{ col: 3, row: 1, texts: ["×", "*", "x", "X"] },
				// Row 2: 4, 5, 6, -
				{ col: 0, row: 2, texts: ["4"] },
				{ col: 1, row: 2, texts: ["5"] },
				{ col: 2, row: 2, texts: ["6"] },
				{ col: 3, row: 2, texts: ["-"] },
				// Row 3: 1, 2, 3, +
				{ col: 0, row: 3, texts: ["1"] },
				{ col: 1, row: 3, texts: ["2"] },
				{ col: 2, row: 3, texts: ["3"] },
				{ col: 3, row: 3, texts: ["+"] },
				// Row 4: 0, ., =
				{ col: 0, row: 4, texts: ["0"] },
				{ col: 1, row: 4, texts: ["00"] }, // Some calculators have 00
				{ col: 2, row: 4, texts: [".", ","] },
				{ col: 3, row: 4, texts: ["="] },
			]

			// Build button text to position map (first match only)
			const buttonPositions = new Map<number, { col: number; row: number }>()
			const assignedTexts = new Set<string>()

			// First pass: assign buttons to their standard positions
			for (const pos of calcPositions) {
				for (const text of pos.texts) {
					if (assignedTexts.has(text)) continue

					const btnIndex = buttons.findIndex(b => b.text === text && !buttonPositions.has(buttons.indexOf(b)))
					if (btnIndex !== -1) {
						const posKey = getPositionKey(pos.col, pos.row)
						if (!usedPositions.has(posKey)) {
							buttonPositions.set(btnIndex, { col: pos.col, row: pos.row })
							usedPositions.add(posKey)
							assignedTexts.add(text)
							break // Only assign one button per position
						}
					}
				}
			}

			// Second pass: assign remaining buttons to unused positions
			let nextRow = 5 // Start from row 5 for overflow
			let nextCol = 0
			buttons.forEach((btn, i) => {
				if (!buttonPositions.has(i)) {
					// Find next available position
					while (usedPositions.has(getPositionKey(nextCol, nextRow))) {
						nextCol++
						if (nextCol >= 4) {
							nextCol = 0
							nextRow++
						}
					}
					buttonPositions.set(i, { col: nextCol, row: nextRow })
					usedPositions.add(getPositionKey(nextCol, nextRow))
					nextCol++
					if (nextCol >= 4) {
						nextCol = 0
						nextRow++
					}
				}
			})

			// Output mapping table
			buttons.forEach((btn, i) => {
				const pos = buttonPositions.get(i)!
				mapping += `| button-${i} | ${btn.text || "?"} | ${col(pos.col)} | ${row(pos.row)} |\n`
			})
		} else {
			// Generic grid layout
			const columns = Math.min(4, buttons.length)
			mapping += `### 按鈕 (網格佈局 - ${columns}列)\n`
			mapping += "| ID | 文字 | X | Y |\n|-----|-----|-----|-----|\n"

			buttons.forEach((btn, i) => {
				const c = i % columns
				const r = Math.floor(i / columns)
				mapping += `| button-${i} | ${btn.text || "?"} | ${col(c)} | ${row(r)} |\n`
			})
		}

		return mapping
	}

	/**
	 * Get AI's position decisions for layout
	 */
	private async getAIPositionDecisions(
		task: Task,
		prompt: string,
		elements: Array<{ id: string; width: number; height: number; type: string; text?: string }>,
		context: LayoutContext,
	): Promise<Array<{ id: string; x: number; y: number }>> {
		console.log(`[AdjustLayout AI] Requesting AI position decisions for ${elements.length} elements`)

		try {
			// Use task's API to get AI response
			const messages = [{ role: "user" as const, content: prompt }]

			const systemPrompt = `你是智能 UI 佈局專家。你能夠：
1. 自動識別 UI 類型（計算機、表單、菜單、儀表板等）
2. 根據 UI 類型選擇最佳的佈局策略
3. 精確計算每個元素的位置座標
4. 確保佈局美觀、對齊、不重疊

你只輸出 JSON 陣列，不輸出任何解釋文字。`

			const stream = task.api.createMessage(systemPrompt, messages, {
				taskId: `adjust-layout-ai-${Date.now()}`,
			})

			let responseText = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					responseText += chunk.text
				}
			}

			console.log(`[AdjustLayout AI] Response: ${responseText.substring(0, 500)}...`)

			// Try to parse JSON from response
			const jsonMatch = responseText.match(/\[[\s\S]*\]/)
			if (jsonMatch) {
				const positions = JSON.parse(jsonMatch[0])
				if (Array.isArray(positions)) {
					return positions.filter((p) => p.id && typeof p.x === "number" && typeof p.y === "number")
				}
			}
		} catch (error) {
			console.error(`[AdjustLayout AI] Failed to get AI decisions:`, error)
		}

		// Fallback: calculate positions algorithmically
		console.log(`[AdjustLayout AI] Falling back to algorithmic positions`)
		return this.calculateFallbackPositions(elements, context)
	}

	/**
	 * Extract color information from Figma nodes for color approval
	 * Queries the Figma API to get fill colors from rectangles and text colors from text nodes
	 */
	private async extractColorInfo(
		mcpHub: any,
		serverName: string,
		nodes: NodeInfo[],
	): Promise<ColorInfo[]> {
		const colors: ColorInfo[] = []

		for (const node of nodes) {
			try {
				// Get detailed node info including fills
				const result = await mcpHub.callTool(serverName, "get_node_info", { nodeId: node.id })
				let nodeData: any = null

				if (typeof result === "string") {
					nodeData = JSON.parse(result)
				} else if (result?.content) {
					const textContent = result.content.find((c: any) => c.type === "text")
					if (textContent?.text) {
						nodeData = JSON.parse(textContent.text)
					}
				}

				if (nodeData) {
					const colorInfo: ColorInfo = {
						nodeId: node.id,
						nodeName: node.name,
						nodeType: node.type,
					}

					// Extract fill color for rectangles
					if (node.type === "RECTANGLE" && nodeData.fills && Array.isArray(nodeData.fills)) {
						const solidFill = nodeData.fills.find((f: any) => f.type === "SOLID" && f.visible !== false)
						if (solidFill?.color) {
							const { r, g, b } = solidFill.color
							colorInfo.backgroundColor = this.rgbToHex(r, g, b)
						}
					}

					// Extract text color
					if (node.type === "TEXT" && nodeData.fills && Array.isArray(nodeData.fills)) {
						const solidFill = nodeData.fills.find((f: any) => f.type === "SOLID" && f.visible !== false)
						if (solidFill?.color) {
							const { r, g, b } = solidFill.color
							colorInfo.textColor = this.rgbToHex(r, g, b)
						}
					}

					if (colorInfo.backgroundColor || colorInfo.textColor) {
						colors.push(colorInfo)
					}
				}
			} catch (error) {
				console.warn(`[AdjustLayout] Failed to extract color for node ${node.id}:`, error)
			}
		}

		return colors
	}

	/**
	 * Convert RGB values (0-1) to hex color string
	 */
	private rgbToHex(r: number, g: number, b: number): string {
		const toHex = (v: number) => {
			const hex = Math.round(v * 255).toString(16)
			return hex.length === 1 ? "0" + hex : hex
		}
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
	}

	/**
	 * Build color summary for approval message
	 */
	private buildColorSummary(colors: ColorInfo[]): string {
		const bgColors = colors.filter(c => c.backgroundColor)
		const textColors = colors.filter(c => c.textColor)

		let summary = "## 當前顏色資訊 (Current Colors)\n\n"

		if (bgColors.length > 0) {
			summary += "**背景顏色 (Background Colors):**\n"
			const uniqueBg = [...new Set(bgColors.map(c => c.backgroundColor))]
			uniqueBg.forEach(color => {
				const count = bgColors.filter(c => c.backgroundColor === color).length
				summary += `- ${color} (${count} 個元素)\n`
			})
			summary += "\n"
		}

		if (textColors.length > 0) {
			summary += "**文字顏色 (Text Colors):**\n"
			const uniqueText = [...new Set(textColors.map(c => c.textColor))]
			uniqueText.forEach(color => {
				const count = textColors.filter(c => c.textColor === color).length
				summary += `- ${color} (${count} 個文字)\n`
			})
		}

		return summary
	}

	/**
	 * Detect UI type based on element text content
	 * Returns: "calculator" | "form" | "menu" | "dashboard" | "generic"
	 */
	private detectUIType(elements: Array<{ text?: string; type: string }>): string {
		const buttonTexts = elements
			.filter((e) => e.type === "button" && e.text)
			.map((e) => e.text!.trim())

		// Calculator detection: has numbers 0-9 and operators
		const hasNumbers = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].some((n) =>
			buttonTexts.some((t) => t === n),
		)
		const hasOperators = ["+", "-", "×", "÷", "*", "/", "="].some((op) =>
			buttonTexts.some((t) => t === op || t.includes(op)),
		)
		const hasClear = ["C", "AC", "CE", "CLR"].some((c) => buttonTexts.some((t) => t === c))

		if (hasNumbers && (hasOperators || hasClear)) {
			console.log(`[AdjustLayout] Detected UI type: calculator`)
			return "calculator"
		}

		// Form detection: has submit/cancel buttons or input-like elements
		const formKeywords = ["submit", "cancel", "ok", "確認", "取消", "送出", "save", "reset"]
		const hasFormButtons = formKeywords.some((k) =>
			buttonTexts.some((t) => t.toLowerCase().includes(k)),
		)
		if (hasFormButtons) {
			console.log(`[AdjustLayout] Detected UI type: form`)
			return "form"
		}

		// Menu detection: mostly text-based options
		const displays = elements.filter((e) => e.type === "display")
		const buttons = elements.filter((e) => e.type === "button")
		if (buttons.length > 3 && displays.length === 0) {
			const avgTextLength =
				buttonTexts.reduce((sum, t) => sum + t.length, 0) / buttonTexts.length
			if (avgTextLength > 3) {
				// Menu items usually have longer text
				console.log(`[AdjustLayout] Detected UI type: menu`)
				return "menu"
			}
		}

		// Dashboard detection: multiple display areas
		if (displays.length >= 2) {
			console.log(`[AdjustLayout] Detected UI type: dashboard`)
			return "dashboard"
		}

		console.log(`[AdjustLayout] Detected UI type: generic`)
		return "generic"
	}

	/**
	 * Calculate fallback positions - dynamically detects UI type and applies appropriate layout
	 * Handles various UI types: calculator, form, menu, dashboard, generic
	 */
	private calculateFallbackPositions(
		elements: Array<{ id: string; width: number; height: number; type: string; text?: string }>,
		context: LayoutContext,
	): Array<{ id: string; x: number; y: number }> {
		// Detect UI type from elements
		const uiType = this.detectUIType(elements)

		// Route to appropriate layout method based on UI type
		switch (uiType) {
			case "calculator":
				return this.calculateCalculatorLayout(elements, context)
			case "form":
				return this.calculateFormLayout(elements, context)
			case "menu":
				return this.calculateMenuLayout(elements, context)
			case "dashboard":
				return this.calculateDashboardLayout(elements, context)
			default:
				return this.calculateGenericGridLayout(elements, context)
		}
	}

	/**
	 * Calculator layout - standard 4-column grid with display at top
	 */
	private calculateCalculatorLayout(
		elements: Array<{ id: string; width: number; height: number; type: string; text?: string }>,
		context: LayoutContext,
	): Array<{ id: string; x: number; y: number }> {
		const positions: Array<{ id: string; x: number; y: number }> = []

		const startX = context.startX
		let currentY = context.startY
		const gap = context.gapX

		// Find typical button size
		const buttons = elements.filter((e) => e.type === "button")
		const btnWidth = buttons[0]?.width || 60
		const btnHeight = buttons[0]?.height || 60

		// 1. Position display elements at top
		const displays = elements.filter((e) => e.type === "display")
		for (const disp of displays) {
			positions.push({ id: disp.id, x: startX, y: currentY })
			currentY += disp.height + gap
		}

		// 2. Group buttons by their text content for calculator layout
		const buttonMap = new Map<string, (typeof elements)[0]>()
		const normalizeText = (text: string): string => {
			const normalized = text.trim()
			const mappings: Record<string, string> = {
				"*": "×",
				x: "×",
				X: "×",
				"/": "÷",
				AC: "C",
				CE: "C",
				CLR: "C",
				"⌫": "⌫",
				DEL: "⌫",
				"←": "⌫",
				"+/-": "±",
				"+-": "±",
			}
			return mappings[normalized] || normalized
		}

		for (const btn of buttons) {
			if (btn.text) {
				const normalizedText = normalizeText(btn.text)
				buttonMap.set(normalizedText, btn)
				if (normalizedText !== btn.text) {
					buttonMap.set(btn.text, btn)
				}
			}
		}

		console.log(`[AdjustLayout] Calculator button map: ${Array.from(buttonMap.keys()).join(", ")}`)

		// Standard calculator layout rows
		const calcLayout = [
			["C", "AC", "CE", "⌫", "±", "%", "÷", "/"],
			["7", "8", "9", "×", "*", "x", "X"],
			["4", "5", "6", "-"],
			["1", "2", "3", "+"],
			["0", ".", "="],
		]

		const placedIds = new Set<string>()

		for (const row of calcLayout) {
			let colX = startX
			let foundInRow = false

			for (const key of row) {
				const btn = buttonMap.get(key)
				if (btn && !placedIds.has(btn.id)) {
					const isWideZero = key === "0" && btnWidth < 100
					const effectiveWidth = isWideZero ? btnWidth * 2 + gap : btnWidth
					positions.push({ id: btn.id, x: colX, y: currentY })
					placedIds.add(btn.id)
					foundInRow = true
					colX += effectiveWidth + gap
				} else {
					colX += btnWidth + gap
				}
			}

			if (foundInRow) {
				currentY += btnHeight + gap
			}
		}

		// 3. Position remaining buttons in grid
		const remainingButtons = buttons.filter((b) => !placedIds.has(b.id))
		if (remainingButtons.length > 0) {
			let col = 0
			for (const btn of remainingButtons) {
				const x = startX + col * (btnWidth + gap)
				positions.push({ id: btn.id, x, y: currentY })
				placedIds.add(btn.id)
				col++
				if (col >= 4) {
					col = 0
					currentY += btnHeight + gap
				}
			}
			if (col > 0) currentY += btnHeight + gap
		}

		// 4. Position standalone elements
		const standalones = elements.filter((e) => e.type === "standalone")
		let col = 0
		for (const node of standalones) {
			const x = startX + col * (node.width + gap)
			positions.push({ id: node.id, x, y: currentY })
			col++
			if (col >= context.columns) {
				col = 0
				currentY += node.height + gap
			}
		}

		console.log(`[AdjustLayout] Calculator layout: ${positions.length} positions`)
		return positions
	}

	/**
	 * Form layout - labels and inputs stacked vertically, buttons at bottom
	 */
	private calculateFormLayout(
		elements: Array<{ id: string; width: number; height: number; type: string; text?: string }>,
		context: LayoutContext,
	): Array<{ id: string; x: number; y: number }> {
		const positions: Array<{ id: string; x: number; y: number }> = []

		const startX = context.startX
		let currentY = context.startY
		const gap = context.gapY

		// Separate displays, buttons, and standalones
		const displays = elements.filter((e) => e.type === "display")
		const buttons = elements.filter((e) => e.type === "button")
		const standalones = elements.filter((e) => e.type === "standalone")

		// 1. Position displays/inputs vertically
		for (const disp of displays) {
			positions.push({ id: disp.id, x: startX, y: currentY })
			currentY += disp.height + gap
		}

		// 2. Position standalone elements (labels, etc.)
		for (const node of standalones) {
			positions.push({ id: node.id, x: startX, y: currentY })
			currentY += node.height + gap
		}

		// 3. Position buttons at bottom (horizontally centered)
		if (buttons.length > 0) {
			currentY += gap // Extra spacing before buttons
			const totalBtnWidth = buttons.reduce((sum, b) => sum + b.width, 0) + (buttons.length - 1) * context.gapX
			let btnX = startX + Math.max(0, (context.containerWidth - 2 * startX - totalBtnWidth) / 2)

			for (const btn of buttons) {
				positions.push({ id: btn.id, x: btnX, y: currentY })
				btnX += btn.width + context.gapX
			}
		}

		console.log(`[AdjustLayout] Form layout: ${positions.length} positions`)
		return positions
	}

	/**
	 * Menu layout - items arranged vertically or in columns
	 */
	private calculateMenuLayout(
		elements: Array<{ id: string; width: number; height: number; type: string; text?: string }>,
		context: LayoutContext,
	): Array<{ id: string; x: number; y: number }> {
		const positions: Array<{ id: string; x: number; y: number }> = []

		const startX = context.startX
		let currentY = context.startY
		const gap = context.gapY

		// Sort elements by their text for consistent ordering
		const sortedElements = [...elements].sort((a, b) => {
			const textA = a.text || a.id
			const textB = b.text || b.id
			return textA.localeCompare(textB)
		})

		// Calculate if we should use single column or multiple columns
		const maxItemsPerColumn = Math.ceil(context.containerHeight / (60 + gap))
		const useMultiColumn = sortedElements.length > maxItemsPerColumn

		if (useMultiColumn) {
			// Multi-column menu layout
			const columns = Math.min(3, Math.ceil(sortedElements.length / maxItemsPerColumn))
			const itemsPerColumn = Math.ceil(sortedElements.length / columns)
			const colWidth = (context.containerWidth - 2 * startX - (columns - 1) * context.gapX) / columns

			let col = 0
			let rowInCol = 0

			for (const elem of sortedElements) {
				const x = startX + col * (colWidth + context.gapX)
				const y = context.startY + rowInCol * (elem.height + gap)
				positions.push({ id: elem.id, x, y })

				rowInCol++
				if (rowInCol >= itemsPerColumn) {
					rowInCol = 0
					col++
				}
			}
		} else {
			// Single column menu
			for (const elem of sortedElements) {
				positions.push({ id: elem.id, x: startX, y: currentY })
				currentY += elem.height + gap
			}
		}

		console.log(`[AdjustLayout] Menu layout: ${positions.length} positions`)
		return positions
	}

	/**
	 * Dashboard layout - display areas arranged in a grid
	 */
	private calculateDashboardLayout(
		elements: Array<{ id: string; width: number; height: number; type: string; text?: string }>,
		context: LayoutContext,
	): Array<{ id: string; x: number; y: number }> {
		const positions: Array<{ id: string; x: number; y: number }> = []

		const startX = context.startX
		let currentY = context.startY
		const gap = context.gapX

		// Separate displays and controls
		const displays = elements.filter((e) => e.type === "display")
		const controls = elements.filter((e) => e.type !== "display")

		// 1. Arrange displays in a 2-column grid
		const displayCols = Math.min(2, displays.length)
		const displayWidth = (context.containerWidth - 2 * startX - (displayCols - 1) * gap) / displayCols

		let col = 0
		let rowMaxHeight = 0

		for (const disp of displays) {
			const x = startX + col * (displayWidth + gap)
			positions.push({ id: disp.id, x, y: currentY })
			rowMaxHeight = Math.max(rowMaxHeight, disp.height)

			col++
			if (col >= displayCols) {
				col = 0
				currentY += rowMaxHeight + gap
				rowMaxHeight = 0
			}
		}

		if (col > 0) {
			currentY += rowMaxHeight + gap
		}

		// 2. Arrange controls below displays in a row
		if (controls.length > 0) {
			currentY += gap
			let controlX = startX

			for (const ctrl of controls) {
				positions.push({ id: ctrl.id, x: controlX, y: currentY })
				controlX += ctrl.width + gap
			}
		}

		console.log(`[AdjustLayout] Dashboard layout: ${positions.length} positions`)
		return positions
	}

	/**
	 * Generic grid layout - simple grid arrangement
	 */
	private calculateGenericGridLayout(
		elements: Array<{ id: string; width: number; height: number; type: string; text?: string }>,
		context: LayoutContext,
	): Array<{ id: string; x: number; y: number }> {
		const positions: Array<{ id: string; x: number; y: number }> = []

		const startX = context.startX
		let currentY = context.startY
		const gapX = context.gapX
		const gapY = context.gapY
		const columns = context.columns

		// Sort: displays first, then buttons, then standalones
		const sortedElements = [...elements].sort((a, b) => {
			const typeOrder = { display: 0, button: 1, standalone: 2 }
			const orderA = typeOrder[a.type as keyof typeof typeOrder] ?? 3
			const orderB = typeOrder[b.type as keyof typeof typeOrder] ?? 3
			return orderA - orderB
		})

		let col = 0
		let rowMaxHeight = 0

		for (const elem of sortedElements) {
			const x = startX + col * (elem.width + gapX)
			positions.push({ id: elem.id, x, y: currentY })
			rowMaxHeight = Math.max(rowMaxHeight, elem.height)

			col++
			if (col >= columns) {
				col = 0
				currentY += rowMaxHeight + gapY
				rowMaxHeight = 0
			}
		}

		console.log(`[AdjustLayout] Generic grid layout: ${positions.length} positions`)
		return positions
	}

	/**
	 * Execute layout adjustment using mathematical algorithm
	 */
	private async executeWithAlgorithm(
		task: Task,
		callFigmaTool: (toolName: string, args: Record<string, unknown>) => Promise<any>,
		paired: Array<{ rect: NodeInfo; text: NodeInfo }>,
		standalone: NodeInfo[],
		display: Array<{ rect: NodeInfo; text?: NodeInfo }>,
		context: LayoutContext,
		pushToolResult: (result: string) => void,
	): Promise<void> {
		// Sort paired rectangles by current position for proper visual order
		const sortedPaired = [...paired].sort((a, b) => {
			const rowThreshold = 20
			const rowA = Math.floor(a.rect.y / rowThreshold)
			const rowB = Math.floor(b.rect.y / rowThreshold)
			if (rowA !== rowB) return rowA - rowB
			return a.rect.x - b.rect.x
		})

		const sortedStandalone = this.sortNodes(standalone, "position")

		// Calculate new positions
		let positions = this.calculatePairedPositions(sortedPaired, sortedStandalone, display, {
			layout: context.layout,
			columns: context.columns,
			gapX: context.gapX,
			gapY: context.gapY,
			startX: context.startX,
			startY: context.startY,
			containerWidth: context.containerWidth,
			containerHeight: context.containerHeight,
		})

		// Build element size map for boundary checking
		const allElements: Array<{ nodeId: string; width: number; height: number }> = [
			...display.map((d) => ({ nodeId: d.rect.id, width: d.rect.width, height: d.rect.height })),
			...display.filter((d) => d.text).map((d) => ({ nodeId: d.text!.id, width: d.text!.width, height: d.text!.height })),
			...sortedPaired.map((p) => ({ nodeId: p.rect.id, width: p.rect.width, height: p.rect.height })),
			...sortedPaired.map((p) => ({ nodeId: p.text.id, width: p.text.width, height: p.text.height })),
			...sortedStandalone.map((n) => ({ nodeId: n.id, width: n.width, height: n.height })),
		]

		// Apply boundary checking to ensure elements stay within container
		positions = this.clampPositionsToContainer(
			positions,
			allElements,
			context.containerWidth,
			context.containerHeight,
			context.startX, // Use startX as margin
		)

		// Note: We no longer resize buttons here as it causes "squeeze" issues.
		// Instead, positions are calculated to fit within container bounds (see calculatePairedPositions).
		// If buttons still exceed bounds, the clampPositionsToContainer will keep them inside.

		// Execute position changes in batches
		// NOTE: move_node uses coordinates RELATIVE to parent frame, not absolute canvas coordinates
		console.log(`[AdjustLayout Algorithm] Positions are relative to frame`)

		let successCount = 0
		let failedCount = 0
		const errors: string[] = []
		const MAX_BATCH_SIZE = 15

		const totalBatches = Math.ceil(positions.length / MAX_BATCH_SIZE)

		for (let batchStart = 0; batchStart < positions.length; batchStart += MAX_BATCH_SIZE) {
			const batch = positions.slice(batchStart, batchStart + MAX_BATCH_SIZE)
			const batchNum = Math.floor(batchStart / MAX_BATCH_SIZE) + 1

			if (totalBatches > 1) {
				await task.say("text", `📐 處理批次 ${batchNum}/${totalBatches}...`)
			}

			const batchResults = await Promise.all(
				batch.map(async (pos) => {
					try {
						// Positions are relative to parent frame
						await callFigmaTool("set_position", {
							nodeId: pos.nodeId,
							x: pos.x,
							y: pos.y,
						})
						return { success: true }
					} catch (error) {
						return {
							success: false,
							error: `${pos.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
						}
					}
				}),
			)

			for (const result of batchResults) {
				if (result.success) {
					successCount++
				} else {
					failedCount++
					if (result.error) {
						errors.push(result.error)
					}
				}
			}
		}

		// Report results
		if (failedCount === 0) {
			await task.say("text", `✅ 成功排列 ${successCount} 個節點為 ${context.layout} 佈局！`)
		} else {
			await task.say(
				"text",
				`⚠️ ${successCount}/${positions.length} 個節點排列成功，${failedCount} 個失敗。\n\n` +
					`失敗的節點:\n` +
					errors
						.slice(0, 5)
						.map((e) => `  • ${e}`)
						.join("\n") +
					(errors.length > 5 ? `\n  ... 等 ${errors.length} 個錯誤` : ""),
			)
		}

		pushToolResult(
			formatResponse.toolResult(
				`Layout adjustment completed.\n` +
					`- Mode: Algorithm\n` +
					`- Layout: ${context.layout}\n` +
					`- Nodes arranged: ${successCount}\n` +
					`- Failed: ${failedCount}`,
			) as string,
		)
	}

	/**
	 * Parse container info from get_node_info result
	 * Handles absoluteBoundingBox format from TalkToFigma
	 * Returns both dimensions AND the absolute position of the frame on canvas
	 */
	private parseContainerInfo(result: unknown): { width: number; height: number; offsetX: number; offsetY: number } {
		try {
			let content: string | undefined

			if (typeof result === "string") {
				content = result
			} else if (result && typeof result === "object") {
				const resultObj = result as { content?: Array<{ text?: string; type?: string }> }
				if (resultObj.content && Array.isArray(resultObj.content)) {
					const textContent = resultObj.content.find((c) => c.type === "text")
					content = textContent?.text
				}
			}

			if (!content) {
				console.warn("[AdjustLayout] No content in container info, using defaults")
				return { width: 400, height: 600, offsetX: 0, offsetY: 0 }
			}

			const parsed = JSON.parse(content)
			// TalkToFigma uses absoluteBoundingBox for dimensions AND position
			const bbox = parsed.absoluteBoundingBox
			const width = bbox?.width || parsed.width || 400
			const height = bbox?.height || parsed.height || 600
			// CRITICAL: Get the frame's absolute position on the canvas
			// This offset must be added to all child element positions
			const offsetX = bbox?.x ?? parsed.x ?? 0
			const offsetY = bbox?.y ?? parsed.y ?? 0

			console.log(`[AdjustLayout] Container info: ${width}x${height} at (${offsetX}, ${offsetY})` +
				(bbox ? ` (from absoluteBoundingBox)` : ` (from direct properties)`))

			// Sanity check - if dimensions seem too small, log a warning
			if (width < 100 || height < 100) {
				console.warn(`[AdjustLayout] ⚠️ Container dimensions seem small: ${width}x${height}. ` +
					`This might cause layout issues.`)
			}

			return { width, height, offsetX, offsetY }
		} catch (e) {
			console.error("[AdjustLayout] Failed to parse container info:", e)
			return { width: 400, height: 600, offsetX: 0, offsetY: 0 }
		}
	}

	/**
	 * Parse nodes from Figma find_nodes result
	 * Handles both direct x/y and absoluteBoundingBox formats
	 */
	private parseNodesFromResult(result: unknown): NodeInfo[] {
		try {
			let content: string | undefined

			if (typeof result === "string") {
				content = result
			} else if (result && typeof result === "object") {
				const resultObj = result as { content?: Array<{ text?: string }> }
				if (resultObj.content && Array.isArray(resultObj.content)) {
					content = resultObj.content[0]?.text
				}
			}

			if (!content) return []

			const parsed = JSON.parse(content)

			// Helper to extract position/size from node (handles both formats)
			const extractNodeInfo = (n: Record<string, unknown>): NodeInfo => {
				const bbox = n.absoluteBoundingBox as
					| { x?: number; y?: number; width?: number; height?: number }
					| undefined
				return {
					id: String(n.id || ""),
					name: String(n.name || ""),
					type: String(n.type || ""),
					x: Number(bbox?.x ?? n.x ?? 0),
					y: Number(bbox?.y ?? n.y ?? 0),
					width: Number(bbox?.width ?? n.width ?? 100),
					height: Number(bbox?.height ?? n.height ?? 40),
					characters: String(n.characters || n.textContent || ""),
				}
			}

			if (Array.isArray(parsed)) {
				return parsed.map(extractNodeInfo).filter((n) => n.id)
			}

			if (parsed.nodes && Array.isArray(parsed.nodes)) {
				return parsed.nodes.map(extractNodeInfo).filter((n: NodeInfo) => n.id)
			}

			return []
		} catch {
			return []
		}
	}

	/**
	 * Parse children from TalkToFigma get_node_info result
	 * Handles absoluteBoundingBox format and deduplicates elements
	 * Returns both unique nodes and duplicate node IDs for cleanup
	 */
	private parseChildrenFromNodeInfo(
		result: unknown,
		excludeId: string,
	): { nodes: NodeInfo[]; duplicateIds: string[] } {
		try {
			let content: string | undefined

			if (typeof result === "string") {
				content = result
			} else if (result && typeof result === "object") {
				const resultObj = result as { content?: Array<{ text?: string; type?: string }> }
				if (resultObj.content && Array.isArray(resultObj.content)) {
					const textContent = resultObj.content.find((c) => c.type === "text")
					content = textContent?.text
				}
			}

			if (!content) {
				console.warn("[AdjustLayout] No content in get_node_info result")
				return { nodes: [], duplicateIds: [] }
			}

			console.log("[AdjustLayout] Parsing node info content:", content.substring(0, 500))

			const parsed = JSON.parse(content)

			// Try multiple paths to find children (TalkToFigma might use different response formats)
			let children = parsed.children || parsed.result?.children || parsed.node?.children || []

			// If still no children, check if this is a different response format
			if (!Array.isArray(children) || children.length === 0) {
				// Some MCP servers return the node directly without wrapping
				if (parsed.type && parsed.id) {
					// This is the node itself, not wrapped - children should be at top level
					children = parsed.children || []
				}
				console.log(
					"[AdjustLayout] Children search - found:",
					Array.isArray(children) ? children.length : "not array",
					"keys in parsed:",
					Object.keys(parsed).join(", "),
				)
			}

			if (!Array.isArray(children)) return { nodes: [], duplicateIds: [] }

			// Parse all children with correct position extraction
			const allNodes = children
				.filter((n: Record<string, unknown>) => n.id !== excludeId)
				.map((n: Record<string, unknown>) => {
					// TalkToFigma uses absoluteBoundingBox for position/size
					const bbox = n.absoluteBoundingBox as
						| { x?: number; y?: number; width?: number; height?: number }
						| undefined
					return {
						id: String(n.id || ""),
						name: String(n.name || ""),
						type: String(n.type || ""),
						x: Number(bbox?.x ?? n.x ?? 0),
						y: Number(bbox?.y ?? n.y ?? 0),
						width: Number(bbox?.width ?? n.width ?? 100),
						height: Number(bbox?.height ?? n.height ?? 40),
						characters: String(n.characters || n.textContent || ""),
					}
				})
				.filter((n: NodeInfo) => n.id)

			// Deduplicate nodes - remove elements with same type+text at same position
			// This handles cases where parallel creation created duplicate buttons
			const seen = new Map<string, NodeInfo>()
			const deduped: NodeInfo[] = []
			const duplicateIds: string[] = []

			for (const node of allNodes) {
				// Create a key based on type, approximate position, and text content
				const posKey = `${Math.round(node.x / 10)}_${Math.round(node.y / 10)}`
				const key = `${node.type}_${posKey}_${node.characters || node.name}`

				if (!seen.has(key)) {
					seen.set(key, node)
					deduped.push(node)
				} else {
					console.log(
						`[AdjustLayout] Found duplicate: ${node.type} "${node.characters || node.name}" at (${node.x}, ${node.y}) - ID: ${node.id}`,
					)
					duplicateIds.push(node.id)
				}
			}

			console.log(
				`[AdjustLayout] Parsed ${allNodes.length} nodes, ${deduped.length} unique, ${duplicateIds.length} duplicates`,
			)

			return { nodes: deduped, duplicateIds }
		} catch (e) {
			console.error("[AdjustLayout] Failed to parse children from node info:", e)
			return { nodes: [], duplicateIds: [] }
		}
	}

	/**
	 * Clamp positions to stay within container bounds
	 * Only clamps X (horizontal) positions to prevent buttons from exceeding container width.
	 * Y positions are NOT clamped to avoid "squeezing" buttons vertically when container isn't tall enough.
	 * Works with both { id, x, y } and { nodeId, x, y } formats
	 */
	private clampPositionsToContainer<T extends { x: number; y: number } & ({ id: string } | { nodeId: string })>(
		positions: T[],
		elements: Array<{ id?: string; nodeId?: string; width: number; height: number }>,
		containerWidth: number,
		_containerHeight: number, // Not used - we don't clamp Y to avoid squeeze
		margin: number = 10,
	): T[] {
		// Build element map that works with both id and nodeId
		const elementMap = new Map<string, { width: number; height: number }>()
		for (const e of elements) {
			if (e.id) elementMap.set(e.id, { width: e.width, height: e.height })
			if (e.nodeId) elementMap.set(e.nodeId, { width: e.width, height: e.height })
		}

		return positions.map((pos) => {
			const posId = "id" in pos ? pos.id : "nodeId" in pos ? (pos as { nodeId: string }).nodeId : ""
			const element = elementMap.get(posId)
			if (!element) return pos

			// Only clamp X: ensure element stays within container width (with margin)
			// We do NOT clamp Y because it causes elements to overlap ("squeeze") when container isn't tall enough
			const maxX = containerWidth - element.width - margin
			const clampedX = Math.max(margin, Math.min(pos.x, maxX))

			if (clampedX !== pos.x) {
				console.log(
					`[AdjustLayout] Clamped X for ${posId}: ${pos.x} -> ${clampedX}`,
				)
			}

			return { ...pos, x: clampedX, y: pos.y }
		})
	}

	/**
	 * Sort nodes by specified criteria
	 */
	private sortNodes(nodes: NodeInfo[], sortBy: string): NodeInfo[] {
		const sorted = [...nodes]

		switch (sortBy) {
			case "name":
				sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
				break
			case "x":
				sorted.sort((a, b) => a.x - b.x)
				break
			case "y":
				sorted.sort((a, b) => a.y - b.y)
				break
			case "position":
				sorted.sort((a, b) => {
					const rowThreshold = 20
					const rowA = Math.floor(a.y / rowThreshold)
					const rowB = Math.floor(b.y / rowThreshold)
					if (rowA !== rowB) return rowA - rowB
					return a.x - b.x
				})
				break
			default:
				sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
		}

		return sorted
	}

	/**
	 * Group nodes into button pairs and identify display elements
	 * Uses spatial proximity to match rectangles with their text labels
	 * Display detection: must be wide AND at the top of the layout
	 */
	private groupButtonPairs(nodes: NodeInfo[]): {
		paired: Array<{ rect: NodeInfo; text: NodeInfo }>
		standalone: NodeInfo[]
		display: Array<{ rect: NodeInfo; text?: NodeInfo }>
	} {
		const rectangles = nodes.filter((n) => n.type === "RECTANGLE")
		const texts = nodes.filter((n) => n.type === "TEXT")
		const others = nodes.filter((n) => n.type !== "RECTANGLE" && n.type !== "TEXT")

		if (rectangles.length === 0) {
			return { paired: [], standalone: [...texts, ...others], display: [] }
		}

		// Calculate statistics for smarter display detection
		const avgWidth = rectangles.reduce((sum, r) => sum + r.width, 0) / rectangles.length
		const avgHeight = rectangles.reduce((sum, r) => sum + r.height, 0) / rectangles.length
		const minY = Math.min(...rectangles.map((r) => r.y))

		// Display detection criteria:
		// 1. Must be significantly wider than average (>= 2.5x for calculator displays)
		// 2. Must be at the VERY TOP of the layout (within 1x average height from minimum Y)
		// 3. Must have display-like aspect ratio (much wider than tall)
		// 4. Must NOT be at the bottom (the "0" button spans 2 columns but is NOT a display)
		const displayThreshold = avgWidth * 2.5  // Must be much wider than buttons
		const maxY = Math.max(...rectangles.map((r) => r.y))
		const topPositionThreshold = minY + avgHeight * 1.0  // Must be at the very top
		const bottomThreshold = maxY - avgHeight * 2  // Elements below this are "bottom row"

		const displayRects = rectangles.filter((r) => {
			const isWideEnough = r.width >= displayThreshold
			const isAtTop = r.y <= topPositionThreshold
			const isNotAtBottom = r.y < bottomThreshold  // Exclude bottom row elements
			// Display aspect ratio: much wider than tall (at least 3x)
			const aspectRatio = r.width / r.height
			const hasDisplayAspectRatio = aspectRatio > 3

			// For calculator: display must be BOTH wide AND at top AND not at bottom
			// The "0" button is wide but at the BOTTOM - so we exclude it
			const isDisplay = isAtTop && isNotAtBottom && (isWideEnough || hasDisplayAspectRatio)

			if (r.width > avgWidth * 1.8) {
				console.log(
					`[AdjustLayout] Wide rect check: y=${r.y}, minY=${minY}, maxY=${maxY}, ` +
						`isAtTop=${isAtTop}, isNotAtBottom=${isNotAtBottom}, aspect=${aspectRatio.toFixed(1)}, isDisplay=${isDisplay}`,
				)
			}

			return isDisplay
		})

		const buttonRects = rectangles.filter((r) => !displayRects.includes(r))

		console.log(`[AdjustLayout] Avg size: ${avgWidth}x${avgHeight}, Min Y: ${minY}`)
		console.log(`[AdjustLayout] Display threshold: width >= ${displayThreshold}, Y <= ${topPositionThreshold}`)
		console.log(`[AdjustLayout] Display rects: ${displayRects.length}, Button rects: ${buttonRects.length}`)

		const usedTextIds = new Set<string>()

		// Helper function to find text that overlaps with a rectangle
		// Uses a multi-pass approach: exact match -> expanded tolerance -> closest text
		const findOverlappingText = (rect: NodeInfo, textList: NodeInfo[]): NodeInfo | undefined => {
			const rectCenterX = rect.x + rect.width / 2
			const rectCenterY = rect.y + rect.height / 2

			// Pass 1: Find text whose center is within rectangle bounds (tight tolerance)
			for (const text of textList) {
				if (usedTextIds.has(text.id)) continue
				const textCenterX = text.x + text.width / 2
				const textCenterY = text.y + text.height / 2
				// Tight tolerance for exact overlap
				const tolerance = 15
				if (
					textCenterX >= rect.x - tolerance &&
					textCenterX <= rect.x + rect.width + tolerance &&
					textCenterY >= rect.y - tolerance &&
					textCenterY <= rect.y + rect.height + tolerance
				) {
					return text
				}
			}

			// Pass 2: Expanded tolerance - text may be offset due to centering calculation differences
			// Use larger tolerance based on rect dimensions (up to 50% of rect size)
			const expandedToleranceX = Math.max(30, rect.width * 0.5)
			const expandedToleranceY = Math.max(30, rect.height * 0.5)
			for (const text of textList) {
				if (usedTextIds.has(text.id)) continue
				const textCenterX = text.x + text.width / 2
				const textCenterY = text.y + text.height / 2
				if (
					textCenterX >= rect.x - expandedToleranceX &&
					textCenterX <= rect.x + rect.width + expandedToleranceX &&
					textCenterY >= rect.y - expandedToleranceY &&
					textCenterY <= rect.y + rect.height + expandedToleranceY
				) {
					console.log(`[AdjustLayout] Matched text "${text.characters || text.name}" to rect "${rect.name}" using expanded tolerance`)
					return text
				}
			}

			// Pass 3: Find the closest text by distance (for cases where text is further away)
			let closestText: NodeInfo | undefined
			let minDistance = Infinity

			for (const text of textList) {
				if (usedTextIds.has(text.id)) continue
				const textCenterX = text.x + text.width / 2
				const textCenterY = text.y + text.height / 2
				const distance = Math.sqrt(
					Math.pow(textCenterX - rectCenterX, 2) + Math.pow(textCenterY - rectCenterY, 2),
				)
				// Only consider texts that are reasonably close (within 3x the rect dimension)
				const maxDistance = Math.max(rect.width, rect.height) * 3
				if (distance < minDistance && distance < maxDistance) {
					minDistance = distance
					closestText = text
				}
			}

			if (closestText) {
				console.log(`[AdjustLayout] Matched text "${closestText.characters || closestText.name}" to rect "${rect.name}" using closest distance (${minDistance.toFixed(1)}px)`)
			}

			return closestText
		}

		// Pair displays with their text
		const display: Array<{ rect: NodeInfo; text?: NodeInfo }> = []

		for (const displayRect of displayRects) {
			const overlappingText = findOverlappingText(displayRect, texts)
			if (overlappingText) {
				usedTextIds.add(overlappingText.id)
				display.push({ rect: displayRect, text: overlappingText })
			} else {
				display.push({ rect: displayRect })
			}
		}

		// Sort button rectangles by position (top to bottom, left to right)
		const sortByPosition = (a: NodeInfo, b: NodeInfo) => {
			const rowThreshold = 30
			const rowA = Math.floor(a.y / rowThreshold)
			const rowB = Math.floor(b.y / rowThreshold)
			if (rowA !== rowB) return rowA - rowB
			return a.x - b.x
		}

		const sortedButtonRects = [...buttonRects].sort(sortByPosition)
		const remainingTexts = texts.filter((t) => !usedTextIds.has(t.id))

		// Pair button rectangles with their overlapping/closest text
		const paired: Array<{ rect: NodeInfo; text: NodeInfo }> = []
		const unpairedRects: NodeInfo[] = []

		for (const rect of sortedButtonRects) {
			const matchingText = findOverlappingText(rect, remainingTexts)
			if (matchingText) {
				usedTextIds.add(matchingText.id)
				paired.push({ rect, text: matchingText })
				// Log the pairing for debugging
				const textContent = matchingText.characters || matchingText.name
				console.log(`[AdjustLayout] Paired rect "${rect.name}" with text "${textContent}"`)
			} else {
				unpairedRects.push(rect)
			}
		}

		const unpairedTexts = remainingTexts.filter((t) => !usedTextIds.has(t.id))

		const standalone = [...unpairedRects, ...unpairedTexts, ...others]

		console.log(
			`[AdjustLayout] Display elements: ${display.length}, Button pairs: ${paired.length}, Standalone: ${standalone.length}`,
		)

		// Log paired button texts for debugging
		const pairedTexts = paired.map((p) => this.extractButtonText(p.text))
		console.log(`[AdjustLayout] Button labels found: ${pairedTexts.join(", ")}`)

		return { paired, standalone, display }
	}

	/**
	 * Normalize button text to handle variations (×/*, ÷//, etc.)
	 */
	private normalizeButtonText(text: string): string {
		const normalized = text.trim()
		const mappings: Record<string, string> = {
			"*": "×",
			x: "×",
			X: "×",
			"/": "÷",
			AC: "C",
			CE: "C",
			CLR: "C",
			"⌫": "⌫",
			DEL: "⌫",
			"←": "⌫",
			"+/-": "±",
			"+-": "±",
		}
		return mappings[normalized] || normalized
	}

	/**
	 * Calculate new positions for elements using calculator-aware layout
	 * Arranges buttons according to standard calculator layout based on their text content
	 */
	private calculatePairedPositions(
		paired: Array<{ rect: NodeInfo; text: NodeInfo }>,
		standalone: NodeInfo[],
		display: Array<{ rect: NodeInfo; text?: NodeInfo }>,
		options: {
			layout: string
			columns: number
			gapX: number
			gapY: number
			startX: number
			startY: number
			containerWidth?: number
			containerHeight?: number
		},
	): Array<{ nodeId: string; x: number; y: number }> {
		const { layout, columns, gapX, gapY, startX, startY, containerWidth, containerHeight } = options
		const positions: Array<{ nodeId: string; x: number; y: number }> = []

		let currentY = startY

		// 1. Position display elements first (at top, full width)
		for (const disp of display) {
			positions.push({ nodeId: disp.rect.id, x: startX, y: currentY })

			if (disp.text) {
				const textX = startX + disp.rect.width - disp.text.width - 10
				const textY = currentY + Math.floor((disp.rect.height - disp.text.height) / 2)
				positions.push({ nodeId: disp.text.id, x: textX, y: textY })
			}

			currentY += disp.rect.height + gapY
		}

		// 2. Position buttons below display(s) using calculator-aware layout
		const buttonStartY = currentY

		// Get typical button size - but if we have container width, calculate to fit
		let btnWidth = paired[0]?.rect.width || 60
		const btnHeight = paired[0]?.rect.height || 60

		// Calculate maximum button width to ensure all buttons fit within container
		if (containerWidth) {
			const availableWidth = containerWidth - (2 * startX) // Account for left and right margins
			const maxBtnWidthForColumns = Math.floor((availableWidth - (columns - 1) * gapX) / columns)
			// Use the smaller of actual button width or max calculated width
			if (btnWidth > maxBtnWidthForColumns) {
				console.log(
					`[AdjustLayout] Button width ${btnWidth}px exceeds available space. ` +
						`Container: ${containerWidth}px, columns: ${columns}, gap: ${gapX}px. ` +
						`Adjusting to ${maxBtnWidthForColumns}px per button.`,
				)
				btnWidth = maxBtnWidthForColumns
			}
		}

		// Build a map of buttons by their normalized text content
		const buttonMap = new Map<string, { rect: NodeInfo; text: NodeInfo }>()
		for (const pair of paired) {
			const buttonText = this.extractButtonText(pair.text)
			const normalizedText = this.normalizeButtonText(buttonText)
			buttonMap.set(normalizedText, pair)
			// Also store original text for better matching
			if (normalizedText !== buttonText) {
				buttonMap.set(buttonText, pair)
			}
		}

		console.log(`[AdjustLayout] Button map keys for positioning: ${Array.from(buttonMap.keys()).join(", ")}`)

		// Standard calculator layout - each position can accept multiple button variations
		// The algorithm will try each variation in order until one matches
		const calcLayout: string[][] = [
			["C", "AC", "CE", "CLR"], // Position 0: Clear button (any variation)
			["⌫", "DEL", "←", "±", "+/-"], // Position 1: Delete or plus/minus
			["%"], // Position 2: Percent
			["÷", "/"], // Position 3: Divide
			["7"], ["8"], ["9"], ["×", "*", "x", "X"], // Row 2: 7, 8, 9, multiply
			["4"], ["5"], ["6"], ["-"], // Row 3: 4, 5, 6, minus
			["1"], ["2"], ["3"], ["+"], // Row 4: 1, 2, 3, plus
			["0"], ["."], ["="], // Row 5: 0, dot, equals
		]

		// Define the grid structure: which positions go in which row
		const rowStructure = [
			[0, 1, 2, 3], // Row 1: positions 0-3 (C, ⌫, %, ÷)
			[4, 5, 6, 7], // Row 2: positions 4-7 (7, 8, 9, ×)
			[8, 9, 10, 11], // Row 3: positions 8-11 (4, 5, 6, -)
			[12, 13, 14, 15], // Row 4: positions 12-15 (1, 2, 3, +)
			[16, 17, 18], // Row 5: positions 16-18 (0, ., =) - 0 spans 2 columns
		]

		// Helper to find a button matching any of the variations
		const findButtonForPosition = (variations: string[]): { rect: NodeInfo; text: NodeInfo } | undefined => {
			for (const variant of variations) {
				const pair = buttonMap.get(variant)
				if (pair && !placedIds.has(pair.rect.id)) {
					return pair
				}
			}
			return undefined
		}

		const placedIds = new Set<string>()

		// Helper to place a button pair at position
		const placeButtonPair = (
			pair: { rect: NodeInfo; text: NodeInfo },
			x: number,
			y: number,
			effectiveWidth?: number,
		) => {
			if (placedIds.has(pair.rect.id)) return

			positions.push({ nodeId: pair.rect.id, x, y })
			placedIds.add(pair.rect.id)

			// Center text within the button
			const textX = x + Math.floor(((effectiveWidth || pair.rect.width) - pair.text.width) / 2)
			const textY = y + Math.floor((pair.rect.height - pair.text.height) / 2)
			positions.push({ nodeId: pair.text.id, x: textX, y: textY })
			placedIds.add(pair.text.id)
		}

		// Use calculator layout if we have enough buttons that match
		if (layout === "grid" && paired.length >= 10) {
			// Try to place buttons according to standard calculator layout
			currentY = buttonStartY

			// Process each row in the grid structure
			for (let rowIdx = 0; rowIdx < rowStructure.length; rowIdx++) {
				const rowPositions = rowStructure[rowIdx]
				let colX = startX
				let foundInRow = false

				for (let colIdx = 0; colIdx < rowPositions.length; colIdx++) {
					const posIdx = rowPositions[colIdx]
					const variations = calcLayout[posIdx]
					const pair = findButtonForPosition(variations)

					if (pair) {
						// Special case: 0 button spans 2 columns (last row, first position)
						const isWideZero = rowIdx === rowStructure.length - 1 && colIdx === 0 && variations.includes("0")
						const effectiveWidth = isWideZero ? btnWidth * 2 + gapX : btnWidth

						placeButtonPair(pair, colX, currentY, effectiveWidth)
						foundInRow = true
						colX += effectiveWidth + gapX

						// Log which variation was used
						const usedVariant = this.extractButtonText(pair.text)
						console.log(`[AdjustLayout] Placed "${usedVariant}" at row ${rowIdx + 1}, col ${colIdx + 1}`)
					} else {
						// Skip space for missing button (keep grid alignment)
						colX += btnWidth + gapX
					}
				}

				if (foundInRow) {
					currentY += btnHeight + gapY
				}
			}

			// Place any remaining buttons that weren't in standard layout
			const remainingPairs = paired.filter((p) => !placedIds.has(p.rect.id))
			if (remainingPairs.length > 0) {
				console.log(
					`[AdjustLayout] Remaining buttons not in standard layout: ${remainingPairs.map((p) => this.extractButtonText(p.text)).join(", ")}`,
				)

				let col = 0
				for (const pair of remainingPairs) {
					const x = startX + col * (btnWidth + gapX)
					placeButtonPair(pair, x, currentY)
					col++
					if (col >= columns) {
						col = 0
						currentY += btnHeight + gapY
					}
				}
			}
		} else {
			// Fallback to simple grid/row/column layout for non-calculator UIs
			const layoutItems: Array<{ nodes: NodeInfo[]; width: number; height: number }> = [
				...paired.map((p) => ({
					nodes: [p.rect, p.text],
					width: p.rect.width,
					height: p.rect.height,
				})),
				...standalone.map((n) => ({
					nodes: [n],
					width: n.width,
					height: n.height,
				})),
			]

			if (layout === "grid") {
				let currentX = startX
				currentY = buttonStartY
				let maxHeightInRow = 0
				let col = 0

				for (const item of layoutItems) {
					for (const node of item.nodes) {
						if (node.type === "TEXT" && item.nodes.length > 1) {
							const rect = item.nodes.find((n) => n.type === "RECTANGLE")
							if (rect) {
								const textX = currentX + Math.floor((rect.width - node.width) / 2)
								const textY = currentY + Math.floor((rect.height - node.height) / 2)
								positions.push({ nodeId: node.id, x: textX, y: textY })
							} else {
								positions.push({ nodeId: node.id, x: currentX, y: currentY })
							}
						} else {
							positions.push({ nodeId: node.id, x: currentX, y: currentY })
						}
					}

					maxHeightInRow = Math.max(maxHeightInRow, item.height)
					col++

					if (col >= columns) {
						col = 0
						currentX = startX
						currentY += maxHeightInRow + gapY
						maxHeightInRow = 0
					} else {
						currentX += item.width + gapX
					}
				}
			} else if (layout === "row") {
				let currentX = startX

				for (const item of layoutItems) {
					for (const node of item.nodes) {
						if (node.type === "TEXT" && item.nodes.length > 1) {
							const rect = item.nodes.find((n) => n.type === "RECTANGLE")
							if (rect) {
								const textX = currentX + Math.floor((rect.width - node.width) / 2)
								const textY = buttonStartY + Math.floor((rect.height - node.height) / 2)
								positions.push({ nodeId: node.id, x: textX, y: textY })
							} else {
								positions.push({ nodeId: node.id, x: currentX, y: buttonStartY })
							}
						} else {
							positions.push({ nodeId: node.id, x: currentX, y: buttonStartY })
						}
					}
					currentX += item.width + gapX
				}
			} else if (layout === "column") {
				currentY = buttonStartY

				for (const item of layoutItems) {
					for (const node of item.nodes) {
						if (node.type === "TEXT" && item.nodes.length > 1) {
							const rect = item.nodes.find((n) => n.type === "RECTANGLE")
							if (rect) {
								const textX = startX + Math.floor((rect.width - node.width) / 2)
								const textY = currentY + Math.floor((rect.height - node.height) / 2)
								positions.push({ nodeId: node.id, x: textX, y: textY })
							} else {
								positions.push({ nodeId: node.id, x: startX, y: currentY })
							}
						} else {
							positions.push({ nodeId: node.id, x: startX, y: currentY })
						}
					}
					currentY += item.height + gapY
				}
			}
		}

		// Position standalone elements at the end
		const remainingStandalone = standalone.filter((n) => !placedIds.has(n.id))
		if (remainingStandalone.length > 0) {
			let col = 0
			for (const node of remainingStandalone) {
				const x = startX + col * (node.width + gapX)
				positions.push({ nodeId: node.id, x, y: currentY })
				col++
				if (col >= columns) {
					col = 0
					currentY += node.height + gapY
				}
			}
		}

		return positions
	}

	override async handlePartial(task: Task, block: ToolUse<"adjust_layout">): Promise<void> {
		const nativeArgs = block.nativeArgs as AdjustLayoutParams | undefined
		const partialMessage = JSON.stringify({
			tool: "adjustLayout",
			layout: nativeArgs?.layout || "(streaming...)",
			columns: nativeArgs?.columns || "(streaming...)",
			useAI: nativeArgs?.useAI || "false",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const adjustLayoutTool = new AdjustLayoutTool()
