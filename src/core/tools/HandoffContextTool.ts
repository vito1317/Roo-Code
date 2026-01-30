/**
 * Sentinel Edition - Handoff Context Tool
 *
 * Allows agents to submit structured handoff context when completing
 * their phase, triggering the FSM transition to the next agent.
 */

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	type HandoffContext,
	type ArchitectPlan,
	type BuilderTestContext,
	type QAAuditContext,
	type SentinelAuditResult,
} from "../sentinel/HandoffContext"
import { AgentState } from "../sentinel/StateMachine"

/**
 * Parameters for the handoff context tool
 */
interface HandoffContextParams {
	notes: string
	context_json: string
}

/**
 * Handoff Context Tool
 *
 * Used by agents to submit their work output and trigger transition
 * to the next agent in the workflow.
 */
export class HandoffContextTool extends BaseTool<"handoff_context"> {
	readonly name = "handoff_context" as const

	/**
	 * Parse legacy XML parameters
	 */
	parseLegacy(params: Partial<Record<string, string>>): HandoffContextParams {
		return {
			notes: params.notes || "",
			// Accept multiple parameter name variants for robustness
			context_json: params.context_json || params.contextJson || params.context_data || params.contextData || "{}",
		}
	}

	/**
	 * Execute the tool
	 */
	async execute(
		params: HandoffContextParams,
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		const { notes, context_json } = params

		try {
			// Validate we have context
			if (!context_json || context_json === "{}") {
				task.consecutiveMistakeCount++
				task.recordToolError("handoff_context")
				pushToolResult(
					await task.sayAndCreateMissingParamError("handoff_context", "context_json")
				)
				return
			}

			// Check if Sentinel FSM is active
			const fsm = task.sentinelStateMachine
			if (!fsm || !fsm.isActive()) {
				pushToolResult(
					formatResponse.toolError(
						"Sentinel FSM is not active. Use this tool only within a Sentinel workflow."
					)
				)
				return
			}

			task.consecutiveMistakeCount = 0

			// Parse the context JSON
			let parsedContext: Record<string, unknown>
			try {
				parsedContext = JSON.parse(context_json)
			} catch (parseError) {
				task.recordToolError("handoff_context")
				pushToolResult(
					formatResponse.toolError(
						`Invalid JSON in context_json: ${(parseError as Error).message}`
					)
				)
				return
			}

			// Build handoff data based on current agent
			const currentState = fsm.getCurrentState()
		
			// STRICT VALIDATION: Designer must have created actual UI elements
			if (currentState === AgentState.DESIGNER) {
				const createdComponents = Array.isArray(parsedContext.createdComponents)
					? parsedContext.createdComponents
					: Array.isArray(parsedContext.created_components)
					? parsedContext.created_components
					: []
				
				const expectedElements = typeof parsedContext.expectedElements === "number"
					? parsedContext.expectedElements
					: typeof parsedContext.expected_elements === "number"
					? parsedContext.expected_elements
					: 0
				
				// Reject if no elements were created
			// Reject if no elements were created
				// Also reject if only "frame" type elements with no children (empty containers don't count)
				const hasActualContent = createdComponents.some((comp: any) => {
					// If it's an object with children, it has content
					if (typeof comp === "object" && comp.children && comp.children.length > 0) {
						return true
					}
					// If it's a simple string, count it as a frame name (no actual content)
					return false
				})
				
				// STRICT: Require at least 15 elements for a proper design
				const MIN_REQUIRED_ELEMENTS = 15

				// ====== Fetch ACTUAL element count from UIDesignCanvas ======
				let actualElementCount = 0
				try {
					const resp = await fetch("http://127.0.0.1:4420/design", { signal: AbortSignal.timeout(3000) })
					if (resp.ok) {
						const design = await resp.json()
						const count = (els: any[]): number => els.reduce((n, e) => n + 1 + (e.children ? count(e.children) : 0), 0)
						actualElementCount = count(design.elements || [])
						console.log(`[HandoffContextTool] UIDesignCanvas ACTUAL: ${actualElementCount} elements`)
					}
				} catch (e) { /* ignore */ }
				if (actualElementCount > 0 && actualElementCount < MIN_REQUIRED_ELEMENTS) {
					task.recordToolError("handoff_context")
					pushToolResult(formatResponse.toolError(`❌ 設計驗證失敗！實際只有 ${actualElementCount} 個元素（需要 ${MIN_REQUIRED_ELEMENTS} 個）。請繼續創建更多 UI 元素！`))
					return
				}
				
				if (createdComponents.length === 0 || expectedElements === 0) {
					task.recordToolError("handoff_context")
					pushToolResult(
						formatResponse.toolError(
							`❌ **Empty Handoff Rejected!**\n\n` +
							`Designer 必須先使用 MCP 工具創建 UI 元素才能 handoff！\n\n` +
							`**你提交的內容：**\n` +
							`- createdComponents: ${createdComponents.length} 個（需要 > 0）\n` +
							`- expectedElements: ${expectedElements}（需要 > 0）\n\n` +
							`**請先使用以下工具創建 UI 元素：**\n` +
							`1. \`use_mcp_tool\` - 使用 UIDesignCanvas 服務創建元素\n` +
							`2. \`parallel_ui_tasks\` - 批量創建多個 UI 元素\n` +
							`3. \`parallel_mcp_calls\` - 批量執行 MCP 工具\n\n` +
							`**注意：只創建 Frame 不算完成設計！必須在 Frame 內創建按鈕、文字、圖標等 UI 元素！**\n\n` +
							`創建元素後再 handoff，請重試！`
						)
					)
					return
				}
				
				// ADDITIONAL CHECK: If only frames without content, reject
				if (expectedElements < MIN_REQUIRED_ELEMENTS) {
					task.recordToolError("handoff_context")
					pushToolResult(
						formatResponse.toolError(
							`❌ **設計不完整！元素數量不足！**\n\n` +
							`你只創建了 ${expectedElements} 個元素，至少需要 ${MIN_REQUIRED_ELEMENTS} 個！\n\n` +
							`**你目前創建的：**\n` +
							createdComponents.slice(0, 10).map((c: any) => `- ${typeof c === "string" ? c : c.name || c.type || "unknown"}`).join("\n") +
							(createdComponents.length > 10 ? `\n... 還有 ${createdComponents.length - 10} 個` : "") +
							`\n\n**一個完整的畫面應該包含：**\n` +
							`- 導航欄（Logo、標題、按鈕）\n` +
							`- 主要內容區域（卡片、列表項目）\n` +
							`- 表單元素（輸入框、按鈕）\n` +
							`- 圖標和裝飾元素\n\n` +
							`**請繼續使用 MCP 工具創建更多 UI 元素！**`
						)
					)
					return
				}
			}
			
			const handoffData = this.buildHandoffData(currentState, parsedContext, notes)

			// Show what's being submitted
			await task.say(
				"text",
				`🔄 Submitting handoff context from ${currentState}...`,
			)

			// Trigger FSM transition
			const result = await fsm.handleAgentCompletion(handoffData)

		if (result.success) {
				// Format context for display - show each field clearly
				let contextDisplay = ""
				const formatValue = (val: unknown, indent = 0): string => {
					const prefix = "  ".repeat(indent)
					if (val === null || val === undefined) return `${prefix}(empty)`
					if (Array.isArray(val)) {
						if (val.length === 0) return `${prefix}(empty list)`
						return val.map((v, i) => `${prefix}${i + 1}. ${typeof v === 'object' ? JSON.stringify(v) : v}`).join("\n")
					}
					if (typeof val === 'object') {
						return Object.entries(val as Record<string, unknown>)
							.map(([k, v]) => `${prefix}**${k}:** ${typeof v === 'object' ? '\n' + formatValue(v, indent + 1) : v}`)
							.join("\n")
					}
					return `${prefix}${val}`
				}
				
				try {
					contextDisplay = Object.entries(parsedContext)
						.map(([key, value]) => {
							const formattedValue = typeof value === 'object' 
								? '\n' + formatValue(value, 1)
								: String(value)
							return `- **${key}:** ${formattedValue}`
						})
						.join("\n\n")
				} catch {
					contextDisplay = JSON.stringify(parsedContext, null, 2)
				}
				
				pushToolResult(
					`✅ Handoff successful!\n\n` +
					`- **From:** ${result.fromState}\n` +
					`- **To:** ${result.toState}\n` +
					`- **Notes:** ${notes || "(none)"}\n\n` +
					`---\n\n` +
					`## 📋 Handoff Context (AI-to-AI Message):\n\n` +
					`${contextDisplay}\n\n` +
					`---\n\n` +
					`The workflow will now continue with the ${result.toState} agent.`
				)
				
				// CRITICAL: Add auto-continue message to trigger next agent
				// This tells the next agent what to do based on their role
				const continueMessage = this.buildContinueMessage(result.toState, parsedContext)
				task.userMessageContent.push({
					type: "text",
					text: continueMessage,
				})
			} else {
				if (result.toState === AgentState.BLOCKED) {
					pushToolResult(
						`⚠️ Workflow blocked!\n\n` +
						`- **Reason:** ${result.error}\n\n` +
						`Human intervention is required to continue.`
					)
				} else {
					pushToolResult(
						formatResponse.toolError(
							`Handoff failed: ${result.error}`
						)
					)
				}
			}
		} catch (error) {
			await handleError("submitting handoff context", error as Error)
		}
	}

	/**
	 * Build handoff data based on current agent state
	 */
	private buildHandoffData(
		currentState: AgentState,
		parsedContext: Record<string, unknown>,
		notes: string,
	): Partial<HandoffContext> {
		const base: Partial<HandoffContext> = {
			previousAgentNotes: notes,
		}

		// Extract figmaUrl if present in context (for Designer routing)
		if (parsedContext.figmaUrl && typeof parsedContext.figmaUrl === "string") {
			base.figmaUrl = parsedContext.figmaUrl
		}

		// Extract designSpecs if present
		if (parsedContext.designSpecs && typeof parsedContext.designSpecs === "string") {
			base.designSpecs = parsedContext.designSpecs
		}

		switch (currentState) {
			case AgentState.ARCHITECT: {
				// Extract design flags to root level for StateMachine routing
				// These flags determine whether to route to Designer or Builder
				const needsDesign = parsedContext.needsDesign === true || parsedContext.needs_design === true
				const hasUI = parsedContext.hasUI === true || parsedContext.has_ui === true
				const useFigma = parsedContext.useFigma === true || parsedContext.use_figma === true
				const usePenpot = parsedContext.usePenpot === true || parsedContext.use_penpot === true
				const useUIDesignCanvas = parsedContext.useUIDesignCanvas === true || parsedContext.use_ui_design_canvas === true
				
				console.log("[HandoffContextTool] Architect design flags:", { needsDesign, hasUI, useFigma, usePenpot, useUIDesignCanvas })
				
				return {
					...base,
					// Design flags at root level for StateMachine routing
					needsDesign,
					hasUI,
					useFigma,
					usePenpot,
					useUIDesignCanvas,
					// Full plan in architectPlan for reference
					architectPlan: parsedContext as unknown as ArchitectPlan,
				}
			}

			case AgentState.DESIGNER: {
				// CRITICAL: Extract element counts for FSM transition validation
				// The StateMachine requires expectedElements >= 15 for handoff to pass
				const expectedElements = typeof parsedContext.expectedElements === "number" 
					? parsedContext.expectedElements 
					: typeof parsedContext.expected_elements === "number"
					? parsedContext.expected_elements
					: 0
				
				const actualElements = typeof parsedContext.actualElements === "number"
					? parsedContext.actualElements
					: typeof parsedContext.actual_elements === "number"
					? parsedContext.actual_elements
					: expectedElements // fallback to expected if actual not specified
				
				const createdComponents = Array.isArray(parsedContext.createdComponents)
					? parsedContext.createdComponents
					: Array.isArray(parsedContext.created_components)
					? parsedContext.created_components
					: []
				
				console.log(`[HandoffContextTool] Designer handoff: expectedElements=${expectedElements}, actualElements=${actualElements}, createdComponents=${createdComponents.length}`)
				
				// WARNING: If expectedElements < 15, the FSM will reject this handoff
				if (expectedElements < 15) {
					console.warn(`[HandoffContextTool] WARNING: Designer submitting with only ${expectedElements} elements (minimum is 15). FSM will likely reject this handoff.`)
				}
				
				return {
					...base,
					designSpecs: parsedContext.designSpecs as string || JSON.stringify(parsedContext),
					expectedElements,
					actualElements,
					createdComponents: createdComponents as string[],
				}
			}

			case AgentState.DESIGN_REVIEW:
				// Extract designReviewPassed and other review fields
				// Note: designReviewPassed must be explicitly true to pass, default is rejected
				console.log("[HandoffContextTool] Design Review context:", {
					designReviewPassed: parsedContext.designReviewPassed,
					status: parsedContext.status,
					completion_percentage: parsedContext.completion_percentage,
				})
				return {
					...base,
					designReviewPassed: parsedContext.designReviewPassed as boolean | undefined,
					designReviewStatus: parsedContext.status as string | undefined,
					completion_percentage: parsedContext.completion_percentage as string | undefined,
					expectedElements: parsedContext.expectedElements as number | undefined,
					actualElements: parsedContext.actualElements as number | undefined,
					missingComponents: parsedContext.missingComponents as string[] | undefined,
				}

			case AgentState.BUILDER:
				return {
					...base,
					builderTestContext: parsedContext as unknown as BuilderTestContext,
				}

			case AgentState.QA_ENGINEER:
				return {
					...base,
					qaAuditContext: parsedContext as unknown as QAAuditContext,
				}

			case AgentState.SENTINEL:
				return {
					...base,
					sentinelResult: parsedContext as unknown as SentinelAuditResult,
				}

			default:
				return base
		}
	}

	/**
	 * Handle partial streaming
	 */
	override async handlePartial(task: Task, block: ToolUse<"handoff_context">): Promise<void> {
		const nativeArgs = block.nativeArgs as { notes?: string; context_json?: string } | undefined
		const notes = nativeArgs?.notes
		const contextJson = nativeArgs?.context_json

		// Try to show a preview of the context
		let preview = "(parsing...)"
		if (contextJson) {
			try {
				const parsed = JSON.parse(contextJson)
				preview = `Keys: ${Object.keys(parsed).join(", ")}`
			} catch {
				preview = "(streaming...)"
			}
		}

		const partialMessage = JSON.stringify({
			tool: "handoff_context",
			notes: notes || "(streaming...)",
			contextPreview: preview,
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}

	/**
	 * Build a continue message for the next agent based on their role
	 */
	private buildContinueMessage(toState: AgentState, context: Record<string, unknown>): string {
		switch (toState) {
			case AgentState.ARCHITECT:
				return `[AUTO-CONTINUE] You are the Architect. Review the feedback and create/update the implementation plan.`
			case AgentState.DESIGNER: {
				// Check if this is a rejection from Design Review
				const isRejection = context.designReviewPassed === false ||
					context.designReviewStatus === "rejected" ||
					context.missingComponents !== undefined ||
					context.feedback !== undefined

				if (isRejection) {
					// Designer is being sent back to fix issues
					const missingComponents = context.missingComponents as string[] | undefined
					const feedback = context.feedback as string | undefined
					const expectedElements = context.expectedElements as number | undefined
					const actualElements = context.actualElements as number | undefined

					let rejectionDetails = ""
					if (feedback) {
						rejectionDetails += `**Design Review 的反饋：**\n${feedback}\n\n`
					}
					if (missingComponents && missingComponents.length > 0) {
						rejectionDetails += `**缺少的元素：**\n${missingComponents.map(c => `- ${c}`).join("\n")}\n\n`
					}
					if (expectedElements !== undefined && actualElements !== undefined) {
						rejectionDetails += `**元素數量：** 預期 ${expectedElements} 個，實際 ${actualElements} 個\n\n`
					}

					return `[AUTO-CONTINUE] 你是 Designer，**設計被 Design Review 退回了！**\n\n` +
						`## ❌ 退回原因\n\n${rejectionDetails}` +
						`## 🔧 你需要做的事\n\n` +
						`1. **閱讀上面的反饋**，了解哪些地方需要修正\n` +
						`2. **使用 get_node_info** 檢查現有設計\n` +
						`3. **修正缺失的元素** - 使用 parallel_ui_tasks 或 parallel_mcp_calls 創建缺少的元素\n` +
						`4. **再次 handoff** 給 Design Review\n\n` +
						`⚠️ **不要從頭開始！** 只需要修正被指出的問題！\n\n` +
						`⚠️ **修正後記得設定正確的 position！** 不要讓新元素與現有元素重疊！`
				}

				// First time going to Designer (not a rejection)
				if (context.figmaUrl) {
					return `[AUTO-CONTINUE] You are the Designer.\n\n` +
						`**YOUR MISSION:** Analyze the Figma design and create design-specs.md\n\n` +
						`**STEP 0:** Launch browser to show the Figma design to the user:\n` +
						`\`\`\`xml\n<browser_action>\n<action>launch</action>\n<url>${context.figmaUrl}</url>\n</browser_action>\n\`\`\`\n\n` +
						`**STEP 1:** Use the BUILT-IN figma server (NO installation needed):\n` +
						'```xml\n<use_mcp_tool>\n<server_name>figma</server_name>\n<tool_name>get_simplified_structure</tool_name>\n<arguments>{"file_key": "EXTRACT_FROM_URL"}</arguments>\n</use_mcp_tool>\n```\n\n' +
						`Extract file_key from URL: ${context.figmaUrl}\n\n` +
						`**STEP 2:** Create design-specs.md with colors, fonts, spacing\n\n` +
						`**STEP 3:** ONLY THEN use handoff_context to pass to Builder\n\n` +
						`⚠️ DO NOT handoff until design-specs.md is created!`
				} else {
					return `[AUTO-CONTINUE] You are the Designer.\n\n` +
						`**YOUR MISSION:** Create design-specs.md for the UI\n\n` +
						`**OPTION A:** Use generate_image (if available) to create mockup\n\n` +
						`**OPTION B (FALLBACK):** Create text-only design-specs.md with:\n` +
						`- ASCII layout diagram\n` +
						`- Color palette (hex codes): e.g. primary: #FF6B00, bg: #1E1E1E\n` +
						`- Typography: font-family, sizes, weights\n` +
						`- Spacing: padding, margins, gaps\n` +
						`- Component hierarchy and states\n\n` +
						`**STEP FINAL:** Use handoff_context ONLY AFTER design-specs.md exists\n\n` +
						`⚠️ DO NOT handoff until design-specs.md is created!`
				}
			}
			case AgentState.BUILDER:
				return `[AUTO-CONTINUE] You are the Builder. Implement according to the plan and design specs: ${JSON.stringify(context).slice(0, 500)}`
			case AgentState.QA_ENGINEER: {
				// Extract targetUrl from context if available
				const targetUrl = (context as any).targetUrl || 
					(context as any).runCommand?.includes('localhost') ? 'http://localhost:3000' : 
					'http://localhost:3000'
				
				return `[AUTO-CONTINUE] You are QA. Test the implementation.

**CRITICAL: YOU MUST OPEN THE BROWSER!**

**🚀 STEP 1: Launch the app in browser:**
\`\`\`xml
<browser_action>
<action>launch</action>
<url>${targetUrl}</url>
</browser_action>
\`\`\`

**🔍 STEP 2: Extract DOM to see actual structure:**
\`\`\`xml
<browser_action>
<action>dom_extract</action>
</browser_action>
\`\`\`

**🧪 STEP 3: Test interactions (click buttons, verify display):**
\`\`\`xml
<browser_action>
<action>click</action>
<coordinate>160,400</coordinate>
</browser_action>
\`\`\`

**📊 STEP 4: Compare DOM vs design-specs.md**
- Read design-specs.md first
- Count elements: buttons, text, layout
- Check if layout matches (grid vs column)

**⚠️ YOU CANNOT PASS WITHOUT OPENING THE BROWSER!**`
			}
			case AgentState.ARCHITECT_REVIEW_TESTS: {
				// Inject RAG UI guidelines based on detected UI type
				const guidelines = this.getRAGGuidelinesForContext(context)
				return `[AUTO-CONTINUE] Review the work and decide: approve or reject with feedback.\n\n${guidelines}`
			}
			case AgentState.SENTINEL:
				return `[AUTO-CONTINUE] You are Sentinel Security. Perform security audit. After audit, use handoff_context to pass to Architect Final.`
			case AgentState.ARCHITECT_REVIEW_FINAL:
				return `[AUTO-CONTINUE] You are Architect Final Review. Create a walkthrough.md summarizing all work completed, then use attempt_completion.`
			case AgentState.COMPLETED:
				return `[AUTO-CONTINUE] Workflow completed. Use attempt_completion to finish.`
			default:
				return `[AUTO-CONTINUE] Continue with your assigned role.`
		}
	}

	/**
	 * Get RAG UI guidelines based on context (detects UI type from plan)
	 */
	private getRAGGuidelinesForContext(context: Record<string, unknown>): string {
		try {
			// Import the RAG system dynamically
			const { getFormattedUIGuidelines } = require("../sentinel/ui-guidelines")
			
			// Try to detect UI type from the context (plan, description, etc.)
			const contextStr = JSON.stringify(context)
			const guidelines = getFormattedUIGuidelines(contextStr)
			
			if (guidelines) {
				return `## 📋 UI GUIDELINES (from RAG):\n${guidelines}`
			}
		} catch (error) {
			console.error("[HandoffContext] Error loading RAG guidelines:", error)
		}
		return ""
	}
}

/**
 * Singleton tool instance
 */
export const handoffContextTool = new HandoffContextTool()
