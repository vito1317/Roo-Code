import type OpenAI from "openai"

const ASK_FOLLOWUP_QUESTION_DESCRIPTION = `Ask a question to gather information. Can target specific agents for inter-agent communication!

⚠️ IMPORTANT: Questions and follow_up options should MATCH YOUR PERSONA'S ATTITUDE!

## 🎯 target_agent 參數（預設問 Architect）
你可以指定問題要問誰（預設是 Architect）：
- **"architect"** 或省略 → 問 Architect（計畫/架構問題）【預設】
- **"designer"** → 問 Designer（設計/UI 問題）
- **"builder"** → 問 Builder（實作/程式碼問題）
- **"qa"** → 問 QA（測試問題）
- **"design-review"** → 問 Design Review（設計審查問題）
- **"user"** → 直接問使用者（需要用戶確認時用）

## 💬 角色態度
- Builder 問 Designer：「靠，這按鈕位置到底在哪？設計稿上根本看不清楚！」
- QA 問 Builder：「這功能你測過嗎？空值輸入直接 crash 欸」
- Designer 問 Architect：「這需求到底要多少個畫面？規格寫太少了」
- Design Review 問 Designer：「這顏色對比度有到 WCAG 標準嗎？」

## 📝 範例

### Builder 直接嗆 Designer
{ "question": "靠北，這設計稿上的 icon 是什麼？完全沒標示名稱！", "target_agent": "designer", "follow_up": [{ "text": "是 home icon", "mode": null }, { "text": "是 settings icon", "mode": null }, { "text": "你自己選一個", "mode": null }] }

### QA 質問 Builder
{ "question": "這測試怎麼跑？你的 README 根本沒寫 test command！", "target_agent": "builder", "follow_up": [{ "text": "用 npm test", "mode": null }, { "text": "用 pnpm test", "mode": null }, { "text": "我現在補寫", "mode": null }] }

### 問使用者（不指定 target_agent）
{ "question": "要用哪個資料庫？", "follow_up": [{ "text": "PostgreSQL", "mode": null }, { "text": "MySQL", "mode": null }] }`

const QUESTION_PARAMETER_DESCRIPTION = `帶有你的角色個性的問題！不要客氣，不確定就嗆！`

const TARGET_AGENT_DESCRIPTION = `要問哪個 Agent？可選：architect（預設）、designer、builder、qa、design-review、user。省略時預設問 Architect。跨 Agent 提問時態度可以更嗆！`

const FOLLOW_UP_PARAMETER_DESCRIPTION = `2-4 個建議回答，文字要有態度、有個性！`

const FOLLOW_UP_TEXT_DESCRIPTION = `建議的回答選項，帶點態度更好`

const FOLLOW_UP_MODE_DESCRIPTION = `如果選此選項要切換的模式（可選）`

export default {
	type: "function",
	function: {
		name: "ask_followup_question",
		description: ASK_FOLLOWUP_QUESTION_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description: QUESTION_PARAMETER_DESCRIPTION,
				},
				target_agent: {
					type: ["string", "null"],
					description: TARGET_AGENT_DESCRIPTION,
					enum: ["architect", "designer", "builder", "qa", "design-review", "user"],
					default: "architect",
				},
				follow_up: {
					type: "array",
					description: FOLLOW_UP_PARAMETER_DESCRIPTION,
					items: {
						type: "object",
						properties: {
							text: {
								type: "string",
								description: FOLLOW_UP_TEXT_DESCRIPTION,
							},
							mode: {
								type: ["string", "null"],
								description: FOLLOW_UP_MODE_DESCRIPTION,
							},
						},
						required: ["text", "mode"],
						additionalProperties: false,
					},
					minItems: 1,
					maxItems: 4,
				},
			},
			required: ["question", "follow_up"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

