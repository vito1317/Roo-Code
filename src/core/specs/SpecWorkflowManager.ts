/**
 * SpecWorkflowManager - Centralized manager for Spec Mode workflow
 * 
 * Responsibilities:
 * - Handle spec file creation events
 * - Manage phase transitions (requirements → design → tasks)
 * - Auto-handoff when minimum line requirements are met
 * - Orchestrate task execution handoff
 * - Provide phase-specific prompts
 */

import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { Task } from "../task/Task"
import { SPEC_MIN_LINES } from "./SpecModeContextProvider"

export type SpecPhase = "requirements" | "design" | "tasks"
export type SpecFileType = "requirements.md" | "design.md" | "tasks.md"

interface PhaseInfo {
	name: string
	file: SpecFileType
	nextPhase: SpecPhase | null
	minLines: number
}

const PHASE_CONFIG: Record<SpecPhase, PhaseInfo> = {
	requirements: { name: "需求", file: "requirements.md", nextPhase: "design", minLines: SPEC_MIN_LINES.requirements },
	design: { name: "設計", file: "design.md", nextPhase: "tasks", minLines: SPEC_MIN_LINES.design },
	tasks: { name: "任務", file: "tasks.md", nextPhase: null, minLines: SPEC_MIN_LINES.tasks },
}

export class SpecWorkflowManager {
	/**
	 * Handle when a spec file is created
	 * Checks if minimum line requirements are met and auto-handoffs to next phase
	 */
	static async handleSpecFileCreated(
		task: Task,
		relPath: string,
		fileName: string
	): Promise<void> {
		const phase = this.getPhaseFromFileName(fileName)
		if (!phase) return

		const phaseInfo = PHASE_CONFIG[phase]
		
		// Check if file meets minimum line requirements
		const absolutePath = path.resolve(task.cwd, relPath)
		const lineCount = await this.countFileLines(absolutePath)
		
		console.log(`[SpecWorkflowManager] ${fileName} created with ${lineCount} lines (min: ${phaseInfo.minLines})`)

		if (lineCount < phaseInfo.minLines) {
			// File is incomplete - show warning and let AI continue
			await task.say("text", `
## ⚠️ ${phaseInfo.name}文件尚未達到最低要求！

\`${relPath}\` 目前只有 **${lineCount} 行**（需要至少 **${phaseInfo.minLines} 行**）

請繼續使用 \`<!-- APPEND -->\` 添加更多內容。
`)
			return
		}

		// File is complete - proceed with handoff
		if (phase === "requirements" || phase === "design") {
			// Auto-handoff to next phase
			await this.autoHandoffToNextPhase(task, phase, phaseInfo, relPath, lineCount)
		} else if (phase === "tasks") {
			// Tasks complete - show completion message
			await this.offerTaskExecution(task, relPath)
		}
	}

	/**
	 * Auto-handoff to next spec phase without showing modal
	 */
	private static async autoHandoffToNextPhase(
		task: Task,
		currentPhase: SpecPhase,
		phaseInfo: PhaseInfo,
		relPath: string,
		lineCount: number
	): Promise<void> {
		const nextPhase = phaseInfo.nextPhase
		if (!nextPhase) return

		const nextPhaseInfo = PHASE_CONFIG[nextPhase]

		console.log(`[SpecWorkflowManager] Phase completed: ${currentPhase} (${lineCount} lines), auto-handoff to ${nextPhase}`)

		await task.say("text", `
## ✅ ${phaseInfo.name}文件已完成！

\`${relPath}\` 已成功建立（${lineCount} 行，達到最低 ${phaseInfo.minLines} 行要求）。

🔄 **自動進入下一階段**: ${nextPhaseInfo.name} (建立 \`.specs/${nextPhaseInfo.file}\`)
`)

		// Small delay before handoff
		await new Promise(resolve => setTimeout(resolve, 500))

		// Auto-create new task for next phase
		const nextStepPrompt = this.getPhasePrompt(nextPhase)
		await this.createSpecModeTask(task, nextStepPrompt, nextPhaseInfo.name)
	}

	/**
	 * Count non-empty lines in a file
	 */
	private static async countFileLines(filePath: string): Promise<number> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			return content.split("\n").filter(line => line.trim().length > 0).length
		} catch {
			return 0
		}
	}

	/**
	 * Offer to execute individual tasks from tasks.md
	 */
	private static async offerTaskExecution(
		task: Task,
		relPath: string
	): Promise<void> {
		await task.say("text", `
## ✅ 任務分解完成！

\`${relPath}\` 已成功建立。所有 Spec 檔案現已完成：
- ✅ requirements.md - 需求文件
- ✅ design.md - 設計文件  
- ✅ tasks.md - 任務清單

**Spec 工作流程完成！**

您可以從 **Spec Workflow Panel** 的任務清單中點擊 **「Start task」** 按鈕來執行個別任務。
每個任務會建立獨立的 Architect 子任務進行實作規劃。
`)

		await task.say("text", `💡 **提示：** 點擊上方 Spec Workflow Panel 中的 Tasks 頁籤，可以看到所有任務和執行按鈕。`)
		
		console.log(`[SpecWorkflowManager] Tasks file created, user can start individual tasks from panel`)
	}

	/**
	 * Start a single task from tasks.md
	 * Called when user clicks "Start task" button in Spec Workflow Panel
	 */
	static async startIndividualTask(
		provider: any, // ClineProvider
		taskId: string,
		taskTitle: string,
		taskDescription?: string
	): Promise<void> {
		const prompt = `# 🚀 Sentinel 工作流程 (TDD) - 執行任務: ${taskId}

## 任務資訊

**任務編號:** ${taskId}
**任務標題:** ${taskTitle}
${taskDescription ? `**任務描述:** ${taskDescription}` : ""}

## 你的角色: Sentinel Architect

你是 **Sentinel 多代理工作流程** 的 Architect。你的任務是規劃，然後交給 Builder 實作。

---

## 第一步：閱讀 Spec 檔案

讀取以下檔案了解專案背景：
- \`.specs/requirements.md\` - 需求規格
- \`.specs/design.md\` - 系統設計
- \`.specs/tasks.md\` - 完整任務清單 (含測試案例)

---

## 第二步：分析任務 (${taskId})

- 分析此任務的具體實作步驟
- **特別注意任務中的「測試案例」區塊**
- 確認技術選型和架構符合設計文件
- 列出需要建立或修改的檔案

---

## 第三步：建立 plan.md (TDD 模式) 並交給 Builder

在 plan.md 中明確指示 Builder 使用 **TDD 開發流程**：

1. **Red** - 先寫測試案例 (依據任務中的測試案例區塊)
2. **Green** - 執行測試確認失敗，然後實作程式碼使測試通過
3. **Refactor** - 重構程式碼，保持測試通過

建立 \`plan.md\` 後，**使用 handoff_context 工具** 將任務交給 Builder：

\`\`\`xml
<handoff_context>
<notes>任務 ${taskId} 規劃完成。請使用 TDD 模式：先寫測試，再實作。</notes>
<context_json>{
  "architectPlan": true,
  "taskId": "${taskId}",
  "taskTitle": "${taskTitle}",
  "hasUI": false,
  "tddMode": true
}</context_json>
</handoff_context>
\`\`\`

---

## ⚠️ 重要提醒

1. **使用 handoff_context** - 不要用 switch_mode 或 new_task
2. **不要直接寫程式碼** - 這是 Builder 的工作
3. **TDD 模式** - 在 plan.md 中明確指示 Builder 先寫測試
4. **完成後更新 tasks.md** - 將此任務狀態改為 \`[x]\`

開始執行！`

		try {
			// Switch to Sentinel Architect mode for multi-agent workflow
			await provider.setMode("sentinel-architect")
			
			// Create new task with the task-specific prompt
			await provider.createTask(prompt, [])
			
			// Switch UI to new chat
			await provider.postMessageToWebview({ type: "invoke", invoke: "newChat" })
			
			console.log(`[SpecWorkflowManager] Started individual task: ${taskId}`)
		} catch (error) {
			console.error(`[SpecWorkflowManager] Error starting task ${taskId}:`, error)
			vscode.window.showErrorMessage(`無法啟動任務 ${taskId}`)
		}
	}

	/**
	 * Get phase-specific prompt for creating spec files
	 */
	static getPhasePrompt(phase: SpecPhase): string {
		switch (phase) {
			case "design":
				return `# 🎨 Spec 工作流程 - Phase 2: 設計階段

你現在在 **Spec Mode** 中，負責建立 **design.md**。

## 你的任務

1. **閱讀** \`.specs/requirements.md\` 了解需求內容
2. **建立** \`.specs/design.md\` 包含：
   - 系統架構設計 (附 Mermaid 圖)
   - 資料模型/資料庫設計 (如適用)
   - API 設計 (如適用)
   - UI/UX 規劃 (如適用)
   - 技術選型決策

## ⚠️ 重要提醒
- 你必須**親自建立** design.md，不要委派給其他模式
- 使用 \`write_to_file\` 工具直接建立檔案

請開始設計！`

			case "tasks":
				return `# ✅ Spec 工作流程 - Phase 3: 任務分解階段

你現在在 **Spec Mode** 中，負責建立 **tasks.md**。

## 你的任務

1. **閱讀** \`.specs/requirements.md\` 和 \`.specs/design.md\`
2. **建立** \`.specs/tasks.md\` 包含：
   - 細分的執行任務清單（使用 TASK-XXX 格式）
   - 每個任務的驗收標準
   - 相關檔案路徑
   - 任務複雜度 (low/medium/high)
   - 任務依賴關係

## 任務格式範例
\`\`\`markdown
### TASK-001: 任務標題 (complexity: medium)

**描述:** 任務描述

**涉及檔案:**
- src/example.ts

**驗收標準:**
- [ ] 標準 1
- [ ] 標準 2

**依賴:** 無
\`\`\`

## ⚠️ 重要提醒
- 你必須**親自建立** tasks.md，不要委派給其他模式
- 使用 \`write_to_file\` 工具直接建立檔案

請開始分解任務！`

			default:
				return ""
		}
	}

	/**
	 * Create a new task in Spec mode
	 */
	private static async createSpecModeTask(
		task: Task,
		prompt: string,
		phaseName: string
	): Promise<void> {
		await task.say("text", `🔄 **建立新任務進入下一階段**: ${phaseName}`)

		const provider = task.providerRef.deref()
		if (provider) {
			await provider.setMode("spec")
			await provider.createTask(prompt, [])
			await provider.postMessageToWebview({ type: "invoke", invoke: "newChat" })
			console.log(`[SpecWorkflowManager] Chain handoff: Created new Spec task for ${phaseName}`)
		}
	}

	/**
	 * Get phase from file name
	 */
	private static getPhaseFromFileName(fileName: string): SpecPhase | null {
		switch (fileName) {
			case "requirements.md":
				return "requirements"
			case "design.md":
				return "design"
			case "tasks.md":
				return "tasks"
			default:
				return null
		}
	}
}
