import path from "path"
import delay from "delay"
import fs from "fs/promises"

import { type ClineSayTool, DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath, createDirectoriesForFile } from "../../utils/fs"
import { stripLineNumbers, everyLineHasLineNumbers } from "../../integrations/misc/extract-text"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { convertNewFileToUnifiedDiff, computeDiffStats, sanitizeUnifiedDiff } from "../diff/stats"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface WriteToFileParams {
	path: string
	content: string
}

export class WriteToFileTool extends BaseTool<"write_to_file"> {
	readonly name = "write_to_file" as const

	async execute(params: WriteToFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError, askApproval } = callbacks
		const relPath = params.path
		let newContent = params.content

		if (!relPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("write_to_file")
			pushToolResult(await task.sayAndCreateMissingParamError("write_to_file", "path"))
			await task.diffViewProvider.reset()
			return
		}

		if (newContent === undefined) {
			task.consecutiveMistakeCount++
			task.recordToolError("write_to_file")
			pushToolResult(await task.sayAndCreateMissingParamError("write_to_file", "content"))
			await task.diffViewProvider.reset()
			return
		}

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

		let fileExists: boolean
		const absolutePath = path.resolve(task.cwd, relPath)

		if (task.diffViewProvider.editType !== undefined) {
			fileExists = task.diffViewProvider.editType === "modify"
		} else {
			fileExists = await fileExistsAtPath(absolutePath)
			task.diffViewProvider.editType = fileExists ? "modify" : "create"
		}

		// Create parent directories early for new files to prevent ENOENT errors
		// in subsequent operations (e.g., diffViewProvider.open, fs.readFile)
		if (!fileExists) {
			await createDirectoriesForFile(absolutePath)
		}

		if (newContent.startsWith("```")) {
			newContent = newContent.split("\n").slice(1).join("\n")
		}

		if (newContent.endsWith("```")) {
			newContent = newContent.split("\n").slice(0, -1).join("\n")
		}

		if (!task.api.getModel().id.includes("claude")) {
			newContent = unescapeHtmlEntities(newContent)
		}

		const fullPath = relPath ? path.resolve(task.cwd, relPath) : ""
		const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

		const sharedMessageProps: ClineSayTool = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(task.cwd, relPath),
			content: newContent,
			isOutsideWorkspace,
			isProtected: isWriteProtected,
		}

		try {
			task.consecutiveMistakeCount = 0

			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			const diagnosticsEnabled = state?.diagnosticsEnabled ?? true
			const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
			const isPreventFocusDisruptionEnabled = experiments.isEnabled(
				state?.experiments ?? {},
				EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
			)
		// Sentinel/Spec Mode: For .md files (like plan.md), skip diff view entirely and save silently
			const isSentinelMode = state?.mode?.startsWith("sentinel-") ?? false
			const isSpecMode = state?.mode === "spec"
			// CRITICAL: Always detect .specs files by path - this is the most reliable check!
			// Note: relPath may use forward slash OR backslash depending on OS
			const isSpecsPathFile = relPath.includes(".specs/") || relPath.includes(".specs\\") || relPath.startsWith(".specs/") || relPath.startsWith(".specs\\")
			// For .specs files, ALWAYS skip diff view - regardless of mode!
			// For other .md files in Sentinel/Spec mode, also skip diff view
			const isSentinelPlanFile = (isSpecsPathFile && relPath.endsWith(".md")) || ((isSentinelMode || isSpecMode) && relPath.endsWith(".md"))
			
			console.log(`[WriteToFileTool] Mode: ${state?.mode}, isSpecsPathFile: ${isSpecsPathFile}, isSentinelPlanFile: ${isSentinelPlanFile}, relPath: ${relPath}`)

			if (isSentinelPlanFile) {
				// Save directly without showing any diff view
				const absolutePath = path.resolve(task.cwd, relPath)
				await fs.mkdir(path.dirname(absolutePath), { recursive: true })
				await fs.writeFile(absolutePath, newContent, "utf-8")

				// Track file and mark as edited
				await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
				task.didEditFile = true

				// Push tool result
				const toolResultMessage = `✅ Created ${relPath}`
				pushToolResult(toolResultMessage)

				// Determine if this is a .specs file - use Spec Workflow Panel instead of Markdown Preview
				const isSpecsFile = relPath.includes(".specs/") || relPath.includes(".specs\\")
				
				try {
					const vscode = await import("vscode")
					
					if (isSpecsFile) {
						// Use Spec Workflow Panel for .specs/*.md files
						const { SpecWorkflowPanelManager } = await import("../webview/SpecWorkflowPanelManager")
						const provider = task.providerRef.deref()
						if (provider) {
							const panelManager = SpecWorkflowPanelManager.getInstance(provider as any)
							
							// Detect which spec file and switch to correct step
							const fileName = path.basename(relPath)
							let step: "requirements" | "design" | "tasks" | null = null
							let nextPhase: { name: string; file: string } | null = null
							
							if (fileName === "requirements.md") {
								step = "requirements"
								nextPhase = { name: "Design", file: "design.md" }
							} else if (fileName === "design.md") {
								step = "design"
								nextPhase = { name: "Tasks", file: "tasks.md" }
							} else if (fileName === "tasks.md") {
								step = "tasks"
								nextPhase = null  // No next phase after tasks
							}
							
							if (step) {
								await panelManager.showAndSwitchToStep(step)
							} else {
								await panelManager.show()
							}
							
							// Show spec file created message
							await task.say("text", `📋 **Spec file created:** \`${relPath}\` - Spec Workflow Panel is now open.`)
							
							// ========== AUTO-HANDOFF LOGIC ==========
							// After creating requirements.md or design.md, offer to continue to next phase
							if (nextPhase) {
								// Ask user if they want to continue to next phase
								const handoffMessage = `
## ✅ ${step === "requirements" ? "需求文件" : "設計文件"}已完成！

\`${relPath}\` 已成功建立。

**您想要繼續進行下一階段嗎？**

下一階段：**${nextPhase.name}** (建立 \`.specs/${nextPhase.file}\`)

請選擇：
- 按「繼續」自動進入下一階段
- 按「結束」完成此任務
`
								// Use askResponse to get user confirmation
								const { response, text: userFeedback } = await task.ask(
									"followup",
									JSON.stringify({
										question: handoffMessage,
										suggest: nextPhase ? ["繼續下一階段", "結束"] : undefined,
									}),
									false,
								)
								
								if (response === "yesButtonClicked" || 
									(userFeedback && (userFeedback.includes("繼續") || userFeedback.toLowerCase().includes("continue") || userFeedback.toLowerCase().includes("yes")))) {
									// User wants to continue to next phase
									const nextStepPrompt = step === "requirements" 
										? `# 🎨 繼續 Spec 工作流程 - 設計階段

請進入 **Design 設計階段**：

1. **閱讀** \`.specs/requirements.md\` 了解需求
2. **建立** \`.specs/design.md\` 包含：
   - 系統架構設計 (附 Mermaid 圖)
   - 資料模型/資料庫設計
   - API 設計 (如適用)
   - UI/UX 規劃 (如適用)
   - 技術選型決策

請開始設計！`
										: `# ✅ 繼續 Spec 工作流程 - 任務分解階段

請進入 **Tasks 任務分解階段**：

1. **閱讀** \`.specs/requirements.md\` 和 \`.specs/design.md\`
2. **建立** \`.specs/tasks.md\` 包含：
   - 細分的執行任務清單
   - 每個任務的驗收標準
   - 相關檔案路徑
   - 任務優先順序和依賴關係

請開始分解任務！`
									
									// Continue the conversation with next phase prompt
									await task.say("text", `🔄 **進入下一階段**: ${nextPhase.name}`)
									
									// Inject the next phase prompt into the conversation
									// This will be picked up by the agent to continue
									await task.say("user_feedback", nextStepPrompt)
									
									console.log(`[WriteToFileTool] Auto-handoff triggered: ${step} → ${nextPhase.name}`)
								} else {
									// User chose to end
									await task.say("text", `✅ **${step === "requirements" ? "需求" : "設計"}階段完成！** 任務已結束。您可以稍後從 Spec Workflow Panel 繼續。`)
									console.log(`[WriteToFileTool] User chose to end after ${step}`)
								}
							}
						}
					} else {
						// For non-specs .md files, use Markdown preview
						// Ensure Kroki extension is installed
						const krokiExtId = "pomdtr.markdown-kroki"
						const krokiExt = vscode.extensions.getExtension(krokiExtId)
						if (!krokiExt) {
							await task.say("text", `📦 Installing Kroki extension for diagram support...`)
							await vscode.commands.executeCommand("workbench.extensions.installExtension", krokiExtId)
							await delay(2000)
							await task.say("text", `✅ Kroki extension installed!`)
						}

						await delay(500)
						const fileUri = vscode.Uri.file(absolutePath)
						await vscode.commands.executeCommand("markdown.showPreview", fileUri)

						// Close source tabs
						for (const group of vscode.window.tabGroups.all) {
							for (const tab of group.tabs) {
								if (tab.input && (tab.input as any).uri?.fsPath === absolutePath) {
									const isPreview = tab.label.startsWith("Preview ")
									if (!isPreview) {
										await vscode.window.tabGroups.close(tab)
									}
								}
							}
						}

						await task.say("text", `📝 **Plan created:** \`${relPath}\` - Preview is now open.`)
					}
				} catch (previewError) {
					console.log("[WriteToFileTool] Failed to open preview:", previewError)
				}

				task.processQueuedMessages()
				return  // Early return - skip all diffViewProvider logic
			}

			if (isPreventFocusDisruptionEnabled) {
				task.diffViewProvider.editType = fileExists ? "modify" : "create"
				if (fileExists) {
					const absolutePath = path.resolve(task.cwd, relPath)
					task.diffViewProvider.originalContent = await fs.readFile(absolutePath, "utf-8")
				} else {
					task.diffViewProvider.originalContent = ""
				}

				let unified = fileExists
					? formatResponse.createPrettyPatch(relPath, task.diffViewProvider.originalContent, newContent)
					: convertNewFileToUnifiedDiff(newContent, relPath)
				unified = sanitizeUnifiedDiff(unified)
				const completeMessage = JSON.stringify({
					...sharedMessageProps,
					content: unified,
					diffStats: computeDiffStats(unified) || undefined,
				} satisfies ClineSayTool)

				const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

				if (!didApprove) {
					return
				}

				await task.diffViewProvider.saveDirectly(relPath, newContent, false, diagnosticsEnabled, writeDelayMs)
			} else {
				if (!task.diffViewProvider.isEditing) {
					const partialMessage = JSON.stringify(sharedMessageProps)
					await task.ask("tool", partialMessage, true).catch(() => {})
					await task.diffViewProvider.open(relPath)
				}

				await task.diffViewProvider.update(
					everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
					true,
				)

				await delay(300)
				task.diffViewProvider.scrollToFirstDiff()

				let unified = fileExists
					? formatResponse.createPrettyPatch(relPath, task.diffViewProvider.originalContent, newContent)
					: convertNewFileToUnifiedDiff(newContent, relPath)
				unified = sanitizeUnifiedDiff(unified)
				const completeMessage = JSON.stringify({
					...sharedMessageProps,
					content: unified,
					diffStats: computeDiffStats(unified) || undefined,
				} satisfies ClineSayTool)

				const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

				if (!didApprove) {
					await task.diffViewProvider.revertChanges()
					return
				}

				await task.diffViewProvider.saveChanges(diagnosticsEnabled, writeDelayMs)
			}

			if (relPath) {
				await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
			}

			task.didEditFile = true

			const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, !fileExists)

			pushToolResult(message)

			await task.diffViewProvider.reset()
			this.resetPartialState()

			// Auto-open markdown preview for .md files in Sentinel/Spec mode
			if (relPath.endsWith(".md")) {
				const isSentinelMode = state?.mode?.startsWith("sentinel-") ?? false
				const isSpecMode = state?.mode === "spec"
				if (isSentinelMode || isSpecMode) {
					const isSpecsFile = relPath.includes(".specs/") || relPath.includes(".specs\\")
					
					try {
						// Import vscode dynamically to avoid circular dependencies
						const vscode = await import("vscode")
						const absolutePath = path.resolve(task.cwd, relPath)
						
						if (isSpecsFile) {
							// Use Spec Workflow Panel for .specs/*.md files
							const { SpecWorkflowPanelManager } = await import("../webview/SpecWorkflowPanelManager")
							const provider = task.providerRef.deref()
							if (provider) {
								const panelManager = SpecWorkflowPanelManager.getInstance(provider as any)
								
								// Detect which spec file and switch to correct step
								const fileName = path.basename(relPath)
								let step: "requirements" | "design" | "tasks" | null = null
								if (fileName === "requirements.md") step = "requirements"
								else if (fileName === "design.md") step = "design"
								else if (fileName === "tasks.md") step = "tasks"
								
								if (step) {
									await panelManager.showAndSwitchToStep(step)
								} else {
									await panelManager.show()
								}
								await task.say("text", `📋 **Spec file updated:** \`${relPath}\` - Spec Workflow Panel is now open.`)
							}
						} else {
							// For non-specs .md files, use Markdown preview
							// Ensure Kroki extension is installed for proper diagram rendering
							const krokiExtId = "pomdtr.markdown-kroki"
							const krokiExt = vscode.extensions.getExtension(krokiExtId)
							if (!krokiExt) {
								await task.say("text", `📦 Installing Kroki extension for diagram support...`)
								await vscode.commands.executeCommand("workbench.extensions.installExtension", krokiExtId)
								// Wait for extension to be ready
								await delay(2000)
								await task.say("text", `✅ Kroki extension installed! Diagrams will render correctly.`)
							}

							// Wait for file system to sync before opening
							await delay(500)

							// Open preview directly without showing source code
							const fileUri = vscode.Uri.file(absolutePath)
							// Use markdown.showPreview to open only preview (not the source)
							await vscode.commands.executeCommand("markdown.showPreview", fileUri)

							// Close any source code tabs for this file that may have opened
							for (const group of vscode.window.tabGroups.all) {
								for (const tab of group.tabs) {
									if (tab.input && (tab.input as any).uri?.fsPath === absolutePath) {
										// Don't close preview tabs, only source tabs
										const isPreview = tab.label.startsWith("Preview ")
										if (!isPreview) {
											await vscode.window.tabGroups.close(tab)
										}
									}
								}
							}

							await task.say("text", `📝 **Plan created:** \`${relPath}\` - Preview is now open.`)
						}
					} catch (previewError) {
						// Silently fail - preview is a nice-to-have, not critical
						console.log("[WriteToFileTool] Failed to open preview:", previewError)
					}
				}
			}

			task.processQueuedMessages()

			return
		} catch (error) {
			await handleError("writing file", error as Error)
			await task.diffViewProvider.reset()
			this.resetPartialState()
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"write_to_file">): Promise<void> {
		const relPath: string | undefined = block.params.path
		let newContent: string | undefined = block.params.content

		// Wait for path to stabilize before showing UI (prevents truncated paths)
		if (!this.hasPathStabilized(relPath) || newContent === undefined) {
			return
		}

		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		const isPreventFocusDisruptionEnabled = experiments.isEnabled(
			state?.experiments ?? {},
			EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
		)

		if (isPreventFocusDisruptionEnabled) {
			return
		}

		// Skip streaming/diff view for .md files in Sentinel mode (they open in preview instead)
		const isSentinelMode = state?.mode?.startsWith("sentinel-") ?? false
		const isSpecMode = state?.mode === "spec"
		
		// CRITICAL: Also skip for .specs/ files - they should NEVER open in diff editor
		const isSpecsPathFile = relPath?.includes(".specs/") || relPath?.includes(".specs\\") || relPath?.startsWith(".specs/") || relPath?.startsWith(".specs\\")
		
		if ((isSentinelMode || isSpecMode || isSpecsPathFile) && relPath?.endsWith(".md")) {
			console.log(`[WriteToFileTool.handlePartial] Skipping diff view for spec file: ${relPath}, isSpecsPathFile: ${isSpecsPathFile}`)
			return
		}

		// relPath is guaranteed non-null after hasPathStabilized
		let fileExists: boolean
		const absolutePath = path.resolve(task.cwd, relPath!)

		if (task.diffViewProvider.editType !== undefined) {
			fileExists = task.diffViewProvider.editType === "modify"
		} else {
			fileExists = await fileExistsAtPath(absolutePath)
			task.diffViewProvider.editType = fileExists ? "modify" : "create"
		}

		// Create parent directories early for new files to prevent ENOENT errors
		// in subsequent operations (e.g., diffViewProvider.open)
		if (!fileExists) {
			await createDirectoriesForFile(absolutePath)
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath!) || false
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(task.cwd, relPath!),
			content: newContent || "",
			isOutsideWorkspace,
			isProtected: isWriteProtected,
		}

		const partialMessage = JSON.stringify(sharedMessageProps)
		await task.ask("tool", partialMessage, block.partial).catch(() => {})

		if (newContent) {
			if (!task.diffViewProvider.isEditing) {
				await task.diffViewProvider.open(relPath!)
			}

			await task.diffViewProvider.update(
				everyLineHasLineNumbers(newContent) ? stripLineNumbers(newContent) : newContent,
				false,
			)
		}
	}
}

export const writeToFileTool = new WriteToFileTool()
