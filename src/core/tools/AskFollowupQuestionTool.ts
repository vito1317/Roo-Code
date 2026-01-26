import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"
import { isSentinelAgent, ARCHITECT_AGENT } from "../sentinel/personas"

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
 */
const ARCHITECT_ANSWER_SYSTEM_PROMPT = `你是 Sentinel Edition 的架構師代理 (Architect Agent)。

你的任務是回答其他 AI Agent 提出的問題。請根據你的專業知識和經驗提供清晰、有幫助的回答。

回答原則：
1. **簡潔明確** - 直接回答問題，不要冗長
2. **技術導向** - 提供具體的技術建議和解決方案
3. **實用性** - 回答應該是可執行的，讓提問的 Agent 可以直接應用
4. **專業判斷** - 如果問題有多種解決方案，提供最佳實踐建議

注意：你的回答會直接作為另一個 AI Agent 的輸入，所以請確保回答格式清晰、內容準確。`

export class AskFollowupQuestionTool extends BaseTool<"ask_followup_question"> {
	readonly name = "ask_followup_question" as const

	/**
	 * Ask the Architect agent to answer a question from another Sentinel agent
	 * Uses SSE streaming to show the response in real-time
	 */
	private async askArchitect(question: string, task: Task): Promise<string> {
		console.log(`[AskFollowupQuestion] Routing question to Architect: "${question.substring(0, 100)}..."`)

		try {
			// Create a simple message to the Architect
			const messages = [
				{
					role: "user" as const,
					content: `另一個 AI Agent 有以下問題需要你回答：

${question}

請提供你的專業建議和回答。`,
				},
			]

			// Use the task's API to create a message
			const stream = task.api.createMessage(ARCHITECT_ANSWER_SYSTEM_PROMPT, messages, {
				taskId: `architect-answer-${Date.now()}`,
			})

			// Header for the streaming message
			const header = `🟦 **Architect 回答了 Agent 的問題：**\n\n> ${question}\n\n**回答：**\n`

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
			const currentMode = await task.getTaskMode()
			const shouldRouteToArchitect = isSentinelAgent(currentMode) && currentMode !== "sentinel-architect"

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
		const question: string | undefined = block.nativeArgs?.question ?? block.params.question

		// During partial streaming, only show the question to avoid displaying raw JSON
		// The full JSON with suggestions will be sent when the tool call is complete (!block.partial)
		await task.ask("followup", question ?? "", block.partial).catch(() => {})
	}
}

export const askFollowupQuestionTool = new AskFollowupQuestionTool()
