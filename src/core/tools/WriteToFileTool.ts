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

		// GATE: Block non-Spec-Mode agents from writing to .specs/*.md files
		const fileName = path.basename(relPath)
		const isSpecsPath = relPath.includes(".specs/") || relPath.includes(".specs\\")
		const isSpecFile = isSpecsPath && relPath.endsWith(".md")
		
		// Only allow .specs/*.md files to be written in Spec Mode
		if (isSpecFile) {
			const provider = task.providerRef.deref()
			const currentState = await provider?.getState()
			const isSpecMode = currentState?.mode === "spec"
			
			if (!isSpecMode) {
				console.log(`[WriteToFileTool] BLOCKED: Attempting to write .specs file outside Spec Mode (current mode: ${currentState?.mode || 'unknown'})`)
				task.consecutiveMistakeCount++
				pushToolResult(
					`🚫 **BLOCKED: Cannot write to .specs/ folder!**\n\n` +
					`您目前不在 Spec Mode。只有 Spec Mode 才能創建 .specs/*.md 文件。\n\n` +
					`如果您需要創建需求文件，請先切換到 Spec Mode。\n\n` +
					`當前模式: ${currentState?.mode || 'unknown'}`
				)
				return
			}
		}

		// GATE: Block design.md creation if requirements.md is incomplete
		
		if (fileName === "design.md" && isSpecsPath) {
			// Check if requirements.md exists and has sufficient coverage
			const requirementsPath = path.resolve(task.cwd, relPath.replace("design.md", "requirements.md"))
			try {
				const requirementsContent = await fs.readFile(requirementsPath, "utf-8")
				const requirementsLines = requirementsContent.split("\n").length
				
				// Get user mentioned files to check coverage
				const metadata = await task.fileContextTracker.getTaskMetadata(task.taskId)
				const allFilesInContext = metadata.files_in_context || []
				const mentionedFiles = allFilesInContext.filter(
					(entry) => entry.record_source === "file_mentioned"
				)
				
				if (mentionedFiles.length > 0) {
					let totalUserLines = 0
					for (const file of mentionedFiles) {
						try {
							const filePath = path.resolve(task.cwd, file.path)
							const fileContent = await fs.readFile(filePath, "utf-8")
							totalUserLines += fileContent.split("\n").length
						} catch (e) {
							// Skip unreadable files
						}
					}
					
					const coverageRatio = totalUserLines > 0 ? requirementsLines / totalUserLines : 1
					console.log(`[WriteToFileTool] GATE CHECK - design.md blocked? requirements has ${requirementsLines} lines, user files have ${totalUserLines} lines, coverage: ${(coverageRatio * 100).toFixed(1)}%`)
					
					if (totalUserLines > 20 && coverageRatio < 0.8) {
						// Block design.md creation - requirements not complete
						task.consecutiveMistakeCount++
						pushToolResult(
							`🚫 **BLOCKED: Cannot create design.md yet!**\n\n` +
							`requirements.md 覆蓋率只有 ${(coverageRatio * 100).toFixed(1)}%（需要至少 80%）。\n\n` +
							`**必須先完成 requirements.md！**\n\n` +
							`請立即調用 write_to_file，使用 \`<!-- APPEND -->\` 繼續寫入 .specs/requirements.md，直到覆蓋率達到 80%。\n\n` +
							`**目前狀態:** ${requirementsLines} 行 / 需要 ${Math.ceil(totalUserLines * 0.8)} 行`
						)
						console.log(`[WriteToFileTool] BLOCKED design.md creation - requirements.md incomplete!`)
						return
					}
				} else {
					// FALLBACK: No mentioned files - use absolute minimum line threshold
					const MIN_REQUIREMENTS_LINES = 100
					console.log(`[WriteToFileTool] GATE CHECK - design.md: no mentioned files, using fallback. requirements has ${requirementsLines} lines, minimum: ${MIN_REQUIREMENTS_LINES}`)
					
					if (requirementsLines < MIN_REQUIREMENTS_LINES) {
						task.consecutiveMistakeCount++
						pushToolResult(
							`🚫 **BLOCKED: Cannot create design.md yet!**\n\n` +
							`requirements.md 只有 ${requirementsLines} 行（需要至少 ${MIN_REQUIREMENTS_LINES} 行）。\n\n` +
							`**必須先完成 requirements.md！**\n\n` +
							`請立即調用 write_to_file，使用 \`<!-- APPEND -->\` 繼續寫入 .specs/requirements.md。`
						)
						console.log(`[WriteToFileTool] BLOCKED design.md creation - requirements.md below minimum lines!`)
						return
					}
				}
			} catch (e) {
				// requirements.md doesn't exist - also block
				task.consecutiveMistakeCount++
				pushToolResult(
					`🚫 **BLOCKED: Cannot create design.md yet!**\n\n` +
					`requirements.md 尚未創建或無法讀取。\n\n` +
					`**必須先創建並完成 requirements.md！**`
				)
				console.log(`[WriteToFileTool] BLOCKED design.md creation - requirements.md not found!`)
				return
			}
		}

		// GATE: Block tasks.md creation if requirements.md is incomplete OR design.md doesn't exist
		if (fileName === "tasks.md" && isSpecsPath) {
			const specsDir = path.dirname(path.resolve(task.cwd, relPath))
			const requirementsPath = path.join(specsDir, "requirements.md")
			const designPath = path.join(specsDir, "design.md")
			
			try {
				// First check: requirements.md must exist and be complete
				const requirementsContent = await fs.readFile(requirementsPath, "utf-8")
				const requirementsLines = requirementsContent.split("\n").length
				
				// Get user mentioned files to check coverage
				const metadata = await task.fileContextTracker.getTaskMetadata(task.taskId)
				const allFilesInContext = metadata.files_in_context || []
				const mentionedFiles = allFilesInContext.filter(
					(entry) => entry.record_source === "file_mentioned"
				)
				
					if (mentionedFiles.length > 0) {
					let totalUserLines = 0
					for (const file of mentionedFiles) {
						try {
							const filePath = path.resolve(task.cwd, file.path)
							const fileContent = await fs.readFile(filePath, "utf-8")
							totalUserLines += fileContent.split("\n").length
						} catch (e) {
							// Skip unreadable files
						}
					}
					
					const coverageRatio = totalUserLines > 0 ? requirementsLines / totalUserLines : 1
					console.log(`[WriteToFileTool] GATE CHECK - tasks.md: requirements has ${requirementsLines} lines, coverage: ${(coverageRatio * 100).toFixed(1)}%`)
					
					if (totalUserLines > 20 && coverageRatio < 0.8) {
						// Block tasks.md - requirements not complete
						task.consecutiveMistakeCount++
						pushToolResult(
							`🚫 **BLOCKED: Cannot create tasks.md yet!**\n\n` +
							`requirements.md 覆蓋率只有 ${(coverageRatio * 100).toFixed(1)}%（需要至少 80%）。\n\n` +
							`**必須先完成 requirements.md！**\n\n` +
							`請立即調用 write_to_file，使用 \`<!-- APPEND -->\` 繼續寫入 .specs/requirements.md，直到覆蓋率達到 80%。`
						)
						console.log(`[WriteToFileTool] BLOCKED tasks.md creation - requirements.md incomplete!`)
						return
					}
				} else {
					// FALLBACK: No mentioned files - use absolute minimum line threshold
					const MIN_REQUIREMENTS_LINES = 100
					console.log(`[WriteToFileTool] GATE CHECK - tasks.md: no mentioned files, using fallback. requirements has ${requirementsLines} lines, minimum: ${MIN_REQUIREMENTS_LINES}`)
					
					if (requirementsLines < MIN_REQUIREMENTS_LINES) {
						task.consecutiveMistakeCount++
						pushToolResult(
							`🚫 **BLOCKED: Cannot create tasks.md yet!**\n\n` +
							`requirements.md 只有 ${requirementsLines} 行（需要至少 ${MIN_REQUIREMENTS_LINES} 行）。\n\n` +
							`**必須先完成 requirements.md！**\n\n` +
							`請立即調用 write_to_file，使用 \`<!-- APPEND -->\` 繼續寫入 .specs/requirements.md。`
						)
						console.log(`[WriteToFileTool] BLOCKED tasks.md creation - requirements.md below minimum lines!`)
						return
					}
				}
				
				// Second check: design.md must exist
				try {
					await fs.access(designPath)
				} catch (e) {
					// design.md doesn't exist
					task.consecutiveMistakeCount++
					pushToolResult(
						`🚫 **BLOCKED: Cannot create tasks.md yet!**\n\n` +
						`design.md 尚未創建。\n\n` +
						`**必須按順序完成: requirements.md → design.md → tasks.md**\n\n` +
						`請先創建 .specs/design.md 文件。`
					)
					console.log(`[WriteToFileTool] BLOCKED tasks.md creation - design.md not found!`)
					return
				}
			} catch (e) {
				// requirements.md doesn't exist
				task.consecutiveMistakeCount++
				pushToolResult(
					`🚫 **BLOCKED: Cannot create tasks.md yet!**\n\n` +
					`requirements.md 尚未創建或無法讀取。\n\n` +
					`**必須按順序完成: requirements.md → design.md → tasks.md**\n\n` +
					`請先創建並完成 .specs/requirements.md 文件。`
				)
				console.log(`[WriteToFileTool] BLOCKED tasks.md creation - requirements.md not found!`)
				return
			}
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
				// Note: No length validation - AI can write incrementally using append mode
				
				// Spec Mode: Support APPEND mode for incremental writing
				// If content starts with <!-- APPEND -->, append to existing file
				const APPEND_MARKER = "<!-- APPEND -->"
				const isAppendMode = newContent.startsWith(APPEND_MARKER)
				let contentToWrite = newContent
				let isAppending = false
				
				// Resolve absolute path early for append logic
				const absolutePath = path.resolve(task.cwd, relPath)
				
				if (isAppendMode) {
					// Remove the marker from content
					contentToWrite = newContent.slice(APPEND_MARKER.length).trimStart()
					
					// Check if file exists and append
					try {
						const existingContent = await fs.readFile(absolutePath, "utf-8")
						contentToWrite = existingContent + "\n\n" + contentToWrite
						isAppending = true
						console.log(`[WriteToFileTool] Appending to ${relPath} (existing: ${existingContent.split("\n").length} lines, adding: ${contentToWrite.split("\n").length - existingContent.split("\n").length} lines)`)
					} catch (e) {
						// File doesn't exist, will create new
						console.log(`[WriteToFileTool] Creating new file ${relPath} (append mode but file didn't exist)`)
					}
				}
				
				// GATE: Detect and block lazy placeholder content in spec files
				const lazyPatterns = [
					/下一步[：:].*(Spec Mode|design\.md|tasks\.md|繼續|撰寫)/i,
					/已達成要求.*coverage/i,
					/\*\*下一步[：:]?\*\*/,
					/> \*?\*?下一步/,
				]
				
				const contentForLazyCheck = contentToWrite.slice(-2000) // Check last 2000 chars
				const foundLazyPattern = lazyPatterns.find(pattern => pattern.test(contentForLazyCheck))
				
				if (foundLazyPattern && isSpecsPathFile) {
					console.log(`[WriteToFileTool] BLOCKED: Detected lazy placeholder content matching pattern: ${foundLazyPattern}`)
					task.consecutiveMistakeCount++
					pushToolResult(
						`🚫 **BLOCKED: 偷懶內容被檢測到！**\n\n` +
						`您的內容包含偷懶短語（如「下一步：依 Spec Mode 指示」或「已達成要求」）。\n\n` +
						`**這些內容不應該出現在 requirements.md 中！**\n\n` +
						`請移除這些偷懶短語，並用實際的需求內容替換。繼續用 \`<!-- APPEND -->\` 添加真正的內容。`
					)
					return
				}
				
				// Save directly without showing any diff view
				await fs.mkdir(path.dirname(absolutePath), { recursive: true })
				await fs.writeFile(absolutePath, contentToWrite, "utf-8")

				// Track file and mark as edited
				await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
				task.didEditFile = true

				// For requirements.md in Spec Mode: Check section coverage and remind AI to continue
				const fileName = path.basename(relPath)
				let shouldForceAppend = false
				let appendForceMessage = ""
				let userFileTotalLines = 0
				
				console.log(`[WriteToFileTool] COVERAGE CHECK - fileName: "${fileName}", isSpecsPathFile: ${isSpecsPathFile}, relPath: "${relPath}"`)
				
				if (fileName === "requirements.md" && isSpecsPathFile) {
					console.log(`[WriteToFileTool] ✓ Matched requirements.md in .specs path, running coverage check...`)
					try {
						// Get user @mentioned files
						const metadata = await task.fileContextTracker.getTaskMetadata(task.taskId)
						const allFilesInContext = metadata.files_in_context || []
						const mentionedFiles = allFilesInContext.filter(
							(entry) => entry.record_source === "file_mentioned"
						)
						
						console.log(`[WriteToFileTool] Total files in context: ${allFilesInContext.length}, @mentioned files: ${mentionedFiles.length}`)
						if (allFilesInContext.length > 0) {
							console.log(`[WriteToFileTool] Files in context sources: ${allFilesInContext.map(f => `${f.path}(${f.record_source})`).join(", ")}`)
						}
						
						if (mentionedFiles.length > 0) {
							// Helper to count non-empty lines only (exclude blank/whitespace lines)
							const countNonEmptyLines = (content: string): number => 
								content.split("\n").filter(line => line.trim().length > 0).length
							
							// Calculate total NON-EMPTY lines in user files
							let totalUserLines = 0
							let userFileNames: string[] = []
							for (const file of mentionedFiles) {
								try {
									const filePath = path.resolve(task.cwd, file.path)
									const fileContent = await fs.readFile(filePath, "utf-8")
									const lines = countNonEmptyLines(fileContent)
									totalUserLines += lines
									userFileNames.push(`${path.basename(file.path)} (${lines} lines)`)
								} catch (e) {
									// Skip unreadable files
									console.log(`[WriteToFileTool] Could not read file: ${file.path}`)
								}
							}
							
							const writtenLines = countNonEmptyLines(contentToWrite)
							const coverageRatio = totalUserLines > 0 ? writtenLines / totalUserLines : 1
							
							console.log(`[WriteToFileTool] User files: ${totalUserLines} NON-EMPTY lines, Written: ${writtenLines} NON-EMPTY lines, Coverage: ${(coverageRatio * 100).toFixed(1)}%`)
							
							// If written content is less than 80% of user file lines, FORCE AI to continue
							// Lowered threshold to 20 lines to catch smaller files
							if (totalUserLines > 20 && coverageRatio < 0.8) {
								shouldForceAppend = true
								const targetLines = Math.ceil(totalUserLines * 0.8)
								appendForceMessage = 
									`⚠️ **INCOMPLETE: You wrote ${writtenLines} lines but user's file has ${totalUserLines} lines.**\n\n` +
									`**Coverage: ${(coverageRatio * 100).toFixed(1)}% - Need at least 80%**\n\n` +
									`**YOU MUST NOW call write_to_file AGAIN with \`<!-- APPEND -->\` prefix!**\n\n` +
									`User files: ${userFileNames.join(", ")}\n\n` +
									`**Write at least ${targetLines - writtenLines} more lines. DO NOT say "complete" yet!**`
								userFileTotalLines = totalUserLines
								console.log(`[WriteToFileTool] FORCING APPEND - coverage too low!`)
							}
						}
					} catch (e) {
						console.log(`[WriteToFileTool] Error checking line coverage: ${e}`)
					}
				}

					// Push tool result - if incomplete, push as warning/error to force AI attention
				if (shouldForceAppend) {
					// Increment mistake count to signal this is not a successful completion
					task.consecutiveMistakeCount++
					pushToolResult(
						`📝 File saved to ${relPath} (${contentToWrite.split("\n").length} lines) - **BUT NOT COMPLETE!**\n\n` +
						appendForceMessage
					)
					
					// CRITICAL: Auto-trigger a new AI turn after current turn ends
					// Using setTimeout to wait for current AI response to complete
					const writtenLineCount = contentToWrite.split("\n").length
					const continueMessage = `🚫 **CRITICAL: requirements.md 覆蓋率不足！**

**禁止事項:**
- ❌ 禁止創建 design.md
- ❌ 禁止說「需求文件已完成」
- ❌ 禁止進入下一個階段

**必須執行:**
- ✅ 立即調用 write_to_file
- ✅ 使用 \`<!-- APPEND -->\` 開頭
- ✅ 繼續處理用戶文件中尚未覆蓋的章節

**說明:** 用戶的需求文件有 ${userFileTotalLines} 行，你只輸出了 ${writtenLineCount} 行。必須繼續處理所有章節直到達到 80% 覆蓋率。

現在立即調用 write_to_file 並使用 <!-- APPEND --> 繼續寫入。`
					setTimeout(async () => {
						console.log(`[WriteToFileTool] Auto-triggering continuation for incomplete requirements.md`)
						try {
							await task.submitUserMessage(continueMessage)
						} catch (e) {
							console.error(`[WriteToFileTool] Failed to auto-trigger continuation:`, e)
						}
					}, 2000) // 2 second delay to allow current AI turn to complete
				} else {
					const toolResultMessage = isAppending 
						? `✅ Appended to ${relPath} (total: ${contentToWrite.split("\n").length} lines)`
						: `✅ Created ${relPath} (${contentToWrite.split("\n").length} lines)`
					pushToolResult(toolResultMessage)
				}

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
							
							if (fileName === "requirements.md") {
								step = "requirements"
							} else if (fileName === "design.md") {
								step = "design"
							} else if (fileName === "tasks.md") {
								step = "tasks"
							}
							
							if (step) {
								await panelManager.showAndSwitchToStep(step)
							} else {
								await panelManager.show()
							}
							
							// Show spec file created message
							await task.say("text", `📋 **Spec file created:** \`${relPath}\` - Spec Workflow Panel is now open.`)
							
							// ========== DELEGATED TO SpecWorkflowManager ==========
							// Handle phase transitions and task execution handoff
							// BUT ONLY if:
							// 1. Content is complete (not forcing append)
							// 2. We are actually in Spec Mode (not Architect or other agents)
							const specProvider = task.providerRef.deref()
							const specState = await specProvider?.getState()
							const isActuallySpecMode = specState?.mode === "spec"
							
							if (!shouldForceAppend && isActuallySpecMode) {
								try {
									console.log(`[WriteToFileTool] Calling SpecWorkflowManager.handleSpecFileCreated for ${fileName}`)
									const { SpecWorkflowManager } = await import("../specs/SpecWorkflowManager")
									await SpecWorkflowManager.handleSpecFileCreated(task, relPath, fileName)
									console.log(`[WriteToFileTool] SpecWorkflowManager.handleSpecFileCreated completed`)
								} catch (error) {
									console.error(`[WriteToFileTool] Error in SpecWorkflowManager:`, error)
								}
							} else if (!shouldForceAppend && !isActuallySpecMode) {
								console.log(`[WriteToFileTool] Skipping handleSpecFileCreated - not in Spec Mode (current mode: ${specState?.mode || 'unknown'})`)
							} else {
								console.log(`[WriteToFileTool] Skipping handleSpecFileCreated - content incomplete, waiting for append`)
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
