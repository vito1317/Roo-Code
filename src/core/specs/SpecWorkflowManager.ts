/**
 * SpecWorkflowManager - Centralized manager for Spec Mode workflow
 * 
 * Responsibilities:
 * - Handle spec file creation events
 * - Manage phase transitions (requirements → design → tasks)
 * - Orchestrate task execution handoff
 * - Provide phase-specific prompts
 */

import * as vscode from "vscode"
import { Task } from "../task/Task"

export type SpecPhase = "requirements" | "design" | "tasks"
export type SpecFileType = "requirements.md" | "design.md" | "tasks.md"

interface PhaseInfo {
	name: string
	file: SpecFileType
	nextPhase: SpecPhase | null
}

const PHASE_CONFIG: Record<SpecPhase, PhaseInfo> = {
	requirements: { name: "需求", file: "requirements.md", nextPhase: "design" },
	design: { name: "設計", file: "design.md", nextPhase: "tasks" },
	tasks: { name: "任務", file: "tasks.md", nextPhase: null },
}

export class SpecWorkflowManager {
	/**
	 * Handle when a spec file is created
	 * Shows appropriate handoff UI based on which file was created
	 */
	static async handleSpecFileCreated(
		task: Task,
		relPath: string,
		fileName: string
	): Promise<void> {
		const phase = this.getPhaseFromFileName(fileName)
		if (!phase) return

		const phaseInfo = PHASE_CONFIG[phase]

		if (phase === "requirements" || phase === "design") {
			// Offer to continue to next phase
			await this.offerNextPhaseHandoff(task, phase, phaseInfo, relPath)
		} else if (phase === "tasks") {
			// Tasks complete - offer to execute individual tasks
			await this.offerTaskExecution(task, relPath)
		}
	}

	/**
	 * Offer handoff to next spec phase (requirements → design, design → tasks)
	 */
	private static async offerNextPhaseHandoff(
		task: Task,
		currentPhase: SpecPhase,
		phaseInfo: PhaseInfo,
		relPath: string
	): Promise<void> {
		const nextPhase = phaseInfo.nextPhase
		if (!nextPhase) return

		const nextPhaseInfo = PHASE_CONFIG[nextPhase]

		console.log(`[SpecWorkflowManager] Phase completed: ${currentPhase}, offering handoff to ${nextPhase}`)

		await task.say("text", `
## ✅ ${phaseInfo.name}文件已完成！

\`${relPath}\` 已成功建立。

下一階段：**${nextPhaseInfo.name}** (建立 \`.specs/${nextPhaseInfo.file}\`)
`)

		// Small delay to ensure UI is ready
		await new Promise(resolve => setTimeout(resolve, 300))

		console.log(`[SpecWorkflowManager] Showing modal for handoff...`)
		
		// Use showInformationMessage with modal: true for more reliable button handling
		const continueBtn = `繼續 ${nextPhaseInfo.name} 階段`
		const endBtn = "結束此任務"
		
		const selection = await vscode.window.showInformationMessage(
			`${phaseInfo.name}文件已完成！是否繼續進行 ${nextPhaseInfo.name} 階段？`,
			{ modal: true },
			continueBtn,
			endBtn
		)

		console.log(`[SpecWorkflowManager] Modal selection: ${selection}`)

		if (selection === continueBtn) {
			const nextStepPrompt = this.getPhasePrompt(nextPhase)
			await this.createSpecModeTask(task, nextStepPrompt, nextPhaseInfo.name)
		} else {
			await task.say("text", `✅ **${phaseInfo.name}階段完成！** 任務已結束。您可以稍後從 Spec Workflow Panel 繼續。`)
			console.log(`[SpecWorkflowManager] User chose to end after ${currentPhase}`)
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
		const prompt = `# 🚀 執行任務: ${taskId}

## 任務資訊

**任務編號:** ${taskId}
**任務標題:** ${taskTitle}
${taskDescription ? `**任務描述:** ${taskDescription}` : ""}

## 你的任務

作為 **Architect**，請：

1. **閱讀 Spec 檔案** 了解專案背景
   - \`.specs/requirements.md\` - 需求規格
   - \`.specs/design.md\` - 系統設計
   - \`.specs/tasks.md\` - 完整任務清單

2. **聚焦於此任務 (${taskId})**
   - 分析此任務的具體實作步驟
   - 確認技術選型和架構符合設計文件
   - 列出需要建立或修改的檔案

3. **建立實作計畫**
   - 提供詳細的實作步驟
   - 說明潛在風險和注意事項
   - 完成後更新 tasks.md 中此任務的狀態為 \`[x]\`

請開始分析並規劃 ${taskId}！`

		try {
			// Switch to Architect mode (custom mode, not built-in)
			await provider.setMode("architect")
			
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
