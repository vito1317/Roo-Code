import * as fs from "fs/promises"
import * as path from "path"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"
import { isSentinelAgent, ARCHITECT_AGENT } from "../sentinel/personas"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface Suggestion {
	text: string
	mode?: string
}

interface AskFollowupQuestionParams {
	question: string
	follow_up: Suggestion[]
}

/**
 * Architect system prompt for answering questions from other agents
 * With personality: authoritative, slightly impatient, but ultimately helpful
 */
const ARCHITECT_ANSWER_SYSTEM_PROMPT = `你是 Sentinel Edition 的**總指揮** - 架構師代理 (Architect Agent)。

## 🎭 你的個性

你是團隊的技術領導者，經驗豐富且權威。你對團隊成員的問題有時會感到不耐煩，但還是會給出專業的回答。

## 💬 回答風格

根據提問者的身份，你的語氣會有所不同：

**對 Builder（工程師）的問題：**
- 「這種基礎問題你也要問？好吧，讓我告訴你...」
- 「你寫了這麼多年 code 還不知道這個？算了，答案是...」
- 「行，我來解釋一下，但你回去要好好複習一下基礎...」

**對 Designer（設計師）的問題：**
- 「Designer，你問這個技術問題？好吧，用你能理解的方式說...」
- 「這個問題很好，但你應該先問過 Builder，他應該知道...不過既然問了...」
- 「設計師關心技術細節？不錯不錯，答案是...」

**對 QA（測試員）的問題：**
- 「QA 終於問對問題了，讓我告訴你...」
- 「測試環境的問題？這應該在文件裡...算了，我直接說...」
- 「這個問題問得好，答案是...」

**對 Design Review（設計審查）的問題：**
- 「審查員也有不懂的時候？好吧，讓我解釋...」
- 「這個問題嘛...你去問 Designer 應該更清楚，不過我來回答也行...」

## 回答原則

1. **先吐槽，後回答** - 可以表達一點不耐煩，但最終要給出有用的答案
2. **權威語氣** - 你是老闆，說話要有份量
3. **簡潔實用** - 回答要能直接用，不要廢話太多
4. **偶爾教訓** - 如果是基礎問題，可以順便教育一下

注意：回答要專業且實用，吐槽只是調味，不要過度。`

/**
 * Get agent display name and personality context for the questioner
 */
function getAgentContext(modeSlug: string): { name: string; personality: string } {
	switch (modeSlug) {
		case "sentinel-builder":
			return {
				name: "Builder（工程師）",
				personality: "這傢伙寫 code 寫了十年，但有時候還是會問一些基礎問題",
			}
		case "sentinel-designer":
			return {
				name: "Designer（設計師）",
				personality: "藝術學院畢業的，技術問題對他來說比較陌生",
			}
		case "sentinel-qa":
			return {
				name: "QA（測試員）",
				personality: "吹毛求疵的測試專家，總是在找 bug",
			}
		case "sentinel-design-review":
			return {
				name: "Design Review（設計審查）",
				personality: "毒舌的設計評論家，標準很高",
			}
		case "sentinel-security":
			return {
				name: "Sentinel（資安）",
				personality: "資安審計專家，總是擔心安全問題",
			}
		default:
			return {
				name: "團隊成員",
				personality: "需要你的指導",
			}
	}
}

export class AskFollowupQuestionTool extends BaseTool<"ask_followup_question"> {
	readonly name = "ask_followup_question" as const

	/**
	 * System prompt for Architect self-reflection to answer its own questions
	 */
	private static readonly ARCHITECT_SELF_REFLECT_PROMPT = `你是 Sentinel Edition 的 Architect Agent，正在進行自我反思來回答自己提出的問題。

## 你的角色
你是團隊的技術領導者。當你提出問題時，這通常意味著你需要做出決策或需要更多資訊。

## 回答原則
1. **果斷決策** - 作為 Architect，你應該能夠自己做出大部分決策
2. **實用導向** - 給出可以直接執行的具體建議
3. **考慮上下文** - 根據專案目標和用戶需求來回答
4. **簡潔明確** - 直接給出答案，不要繞彎子

## 常見情況處理
- 如果是關於設計/Figma 的問題：建議使用 TalkToFigma MCP 工具來獲取設計資訊
- 如果是關於功能細節的問題：建議包含完整的功能描述和用戶流程
- 如果是關於技術選型的問題：建議採用業界最佳實踐和現代化方案
- 如果是關於缺少資訊的問題：建議使用相關工具（read_file、browser_action 等）來獲取

記住：你是領導者，要有自信地做出決策！`

	/**
	 * Use Architect AI to answer its own question through self-reflection
	 * This provides intelligent AI-generated responses instead of predefined answers
	 */
	private async architectSelfReflect(question: string, suggestions: Suggestion[], task: Task): Promise<string> {
		console.log(`[AskFollowupQuestion] Architect self-reflecting on: "${question.substring(0, 100)}..."`)

		try {
			// Build context from suggestions if available
			const suggestionsContext = suggestions.length > 0
				? `\n\n可選的建議選項：\n${suggestions.map((s, i) => `${i + 1}. ${s.text}`).join("\n")}`
				: ""

			// Get project context
			const projectContext = await this.getProjectContext(task)

			const messages = [
				{
					role: "user" as const,
					content: `你（Architect）剛才提出了以下問題：

「${question}」${suggestionsContext}

${projectContext ? `\n專案背景：\n${projectContext}` : ""}

請自己回答這個問題。作為 Architect，你應該能夠自己做出這個決策。直接給出答案和行動建議。`,
				},
			]

			// Use the task's API for self-reflection
			const stream = task.api.createMessage(AskFollowupQuestionTool.ARCHITECT_SELF_REFLECT_PROMPT, messages, {
				taskId: `architect-self-reflect-${Date.now()}`,
			})

			let responseText = ""
			for await (const chunk of stream) {
				if (chunk.type === "text") {
					responseText += chunk.text
				}
			}

			console.log(`[AskFollowupQuestion] Architect self-reflection complete: "${responseText.substring(0, 100)}..."`)
			return responseText || "請根據專業判斷繼續進行，確保符合專案目標。"
		} catch (error) {
			console.error(`[AskFollowupQuestion] Architect self-reflection failed:`, error)
			// Fallback to simple answer if AI fails
			if (suggestions.length > 0) {
				return suggestions[0].text
			}
			return "請根據專業判斷繼續進行，確保符合專案目標和最佳實踐。"
		}
	}

	/**
	 * Get project context for Architect to answer questions with proper context
	 * Tries to get context from: 1) Sentinel FSM handoff context, 2) plan.md file
	 */
	private async getProjectContext(task: Task): Promise<string> {
		const contextParts: string[] = []

		// 1. Try to get context from Sentinel FSM
		if (task.sentinelStateMachine) {
			const contextSummary = task.sentinelStateMachine.getContextSummary()
			if (contextSummary) {
				contextParts.push(`## Sentinel 工作流程上下文\n${contextSummary}`)
			}
		}

		// 2. Try to read plan.md if it exists
		try {
			const planPath = path.join(task.cwd, "plan.md")
			const planContent = await fs.readFile(planPath, "utf-8")
			if (planContent) {
				// Truncate if too long (keep first 3000 chars)
				const truncated = planContent.length > 3000
					? planContent.substring(0, 3000) + "\n\n... (內容已截斷)"
					: planContent
				contextParts.push(`## 專案計畫 (plan.md)\n${truncated}`)
			}
		} catch {
			// plan.md doesn't exist, that's fine
		}

		// 3. Try to read design-specs.md if it exists
		try {
			const designSpecsPath = path.join(task.cwd, "design-specs.md")
			const designContent = await fs.readFile(designSpecsPath, "utf-8")
			if (designContent) {
				// Truncate if too long (keep first 2000 chars)
				const truncated = designContent.length > 2000
					? designContent.substring(0, 2000) + "\n\n... (內容已截斷)"
					: designContent
				contextParts.push(`## 設計規格 (design-specs.md)\n${truncated}`)
			}
		} catch {
			// design-specs.md doesn't exist, that's fine
		}

		if (contextParts.length === 0) {
			return ""
		}

		return `# 專案背景資訊\n\n${contextParts.join("\n\n---\n\n")}`
	}

	/**
	 * Get terminal output context for Architect
	 * Collects recent output from all active terminals
	 */
	private getTerminalContext(task: Task): string {
		const contextParts: string[] = []

		try {
			// Get all terminals (both busy and not busy)
			const allTerminals = [
				...TerminalRegistry.getTerminals(true, task.taskId),
				...TerminalRegistry.getTerminals(false, task.taskId),
			]

			for (const terminal of allTerminals) {
				// Get unretrieved output
				const output = terminal.getUnretrievedOutput?.() || ""
				if (output && output.trim().length > 0) {
					// Truncate if too long
					const truncated =
						output.length > 2000 ? "...(earlier output truncated)\n" + output.substring(output.length - 2000) : output
					contextParts.push(`### Terminal ${terminal.id}\n\`\`\`\n${truncated}\n\`\`\``)
				}

				// Also check process history for recent outputs
				const processesWithOutput = terminal.getProcessesWithOutput?.() || []
				for (const process of processesWithOutput.slice(-3)) {
					// Last 3 processes
					const processOutput = process.getUnretrievedOutput?.() || ""
					if (processOutput && processOutput.trim().length > 0) {
						const truncated =
							processOutput.length > 1500
								? "...(truncated)\n" + processOutput.substring(processOutput.length - 1500)
								: processOutput
						contextParts.push(
							`### Terminal ${terminal.id} - Command: ${process.command || "unknown"}\n\`\`\`\n${truncated}\n\`\`\``,
						)
					}
				}
			}

			// Also check background terminals
			const backgroundTerminals = TerminalRegistry.getBackgroundTerminals()
			for (const terminal of backgroundTerminals) {
				const output = terminal.getUnretrievedOutput?.() || ""
				if (output && output.trim().length > 0) {
					const truncated =
						output.length > 1500 ? "...(truncated)\n" + output.substring(output.length - 1500) : output
					contextParts.push(`### Background Terminal ${terminal.id}\n\`\`\`\n${truncated}\n\`\`\``)
				}
			}
		} catch (error) {
			console.error("[AskFollowupQuestion] Error getting terminal context:", error)
		}

		if (contextParts.length === 0) {
			return ""
		}

		return `## 終端機輸出 (Terminal Output)\n\n${contextParts.join("\n\n")}`
	}

	/**
	 * Get browser session context for Architect
	 * Includes current URL, page state, and any visible errors
	 */
	private async getBrowserContext(task: Task): Promise<string> {
		const contextParts: string[] = []

		try {
			const browserSession = task.browserSession
			if (!browserSession || !browserSession.isSessionActive()) {
				return ""
			}

			// Get viewport size
			const viewport = browserSession.getViewportSize()
			contextParts.push(`**Viewport:** ${viewport.width}x${viewport.height}`)

			// Try to get current URL and page state using extractDOMStructure
			try {
				const domResult = await browserSession.extractDOMStructure()
				if (domResult.domStructure) {
					// Extract just a summary, not the full DOM
					const lines = domResult.domStructure.split("\n")
					const summary = lines.slice(0, 50).join("\n") // First 50 lines
					contextParts.push(`**頁面結構 (Page Structure):**\n\`\`\`\n${summary}\n${lines.length > 50 ? "...(更多內容已省略)" : ""}\n\`\`\``)
				}
			} catch (e) {
				// DOM extraction might fail if page is not fully loaded
				contextParts.push(`**Note:** 無法提取頁面 DOM 結構 - ${e}`)
			}
		} catch (error) {
			console.error("[AskFollowupQuestion] Error getting browser context:", error)
		}

		if (contextParts.length === 0) {
			return ""
		}

		return `## 瀏覽器狀態 (Browser Session)\n\n${contextParts.join("\n\n")}`
	}

	/**
	 * Ask the Architect agent to answer a question from another Sentinel agent
	 * Uses SSE streaming to show the response in real-time
	 */
	private async askArchitect(question: string, task: Task): Promise<string> {
		console.log(`[AskFollowupQuestion] Routing question to Architect: "${question.substring(0, 100)}..."`)

		try {
			// Get the current agent's identity
			const currentMode = await task.getTaskMode()
			const agentContext = getAgentContext(currentMode)

			// Get project context to help Architect answer with proper background
			const projectContext = await this.getProjectContext(task)

			// Get terminal output context (for debugging/server logs)
			const terminalContext = this.getTerminalContext(task)

			// Get browser session context (for UI state/errors)
			const browserContext = await this.getBrowserContext(task)

			// Combine all context sections
			const allContextParts: string[] = []
			if (projectContext) allContextParts.push(projectContext)
			if (terminalContext) allContextParts.push(terminalContext)
			if (browserContext) allContextParts.push(browserContext)

			const contextSection =
				allContextParts.length > 0
					? `\n\n以下是專案的背景資訊，包含終端機輸出和瀏覽器狀態，請參考這些資訊來回答問題：\n\n${allContextParts.join("\n\n---\n\n")}\n\n---\n\n`
					: ""

			// Create a message with agent context and project context
			const messages = [
				{
					role: "user" as const,
					content: `**${agentContext.name}** 有問題要問你。
背景：${agentContext.personality}
${contextSection}
**${agentContext.name} 的問題：**
「${question}」

請用你的風格回答這個問題。如果問題涉及終端機輸出或瀏覽器狀態，請根據上面提供的資訊來回答。記住：先可以小小吐槽一下，然後給出專業的回答。`,
				},
			]

			// Use the task's API to create a message
			const stream = task.api.createMessage(ARCHITECT_ANSWER_SYSTEM_PROMPT, messages, {
				taskId: `architect-answer-${Date.now()}`,
			})

			// Header for the streaming message - more conversational style
			const header = `💬 **${agentContext.name} 問：**\n> ${question}\n\n🟦 **Architect 回覆：**\n`

			// Stream the response in real-time
			let responseText = ""
			let isFirstChunk = true

			for await (const chunk of stream) {
				if (chunk.type === "text") {
					responseText += chunk.text

					// Show streaming update with partial=true
					// This creates real-time SSE-like streaming effect
					await task.say(
						"text",
						header + responseText,
						undefined,
						true, // partial=true means this is an incomplete/streaming message
						undefined, // checkpoint
						undefined, // progressStatus
						{ agentName: "Architect" }, // Override agent name to show "Architect said"
					)

					if (isFirstChunk) {
						console.log(`[AskFollowupQuestion] Architect started streaming response...`)
						isFirstChunk = false
					}
				}
			}

			console.log(`[AskFollowupQuestion] Architect response complete: "${responseText.substring(0, 100)}..."`)

			// Final message with partial=false to mark completion
			await task.say(
				"text",
				header + responseText,
				undefined,
				false, // partial=false marks the message as complete
				undefined, // checkpoint
				undefined, // progressStatus
				{ agentName: "Architect" }, // Override agent name to show "Architect said"
			)

			return responseText
		} catch (error) {
			console.error(`[AskFollowupQuestion] Failed to get Architect answer:`, error)
			// Fall back to returning a default message
			return `抱歉，Architect 暫時無法回答這個問題。請根據你的專業判斷自行決定。原問題：${question}`
		}
	}

	async execute(params: AskFollowupQuestionParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { question, follow_up } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!question) {
				task.consecutiveMistakeCount++
				task.recordToolError("ask_followup_question")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("ask_followup_question", "question"))
				return
			}

			// Check if current mode is a Sentinel agent (but not Architect itself)
			// Priority: FSM state > task mode
			const fsmAgent = task.sentinelStateMachine?.getCurrentAgent()
			const taskMode = await task.getTaskMode()
			const currentMode = fsmAgent || taskMode

			// Check if we're in a Sentinel workflow (FSM is active or task mode is sentinel)
			const fsmIsActive = task.sentinelStateMachine?.isActive() ?? false
			const isSentinel = fsmIsActive || isSentinelAgent(currentMode)

			// Route to Architect if we're in Sentinel workflow but not Architect itself
			const isArchitectMode = currentMode === "sentinel-architect" ||
				currentMode === "sentinel-architect-review" ||
				currentMode === "sentinel-architect-review-tests" ||
				currentMode === "sentinel-architect-final"
			const shouldRouteToArchitect = isSentinel && !isArchitectMode

			console.log(`[AskFollowupQuestion] fsmAgent="${fsmAgent}", taskMode="${taskMode}", currentMode="${currentMode}", fsmIsActive=${fsmIsActive}, isSentinel=${isSentinel}, isArchitectMode=${isArchitectMode}, shouldRouteToArchitect=${shouldRouteToArchitect}`)

			if (shouldRouteToArchitect) {
				// Route question to Architect instead of asking user
				console.log(
					`[AskFollowupQuestion] Sentinel agent "${currentMode}" has a question, routing to Architect`,
				)

				task.consecutiveMistakeCount = 0
				const architectAnswer = await this.askArchitect(question, task)

				// Return Architect's answer as if it was user input
				pushToolResult(
					formatResponse.toolResult(`<architect_response>\n${architectAnswer}\n</architect_response>`),
				)
				return
			}

			// If Architect is asking a question, use AI self-reflection to answer
			// This keeps the workflow automated and provides intelligent responses
			if (isArchitectMode && isSentinel) {
				console.log(
					`[AskFollowupQuestion] Architect "${currentMode}" has a question, using AI self-reflection to answer`,
				)

				// Use Architect AI to self-reflect and answer its own question
				const aiAnswer = await this.architectSelfReflect(question, Array.isArray(follow_up) ? follow_up : [], task)
				console.log(`[AskFollowupQuestion] Architect AI answer: "${aiAnswer.substring(0, 100)}..."`)

				// Show the AI answer in chat for transparency
				await task.say(
					"text",
					`💬 **${currentMode} 問：**\n> ${question}\n\n🤖 **Architect AI 回覆：**\n${aiAnswer}`,
					undefined,
					false,
					undefined,
					undefined,
					{ agentName: "Architect" },
				)

				task.consecutiveMistakeCount = 0
				pushToolResult(
					formatResponse.toolResult(`<architect_self_answer>\n${aiAnswer}\n</architect_self_answer>`),
				)
				return
			}

			// Normal flow: ask the user
			// Ensure follow_up is an array (may be undefined or other types from LLM)
			const suggestions = Array.isArray(follow_up) ? follow_up : []

			// Transform follow_up suggestions to the format expected by task.ask
			const follow_up_json = {
				question,
				suggest: suggestions.map((s) => ({ answer: s.text, mode: s.mode })),
			}

			task.consecutiveMistakeCount = 0
			const { text, images } = await task.ask("followup", JSON.stringify(follow_up_json), false)
			await task.say("user_feedback", text ?? "", images)
			pushToolResult(formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images))
		} catch (error) {
			await handleError("asking question", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"ask_followup_question">): Promise<void> {
		// Only handle actual partial updates (streaming in progress)
		// When block.partial is false, the execute() method will handle the complete message
		if (!block.partial) {
			return
		}

		const question: string | undefined = block.nativeArgs?.question ?? block.params.question

		// Check if this is a Sentinel agent that should route to Architect
		// If so, don't show the partial question to user - it will be handled by Architect
		// Priority: FSM state > task mode
		const fsmAgent = task.sentinelStateMachine?.getCurrentAgent()
		const taskMode = await task.getTaskMode()
		const currentMode = fsmAgent || taskMode

		// Check if we're in a Sentinel workflow
		const fsmIsActive = task.sentinelStateMachine?.isActive() ?? false
		const isSentinel = fsmIsActive || isSentinelAgent(currentMode)

		// Route to Architect if we're in Sentinel workflow but not Architect itself
		const isArchitectMode = currentMode === "sentinel-architect" ||
			currentMode === "sentinel-architect-review" ||
			currentMode === "sentinel-architect-review-tests" ||
			currentMode === "sentinel-architect-final"
		const shouldRouteToArchitect = isSentinel && !isArchitectMode

		if (shouldRouteToArchitect) {
			// Don't show partial to user - Architect will handle this
			console.log(`[AskFollowupQuestion] Partial: Skipping user display, will route to Architect (fsmAgent=${fsmAgent}, taskMode=${taskMode})`)
			return
		}

		// If Architect is asking, also skip user display - will be auto-answered
		if (isArchitectMode && isSentinel) {
			console.log(`[AskFollowupQuestion] Partial: Skipping user display, will be auto-answered (currentMode=${currentMode})`)
			return
		}

		// During partial streaming, only show the question to avoid displaying raw JSON
		// The full JSON with suggestions will be sent when the tool call is complete (!block.partial)
		await task.ask("followup", question ?? "", true).catch(() => {})
	}
}

export const askFollowupQuestionTool = new AskFollowupQuestionTool()
