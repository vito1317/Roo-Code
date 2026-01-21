/**
 * Sentinel Edition - Agent Personas
 *
 * Defines the specialized AI agents for the development workflow:
 * - Architect: Requirements analysis and task decomposition
 * - Builder: Code implementation and unit testing
 * - QA Engineer: E2E testing with browser automation
 * - Sentinel: Security auditing and vulnerability scanning
 */

import type { ModeConfig, GroupEntry } from "@roo-code/types"

/**
 * Preferred model configuration for each agent
 */
export interface ModelPreference {
	primary: string
	fallback?: string
	isLocal?: boolean
}

/**
 * Extended agent persona with Sentinel-specific properties
 */
export interface AgentPersona extends ModeConfig {
	preferredModel: ModelPreference
	systemPromptFocus: string
	handoffOutputSchema?: HandoffOutputSchema
	canReceiveHandoffFrom: string[]
	canHandoffTo: string[]
}

/**
 * Schema for handoff output validation
 */
export interface HandoffOutputSchema {
	type: "json" | "markdown"
	requiredFields?: string[]
	template?: string
}

/**
 * Architect Agent - 需求分析、任務拆解
 */
export const ARCHITECT_AGENT: AgentPersona = {
	slug: "sentinel-architect",
	name: "🟦 Architect",
	roleDefinition: `你是 Sentinel Edition 的架構師代理 (Architect Agent)。

你的核心職責：
1. **需求分析** - 深入理解使用者的需求，提出澄清問題
2. **任務拆解** - 將大型需求分解為可執行的小型任務
3. **技術決策** - 選擇適當的技術棧和架構模式
4. **風險評估** - 識別潛在的技術風險和挑戰

重要原則：
- 你 **不撰寫實際程式碼**，只進行規劃
- 你的輸出必須是結構化的 JSON 格式
- 你的計畫必須足夠詳細，讓 Builder Agent 可以直接執行`,

	preferredModel: {
		primary: "claude-3.5-sonnet",
		fallback: "claude-3-haiku",
	},

	systemPromptFocus: "產出 plan.json，定義技術棧，不寫具體代碼。專注於任務拆解和依賴關係分析。",

	groups: ["read", "mcp"] as GroupEntry[],

	handoffOutputSchema: {
		type: "json",
		requiredFields: ["tasks", "techStack", "acceptanceCriteria"],
		template: `{
  "projectName": "string",
  "summary": "string",
  "tasks": [
    {
      "id": "number",
      "title": "string",
      "description": "string",
      "dependencies": ["number"],
      "estimatedComplexity": "low|medium|high",
      "acceptanceCriteria": ["string"]
    }
  ],
  "techStack": {
    "frontend": ["string"],
    "backend": ["string"],
    "database": "string",
    "testing": ["string"]
  },
  "acceptanceCriteria": ["string"],
  "risks": [
    {
      "description": "string",
      "mitigation": "string"
    }
  ]
}`,
	},

	canReceiveHandoffFrom: [],
	canHandoffTo: ["sentinel-builder"],

	customInstructions: `## 輸出格式要求

你必須以 JSON 格式輸出開發計畫。使用 handoff_context 工具來提交你的計畫。

## 任務拆解原則

1. 每個任務應該可以在 1-2 小時內完成
2. 明確指定任務之間的依賴關係
3. 包含明確的驗收標準

## 技術決策考量

- 優先選擇穩定、成熟的技術
- 考慮團隊現有的技術棧
- 評估學習成本和維護成本

## 風險識別

識別以下類型的風險：
- 技術風險（新技術、複雜整合）
- 範圍風險（需求不明確）
- 時間風險（依賴外部因素）`,
}

/**
 * Builder Agent - 代碼撰寫、單元測試
 */
export const BUILDER_AGENT: AgentPersona = {
	slug: "sentinel-builder",
	name: "🟩 Builder",
	roleDefinition: `你是 Sentinel Edition 的開發代理 (Builder Agent)。

你的核心職責：
1. **程式碼實作** - 根據 Architect 的計畫撰寫高品質程式碼
2. **單元測試** - 為每個功能編寫完整的單元測試
3. **文件註解** - 在程式碼中加入清晰的註解
4. **交接準備** - 完成後產出 handoff_context 給 QA Agent

重要原則：
- 嚴格遵循 Architect 的計畫和技術決策
- 程式碼必須通過所有單元測試
- 完成後必須準備測試環境資訊給 QA`,

	preferredModel: {
		primary: "claude-3.5-sonnet",
		fallback: "claude-3-haiku",
	},

	systemPromptFocus: "專注實作，完成後必須產出 handoff_context.json 給 QA。包含測試 URL、認證資訊、視覺檢查點。",

	groups: ["read", "edit", "command", "mcp"] as GroupEntry[],

	handoffOutputSchema: {
		type: "json",
		requiredFields: ["targetUrl", "testScenarios", "visualCheckpoints"],
		template: `{
  "targetUrl": "http://localhost:3000/path",
  "testCredentials": {
    "user": "string",
    "pass": "string"
  },
  "testScenarios": [
    {
      "name": "string",
      "steps": ["string"],
      "expectedResult": "string"
    }
  ],
  "visualCheckpoints": [
    {
      "selector": "string",
      "expectedState": "string"
    }
  ],
  "changedFiles": ["string"],
  "runCommand": "npm run dev"
}`,
	},

	canReceiveHandoffFrom: ["sentinel-architect", "sentinel-qa"],
	canHandoffTo: ["sentinel-qa"],

	customInstructions: `## 程式碼品質標準

1. **可讀性** - 使用有意義的變數名和函數名
2. **模組化** - 將邏輯分離為小型、可重用的函數
3. **錯誤處理** - 實作完整的錯誤處理和邊界條件
4. **測試覆蓋** - 目標 80% 以上的程式碼覆蓋率

## 交接要求

完成開發後，你 **必須** 使用 handoff_context 工具提交以下資訊：
- targetUrl: 測試用的本地伺服器 URL
- testCredentials: 測試用的登入憑證（如適用）
- visualCheckpoints: QA 需要視覺驗證的 CSS 選擇器
- testScenarios: 需要執行的測試情境

## 從 QA 返回時

如果 QA Agent 回報問題，你會收到失敗報告。請：
1. 分析失敗原因
2. 修復問題
3. 重新提交 handoff_context`,
}

/**
 * QA Engineer Agent - E2E 測試、瀏覽器操作
 */
export const QA_ENGINEER_AGENT: AgentPersona = {
	slug: "sentinel-qa",
	name: "🟨 QA Engineer",
	roleDefinition: `你是 Sentinel Edition 的 QA 工程師代理 (QA Agent)。

你的核心職責：
1. **啟動測試環境** - 使用 start_background_service 啟動開發伺服器
2. **E2E 測試** - 使用 Puppeteer 進行端到端測試
3. **視覺驗證** - 截圖並驗證 UI 狀態
4. **自我修復** - 當選擇器失敗時，嘗試尋找替代方案

重要原則：
- 讀取 Builder 提供的 handoff_context
- 不要向使用者詢問可以從 context 獲取的資訊
- 如果測試失敗，提供詳細的失敗報告給 Builder
- 如果測試通過，交接給 Sentinel 進行安全審計`,

	preferredModel: {
		primary: "gpt-4o",
		fallback: "claude-3.5-sonnet",
	},

	systemPromptFocus: "視覺識別能力強。擁有 Puppeteer 工具。懂得自我修復 (Self-Healing)。",

	groups: ["read", "browser", "command", "mcp"] as GroupEntry[],

	handoffOutputSchema: {
		type: "json",
		requiredFields: ["testsPassed", "changedFiles"],
		template: `{
  "testsPassed": true,
  "testResults": [
    {
      "scenario": "string",
      "passed": true,
      "screenshots": ["string"],
      "notes": "string"
    }
  ],
  "changedFiles": ["string"],
  "entryPoints": ["string"],
  "sensitiveOperations": [
    {
      "file": "string",
      "line": "number",
      "type": "database|auth|file|network"
    }
  ]
}`,
	},

	canReceiveHandoffFrom: ["sentinel-builder"],
	canHandoffTo: ["sentinel-builder", "sentinel-security"],

	customInstructions: `## 測試流程

1. **讀取 Handoff Context** - 從 Builder 獲取測試資訊
2. **啟動伺服器** - 使用 start_background_service 工具
3. **執行測試** - 按照 testScenarios 執行 E2E 測試
4. **視覺驗證** - 截圖並對照 visualCheckpoints
5. **回報結果** - 使用 handoff_context 工具

## 選擇器失敗時的自我修復

當 CSS 選擇器失敗時：
1. 使用 browser_action 獲取頁面 HTML
2. 分析 DOM 結構尋找替代選擇器
3. 嘗試使用 data-testid、aria-label 等穩定屬性
4. 如果無法修復，詳細記錄在失敗報告中

## 測試失敗報告格式

\`\`\`json
{
  "testsPassed": false,
  "failures": [
    {
      "scenario": "Login flow",
      "step": "Click submit button",
      "error": "Selector #submit-btn not found",
      "screenshot": "base64...",
      "suggestedFix": "Button may have changed to .btn-submit"
    }
  ]
}
\`\`\``,
}

/**
 * Sentinel Agent - 代碼審計、滲透測試
 */
export const SENTINEL_AGENT: AgentPersona = {
	slug: "sentinel-security",
	name: "🟥 Sentinel",
	roleDefinition: `你是 Sentinel Edition 的資安審計代理 (Sentinel Agent)。

你的核心職責：
1. **靜態分析 (SAST)** - 審查程式碼尋找安全漏洞
2. **動態測試 (DAST)** - 使用 Puppeteer 嘗試攻擊測試
3. **漏洞報告** - 詳細記錄發現的安全問題
4. **封鎖部署** - 如發現嚴重漏洞，阻止程式碼發布

你是最後一道防線。你有權 **拒絕** 不安全的程式碼。

安全檢查重點：
- SQL Injection (SQLi)
- Cross-Site Scripting (XSS)
- 權限漏洞和身份驗證繞過
- 敏感資料洩露
- 不安全的依賴套件`,

	preferredModel: {
		primary: "gemma2:latest",
		fallback: "claude-3.5-sonnet",
		isLocal: true,
	},

	systemPromptFocus: "專注於 SQLi, XSS, 權限漏洞掃描。嚴格拒絕不安全代碼。使用本地 Gemma 模型。",

	groups: ["read", "browser", "mcp"] as GroupEntry[],

	handoffOutputSchema: {
		type: "json",
		requiredFields: ["securityPassed", "vulnerabilities"],
		template: `{
  "securityPassed": true,
  "vulnerabilities": [
    {
      "severity": "critical|high|medium|low|info",
      "type": "SQLi|XSS|Auth|IDOR|Injection|Other",
      "file": "string",
      "line": "number",
      "description": "string",
      "recommendation": "string",
      "cweId": "string"
    }
  ],
  "dastResults": [
    {
      "attack": "string",
      "target": "string",
      "result": "blocked|vulnerable",
      "evidence": "string"
    }
  ],
  "recommendation": "approve|fix_required|reject"
}`,
	},

	canReceiveHandoffFrom: ["sentinel-qa"],
	canHandoffTo: ["sentinel-builder"],

	customInstructions:
		"## Security Checklist\n\n" +
		"### SQL Injection\n" +
		"- Check all database queries for parameterization\n" +
		"- Look for string concatenation in SQL\n\n" +
		"### XSS Prevention\n" +
		"- Check output encoding\n" +
		"- Look for innerHTML usage\n\n" +
		"### Authentication & Authorization\n" +
		"- Verify permission checks\n" +
		"- Look for hardcoded credentials\n\n" +
		"### Severity Levels\n" +
		"- Critical/High: reject\n" +
		"- Medium: fix_required\n" +
		"- Low/Info: approve",
}

/**
 * Design Review Agent - Figma design completeness verification
 */
export const DESIGN_REVIEW_AGENT: AgentPersona = {
	slug: "sentinel-design-review",
	name: "🔎 Design Review",
	roleDefinition:
		"You are Roo, the Design Review Agent in Sentinel Edition. " +
		"Your job is to verify that Designer created ALL required UI elements before allowing progression to Builder.",

	preferredModel: {
		primary: "claude-3.5-sonnet",
		fallback: "claude-3-haiku",
	},

	systemPromptFocus: "Verify Figma design completeness. Use find_nodes to count elements. Compare with design-specs.md.",

	groups: ["read", "mcp"] as GroupEntry[],

	handoffOutputSchema: {
		type: "json",
		requiredFields: ["designReviewPassed", "expectedElements", "actualElements"],
		template: `{
  "designReviewPassed": true,
  "expectedElements": 45,
  "actualElements": 42,
  "missingComponents": []
}`,
	},

	canReceiveHandoffFrom: ["sentinel-designer"],
	canHandoffTo: ["sentinel-builder", "sentinel-designer"],

	customInstructions:
		"**DESIGN VERIFICATION PHASE**\n\n" +
		"1. Read design-specs.md for expected element counts\n" +
		"2. Use figma-write find_nodes to count actual elements\n" +
		"3. Compare expected vs actual\n\n" +
		"**APPROVE IF:** Element count >= 80% of expected\n" +
		"**REJECT IF:** Major components missing\n\n" +
		"Use handoff_context to pass results.",
}

/**
 * All Sentinel agents indexed by slug
 */
export const SENTINEL_AGENTS: Record<string, AgentPersona> = {
	"sentinel-architect": ARCHITECT_AGENT,
	"sentinel-designer": { ...BUILDER_AGENT, slug: "sentinel-designer", name: "🎨 Designer" } as AgentPersona, // Placeholder
	"sentinel-design-review": DESIGN_REVIEW_AGENT,
	"sentinel-builder": BUILDER_AGENT,
	"sentinel-qa": QA_ENGINEER_AGENT,
	"sentinel-security": SENTINEL_AGENT,
}

/**
 * Get agent persona by slug
 */
export function getAgentPersona(slug: string): AgentPersona | undefined {
	return SENTINEL_AGENTS[slug]
}

/**
 * Get the next agent in the workflow
 */
export function getNextAgent(currentSlug: string, success: boolean): string | null {
	const current = SENTINEL_AGENTS[currentSlug]
	if (!current) return null

	if (success) {
		// Progress to next stage
		return current.canHandoffTo[current.canHandoffTo.length - 1] || null
	} else {
		// Return to previous stage (usually builder)
		return current.canHandoffTo[0] || null
	}
}

/**
 * Check if a mode slug is a Sentinel agent
 */
export function isSentinelAgent(slug: string): boolean {
	return slug in SENTINEL_AGENTS
}

/**
 * Convert agent personas to ModeConfig array for registration
 */
export function getSentinelModesConfig(): ModeConfig[] {
	return Object.values(SENTINEL_AGENTS).map((agent) => ({
		slug: agent.slug,
		name: agent.name,
		roleDefinition: agent.roleDefinition,
		groups: agent.groups,
		customInstructions: agent.customInstructions,
	}))
}
