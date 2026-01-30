/**
 * SpecWorkflowPanelManager - Editor Panel for Spec Mode Workflow
 *
 * Opens a webview panel in the editor area to display:
 * - Spec workflow progress (Requirements → Design → Tasks)
 * - Task list with start buttons
 * - Run all tasks action
 */

import * as vscode from "vscode"
import * as path from "path"
import type { ClineProvider } from "./ClineProvider"
import { getNonce } from "./getNonce"
import { webviewMessageHandler } from "./webviewMessageHandler"

interface SpecTask {
	id: string
	title: string
	status: "pending" | "in-progress" | "done"
	complexity?: string
}

export class SpecWorkflowPanelManager {
	private static instances: WeakMap<ClineProvider, SpecWorkflowPanelManager> = new WeakMap()
	private static fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map()
	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []
	private isReady: boolean = false

	private constructor(private readonly provider: ClineProvider) {}

	public static getInstance(provider: ClineProvider): SpecWorkflowPanelManager {
		let instance = SpecWorkflowPanelManager.instances.get(provider)
		if (!instance) {
			instance = new SpecWorkflowPanelManager(provider)
			SpecWorkflowPanelManager.instances.set(provider, instance)
			// Set up file watcher for this instance
			instance.setupFileWatcher()
		}
		return instance
	}

	/**
	 * Initialize file watcher for a ClineProvider.
	 * This should be called during extension activation to enable auto-open.
	 */
	public static initializeFileWatcher(provider: ClineProvider): void {
		try {
			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (!workspacePath) return

			// Check if we already have a watcher for this workspace
			if (SpecWorkflowPanelManager.fileWatchers.has(workspacePath)) {
				console.log(`[SpecWorkflowPanel] File watcher already exists for ${workspacePath}`)
				return
			}

			const specsPattern = new vscode.RelativePattern(workspacePath, ".specs/*.md")
			const watcher = vscode.workspace.createFileSystemWatcher(specsPattern)

			console.log(`[SpecWorkflowPanel] Setting up file watcher for ${workspacePath}`)

			// When a spec file is created, auto-open the panel AND update chat sidebar
			watcher.onDidCreate(async (uri) => {
				try {
					console.log(`[SpecWorkflowPanel] Spec file created: ${uri.fsPath}`)
					// Get or create instance and show the panel
					const instance = SpecWorkflowPanelManager.getInstance(provider)
					await instance.show()
					// Also refresh status to update chat sidebar immediately
					await instance.refreshWorkflowStatus()
				} catch (error) {
					console.error(`[SpecWorkflowPanel] Error handling file create:`, error)
				}
			})

			// When a spec file is changed, refresh the panel and chat sidebar
			watcher.onDidChange(async () => {
				try {
					console.log(`[SpecWorkflowPanel] Spec file changed, refreshing status`)
					const instance = SpecWorkflowPanelManager.instances.get(provider)
					if (instance) {
						await instance.refreshWorkflowStatus()
					} else {
						// Just broadcast status without creating a new instance
						await SpecWorkflowPanelManager.broadcastSpecsStatus(provider)
					}
				} catch (error) {
					console.error(`[SpecWorkflowPanel] Error handling file change:`, error)
				}
			})

			// When a spec file is deleted, also update status
			watcher.onDidDelete(async () => {
				try {
					console.log(`[SpecWorkflowPanel] Spec file deleted, refreshing status`)
					const instance = SpecWorkflowPanelManager.instances.get(provider)
					if (instance) {
						await instance.refreshWorkflowStatus()
					} else {
						// Even without instance, send status update to chat sidebar
						await SpecWorkflowPanelManager.broadcastSpecsStatus(provider)
					}
				} catch (error) {
					console.error(`[SpecWorkflowPanel] Error handling file delete:`, error)
				}
			})

			SpecWorkflowPanelManager.fileWatchers.set(workspacePath, watcher)
			console.log(`[SpecWorkflowPanel] File watcher initialized for ${workspacePath}`)
			
			// Send initial status to chat sidebar (delayed to ensure webview is ready)
			setTimeout(() => {
				SpecWorkflowPanelManager.broadcastSpecsStatus(provider).catch(err => {
					console.error(`[SpecWorkflowPanel] Error broadcasting initial status:`, err)
				})
			}, 1000)
		} catch (error) {
			console.error(`[SpecWorkflowPanel] Error initializing file watcher:`, error)
		}
	}

	/**
	 * Broadcast specs status to chat sidebar without requiring a panel instance
	 */
	private static async broadcastSpecsStatus(provider: ClineProvider): Promise<void> {
		try {
			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
			if (!workspacePath) return

			const fs = require("fs")
			const specsDir = path.join(workspacePath, ".specs")

			const status = {
				requirements: fs.existsSync(path.join(specsDir, "requirements.md")),
				design: fs.existsSync(path.join(specsDir, "design.md")),
				tasks: fs.existsSync(path.join(specsDir, "tasks.md")),
			}

			// Use try-catch since postMessageToWebview may fail if webview is not ready
			await provider.postMessageToWebview({
				type: "specsStatus",
				values: status,
			})
		} catch (error) {
			// Silently ignore errors when webview is not ready
			console.log(`[SpecWorkflowPanel] Could not broadcast specs status (webview may not be ready)`)
		}
	}

	/**
	 * Sets up a file watcher for the .specs directory to auto-open the panel
	 * when spec files are created (instance method - now delegates to static)
	 */
	private setupFileWatcher(): void {
		// Delegate to static method
		SpecWorkflowPanelManager.initializeFileWatcher(this.provider)
	}

	public async show(): Promise<void> {
		await this.createOrShowPanel()
		await this.refreshWorkflowStatus()
	}

	private async createOrShowPanel(): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One)
			return
		}

		const extensionUri = this.provider.context.extensionUri

		this.panel = vscode.window.createWebviewPanel(
			"roo.specWorkflow",
			"📋 Spec Workflow",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			}
		)

		this.panel.webview.html = this.getHtmlContent()

		this.panel.webview.onDidReceiveMessage(
			async (message: any) => {
				try {
					if (message?.type === "webviewDidLaunch") {
						this.isReady = true
						await this.refreshWorkflowStatus()
					} else if (message?.type) {
						await webviewMessageHandler(this.provider as any, message)
					}
				} catch (err) {
					console.error("[SpecWorkflowPanel] onDidReceiveMessage error:", err)
				}
			},
			undefined,
			this.disposables
		)

		this.panel.onDidDispose(
			() => {
				this.panel = undefined
				this.dispose()
			},
			null,
			this.disposables
		)
	}

	public async refreshWorkflowStatus(): Promise<void> {
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspacePath) return

		const fs = require("fs")
		const specsDir = path.join(workspacePath, ".specs")

		const status = {
			requirements: fs.existsSync(path.join(specsDir, "requirements.md")),
			design: fs.existsSync(path.join(specsDir, "design.md")),
			tasks: fs.existsSync(path.join(specsDir, "tasks.md")),
		}

		// Parse tasks if tasks.md exists
		let tasks: SpecTask[] = []
		if (status.tasks) {
			const tasksPath = path.join(specsDir, "tasks.md")
			const content = fs.readFileSync(tasksPath, "utf-8")
			tasks = this.parseTasksFromMarkdown(content)
		}

		// Notify Editor Panel (if open)
		if (this.panel && this.isReady) {
			await this.panel.webview.postMessage({
				type: "specWorkflowUpdate",
				status,
				tasks,
			})
		}

		// Also notify the Chat Sidebar to keep it in sync
		await this.provider.postMessageToWebview({
			type: "specsStatus",
			values: status,
		})

		// Send task list to Chat Sidebar as well
		if (tasks.length > 0) {
			await this.provider.postMessageToWebview({
				type: "specTasksList",
				tasks: tasks.map(t => ({
					id: t.id,
					title: t.title,
					status: t.status,
					complexity: t.complexity,
				})),
			})
		}
	}

	private parseTasksFromMarkdown(content: string): SpecTask[] {
		const tasks: SpecTask[] = []
		const lines = content.split("\n")
		let taskCounter = 0

		for (const line of lines) {
			const match = line.match(/^[\s-]*\[([ x\/])\]\s*(.+)$/i)
			if (match) {
				taskCounter++
				const statusChar = match[1].toLowerCase()
				const taskText = match[2].trim()
				const complexityMatch = taskText.match(/\(complexity:\s*(low|medium|high)\)/i)

				tasks.push({
					id: `task-${taskCounter}`,
					title: taskText.replace(/\(complexity:\s*(low|medium|high)\)/i, "").trim(),
					status: statusChar === "x" ? "done" : statusChar === "/" ? "in-progress" : "pending",
					complexity: complexityMatch ? complexityMatch[1] : undefined,
				})
			}
		}

		return tasks
	}

	public isOpen(): boolean {
		return !!this.panel
	}

	public async sendMessage(message: any): Promise<void> {
		if (this.panel && this.isReady) {
			await this.panel.webview.postMessage(message)
		}
	}

	public async toggle(): Promise<void> {
		if (this.panel) {
			this.dispose()
		} else {
			await this.show()
		}
	}

	public dispose(): void {
		const panelToDispose = this.panel
		this.panel = undefined

		while (this.disposables.length) {
			const disposable = this.disposables.pop()
			if (disposable) {
				disposable.dispose()
			}
		}
		try {
			panelToDispose?.dispose()
		} catch {}
		this.isReady = false
	}

	private getHtmlContent(): string {
		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Spec Workflow</title>
	<style>
		:root {
			--vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		}
		* { box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family, sans-serif);
			padding: 0;
			margin: 0;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			height: 100vh;
			overflow: hidden;
		}
		.container {
			display: flex;
			height: 100vh;
		}
		.left-panel {
			width: 320px;
			min-width: 280px;
			border-right: 1px solid var(--vscode-panel-border);
			display: flex;
			flex-direction: column;
			background: var(--vscode-sideBar-background);
		}
		.right-panel {
			flex: 1;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		.workflow-header {
			padding: 12px 16px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.workflow-title {
			font-size: 16px;
			font-weight: 600;
			margin: 0 0 12px 0;
		}
		.workflow-steps {
			display: flex;
			gap: 6px;
			align-items: center;
			flex-wrap: wrap;
		}
		.step {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 10px;
			border-radius: 6px;
			background: var(--vscode-button-secondaryBackground);
			cursor: pointer;
			transition: all 0.15s;
			font-size: 12px;
		}
		.step:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}
		.step.completed {
			background: var(--vscode-testing-iconPassed);
			color: white;
		}
		.step.active {
			outline: 2px solid var(--vscode-focusBorder);
		}
		.step.disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		.step-number {
			width: 18px;
			height: 18px;
			border-radius: 50%;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 10px;
			font-weight: 600;
		}
		.step.completed .step-number {
			background: white;
			color: var(--vscode-testing-iconPassed);
		}
		.arrow {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}
		.actions {
			padding: 12px 16px;
			display: flex;
			gap: 8px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.btn {
			padding: 6px 12px;
			border-radius: 4px;
			border: none;
			cursor: pointer;
			font-size: 12px;
			display: flex;
			align-items: center;
			gap: 4px;
			flex: 1;
			justify-content: center;
		}
		.btn-primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.btn-primary:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.btn-secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.btn:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		.task-list {
			flex: 1;
			overflow-y: auto;
			padding: 12px 16px;
		}
		.task-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 10px;
			border-radius: 6px;
			margin-bottom: 6px;
			background: var(--vscode-list-hoverBackground);
			font-size: 12px;
		}
		.task-checkbox {
			width: 16px;
			height: 16px;
			border: 2px solid var(--vscode-checkbox-border);
			border-radius: 4px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 10px;
			flex-shrink: 0;
		}
		.task-item.done .task-checkbox {
			background: var(--vscode-testing-iconPassed);
			border-color: var(--vscode-testing-iconPassed);
			color: white;
		}
		.task-item.in-progress .task-checkbox {
			background: #f59e0b;
			border-color: #f59e0b;
			color: white;
		}
		.task-content {
			flex: 1;
			min-width: 0;
		}
		.task-title {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.task-item.done .task-title {
			text-decoration: line-through;
			opacity: 0.7;
		}
		.task-complexity {
			font-size: 10px;
			padding: 2px 6px;
			border-radius: 4px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			flex-shrink: 0;
		}
		.task-btn {
			padding: 3px 6px;
			font-size: 10px;
			border-radius: 4px;
			border: 1px solid var(--vscode-button-background);
			background: transparent;
			color: var(--vscode-button-background);
			cursor: pointer;
			opacity: 0;
			transition: opacity 0.15s;
			flex-shrink: 0;
		}
		.task-item:hover .task-btn {
			opacity: 1;
		}
		.task-btn:hover {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.empty-state {
			text-align: center;
			padding: 24px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}
		
		/* Content Viewer Styles */
		.content-header {
			padding: 12px 16px;
			border-bottom: 1px solid var(--vscode-panel-border);
			display: flex;
			align-items: center;
			justify-content: space-between;
			background: var(--vscode-editor-background);
		}
		.content-title {
			font-size: 14px;
			font-weight: 600;
			margin: 0;
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.content-title-icon {
			font-size: 16px;
		}
		.content-actions {
			display: flex;
			gap: 8px;
		}
		.content-body {
			flex: 1;
			overflow-y: auto;
			padding: 16px;
			font-size: 13px;
			line-height: 1.6;
		}
		.content-body pre {
			background: var(--vscode-textCodeBlock-background);
			padding: 12px;
			border-radius: 6px;
			overflow-x: auto;
			font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
			font-size: 12px;
		}
		.content-body h1, .content-body h2, .content-body h3 {
			margin-top: 16px;
			margin-bottom: 8px;
			border-bottom: 1px solid var(--vscode-panel-border);
			padding-bottom: 4px;
		}
		.content-body h1 { font-size: 20px; }
		.content-body h2 { font-size: 16px; }
		.content-body h3 { font-size: 14px; }
		.content-body ul, .content-body ol {
			padding-left: 24px;
		}
		.content-body li {
			margin-bottom: 4px;
		}
		.content-body code {
			background: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 4px;
			font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
			font-size: 12px;
		}
		.content-placeholder {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			height: 100%;
			color: var(--vscode-descriptionForeground);
			text-align: center;
			padding: 32px;
		}
		.content-placeholder-icon {
			font-size: 48px;
			margin-bottom: 16px;
			opacity: 0.5;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="left-panel">
			<div class="workflow-header">
				<h1 class="workflow-title">📋 Spec Workflow</h1>
				<div class="workflow-steps" id="steps"></div>
			</div>
			<div class="actions">
				<button class="btn btn-secondary" onclick="updateSpecs()">🔄 Update</button>
				<button class="btn btn-primary" id="runAllBtn" onclick="runAllTasks()" disabled>▶ Run All</button>
			</div>
			<div class="task-list" id="taskList">
				<div class="empty-state">Loading workflow status...</div>
			</div>
		</div>
		<div class="right-panel">
			<div class="content-header" id="contentHeader" style="display: none;">
				<h2 class="content-title">
					<span class="content-title-icon" id="contentIcon">📄</span>
					<span id="contentFileName">Select a file</span>
				</h2>
				<div class="content-actions">
					<button class="btn btn-secondary" onclick="openInEditor()">📝 Open in Editor</button>
				</div>
			</div>
			<div class="content-body" id="contentBody">
				<div class="content-placeholder">
					<div class="content-placeholder-icon">📁</div>
					<div>Select a workflow step to view its content</div>
					<div style="margin-top: 8px; font-size: 12px;">Click on Requirements, Design, or Tasks above</div>
				</div>
			</div>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let currentFile = null;
		let workflowStatus = {};
		let fileContents = {};
		
		// Notify ready
		vscode.postMessage({ type: 'webviewDidLaunch' });
		
		window.addEventListener('message', event => {
			const message = event.data;
			if (message.type === 'specWorkflowUpdate') {
				workflowStatus = message.status;
				renderWorkflow(message.status, message.tasks);
			} else if (message.type === 'specFileContent') {
				fileContents[message.file] = message.content;
				if (currentFile === message.file) {
					renderFileContent(message.file, message.content);
				}
			}
		});
		
		function renderWorkflow(status, tasks) {
			const stepsContainer = document.getElementById('steps');
			const taskList = document.getElementById('taskList');
			const runAllBtn = document.getElementById('runAllBtn');
			
			// Render steps
			const steps = [
				{ name: 'Requirements', key: 'requirements', file: 'requirements.md', icon: '📋' },
				{ name: 'Design', key: 'design', file: 'design.md', icon: '🎨' },
				{ name: 'Tasks', key: 'tasks', file: 'tasks.md', icon: '✅' }
			];
			
			stepsContainer.innerHTML = steps.map((step, i) => {
				const completed = status[step.key];
				const isActive = currentFile === step.file;
				let cls = 'step';
				if (completed) cls += ' completed';
				if (isActive) cls += ' active';
				if (!completed) cls += ' disabled';
				return \`
					\${i > 0 ? '<span class="arrow">→</span>' : ''}
					<div class="\${cls}" onclick="viewFile('\${step.file}', \${completed})" title="\${completed ? 'View ' + step.file : 'Not created yet'}">
						<span class="step-number">\${completed ? '✓' : i + 1}</span>
						<span>\${step.name}</span>
					</div>
				\`;
			}).join('');
			
			// Enable run all button if tasks exist
			runAllBtn.disabled = !status.tasks;
			
			// Render tasks
			if (tasks.length === 0) {
				taskList.innerHTML = '<div class="empty-state">No tasks found. Complete the workflow first.</div>';
				return;
			}
			
			taskList.innerHTML = tasks.map(task => {
				const statusIcon = task.status === 'done' ? '✓' : task.status === 'in-progress' ? '/' : '';
				return \`
					<div class="task-item \${task.status}">
						<div class="task-checkbox">\${statusIcon}</div>
						<div class="task-content">
							<div class="task-title" title="\${task.title}">\${task.title}</div>
						</div>
						\${task.complexity ? '<span class="task-complexity">' + task.complexity + '</span>' : ''}
						\${task.status === 'pending' ? '<button class="task-btn" onclick="startTask(\\'' + task.id + '\\')">▶</button>' : ''}
						\${task.status === 'in-progress' ? '<span class="task-complexity" style="background:#f59e0b">Running</span>' : ''}
					</div>
				\`;
			}).join('');
		}
		
		function viewFile(filename, exists) {
			if (!exists) return;
			currentFile = filename;
			
			// Update step highlights
			const steps = document.querySelectorAll('.step');
			steps.forEach(step => step.classList.remove('active'));
			event.target.closest('.step')?.classList.add('active');
			
			// Show header
			document.getElementById('contentHeader').style.display = 'flex';
			
			// Update title
			const icons = { 'requirements.md': '📋', 'design.md': '🎨', 'tasks.md': '✅' };
			document.getElementById('contentIcon').textContent = icons[filename] || '📄';
			document.getElementById('contentFileName').textContent = filename;
			
			// Request file content
			vscode.postMessage({ type: 'requestSpecFileContent', file: filename });
			
			// Show loading state
			document.getElementById('contentBody').innerHTML = '<div class="empty-state">Loading...</div>';
		}
		
		function renderFileContent(filename, content) {
			const body = document.getElementById('contentBody');
			// Simple markdown rendering
			let html = content
				.replace(/^### (.+)$/gm, '<h3>$1</h3>')
				.replace(/^## (.+)$/gm, '<h2>$1</h2>')
				.replace(/^# (.+)$/gm, '<h1>$1</h1>')
				.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre>$1</pre>')
				.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
				.replace(/^- \\[x\\] (.+)$/gim, '<li style="list-style:none;">✅ $1</li>')
				.replace(/^- \\[\\/\\] (.+)$/gim, '<li style="list-style:none;">🔄 $1</li>')
				.replace(/^- \\[ \\] (.+)$/gim, '<li style="list-style:none;">⬜ $1</li>')
				.replace(/^- (.+)$/gm, '<li>$1</li>')
				.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>')
				.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
				.replace(/\\*(.+?)\\*/g, '<em>$1</em>')
				.replace(/\\n\\n/g, '</p><p>')
				.replace(/\\n/g, '<br>');
			body.innerHTML = '<p>' + html + '</p>';
		}
		
		function openInEditor() {
			if (currentFile) {
				vscode.postMessage({ type: 'openSpecFile', file: currentFile });
			}
		}
		
		function openFile(filename) {
			vscode.postMessage({ type: 'openSpecFile', file: filename });
		}
		
		function startTask(taskId) {
			vscode.postMessage({ type: 'startSpecTask', taskId: taskId });
		}
		
		function runAllTasks() {
			vscode.postMessage({ type: 'runAllSpecTasks' });
		}
		
		function updateSpecs() {
			vscode.postMessage({ type: 'updateSpecs' });
		}
	</script>
</body>
</html>`
	}
}
