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
	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []
	private isReady: boolean = false

	private constructor(private readonly provider: ClineProvider) {}

	public static getInstance(provider: ClineProvider): SpecWorkflowPanelManager {
		let instance = SpecWorkflowPanelManager.instances.get(provider)
		if (!instance) {
			instance = new SpecWorkflowPanelManager(provider)
			SpecWorkflowPanelManager.instances.set(provider, instance)
		}
		return instance
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
		body {
			font-family: var(--vscode-font-family, sans-serif);
			padding: 16px;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		.workflow-header {
			display: flex;
			align-items: center;
			gap: 12px;
			padding-bottom: 16px;
			border-bottom: 1px solid var(--vscode-panel-border);
			margin-bottom: 16px;
		}
		.workflow-title {
			font-size: 18px;
			font-weight: 600;
			margin: 0;
		}
		.workflow-steps {
			display: flex;
			gap: 8px;
			align-items: center;
			flex-wrap: wrap;
		}
		.step {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 12px;
			border-radius: 6px;
			background: var(--vscode-button-secondaryBackground);
			cursor: pointer;
			transition: all 0.15s;
		}
		.step:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}
		.step.completed {
			background: var(--vscode-testing-iconPassed);
			color: white;
		}
		.step.disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		.step-number {
			width: 20px;
			height: 20px;
			border-radius: 50%;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 11px;
			font-weight: 600;
		}
		.step.completed .step-number {
			background: white;
			color: var(--vscode-testing-iconPassed);
		}
		.arrow {
			color: var(--vscode-descriptionForeground);
		}
		.actions {
			margin-left: auto;
			display: flex;
			gap: 8px;
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
			margin-top: 16px;
		}
		.task-item {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 10px 12px;
			border-radius: 6px;
			margin-bottom: 8px;
			background: var(--vscode-list-hoverBackground);
		}
		.task-checkbox {
			width: 18px;
			height: 18px;
			border: 2px solid var(--vscode-checkbox-border);
			border-radius: 4px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 12px;
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
		}
		.task-title {
			font-size: 13px;
		}
		.task-item.done .task-title {
			text-decoration: line-through;
			opacity: 0.7;
		}
		.task-complexity {
			font-size: 11px;
			padding: 2px 6px;
			border-radius: 4px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		}
		.task-btn {
			padding: 4px 8px;
			font-size: 11px;
			border-radius: 4px;
			border: 1px solid var(--vscode-button-background);
			background: transparent;
			color: var(--vscode-button-background);
			cursor: pointer;
			opacity: 0;
			transition: opacity 0.15s;
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
			padding: 32px;
			color: var(--vscode-descriptionForeground);
		}
	</style>
</head>
<body>
	<div class="workflow-header">
		<h1 class="workflow-title">📋 Spec Workflow</h1>
		<div class="workflow-steps" id="steps"></div>
		<div class="actions">
			<button class="btn btn-secondary" onclick="updateSpecs()">🔄 Update</button>
			<button class="btn btn-primary" id="runAllBtn" onclick="runAllTasks()" disabled>▶ Run All Tasks</button>
		</div>
	</div>
	
	<div class="task-list" id="taskList">
		<div class="empty-state">Loading workflow status...</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		
		// Notify ready
		vscode.postMessage({ type: 'webviewDidLaunch' });
		
		window.addEventListener('message', event => {
			const message = event.data;
			if (message.type === 'specWorkflowUpdate') {
				renderWorkflow(message.status, message.tasks);
			}
		});
		
		function renderWorkflow(status, tasks) {
			const stepsContainer = document.getElementById('steps');
			const taskList = document.getElementById('taskList');
			const runAllBtn = document.getElementById('runAllBtn');
			
			// Render steps
			const steps = [
				{ name: 'Requirements', key: 'requirements', file: 'requirements.md' },
				{ name: 'Design', key: 'design', file: 'design.md' },
				{ name: 'Tasks', key: 'tasks', file: 'tasks.md' }
			];
			
			stepsContainer.innerHTML = steps.map((step, i) => {
				const completed = status[step.key];
				const cls = completed ? 'step completed' : 'step disabled';
				return \`
					\${i > 0 ? '<span class="arrow">→</span>' : ''}
					<div class="\${cls}" onclick="openFile('\${step.file}')" title="\${completed ? 'Open ' + step.file : 'Not created yet'}">
						<span class="step-number">\${completed ? '✓' : i + 1}</span>
						<span>\${step.name}</span>
					</div>
				\`;
			}).join('');
			
			// Enable run all button if tasks exist
			runAllBtn.disabled = !status.tasks;
			
			// Render tasks
			if (tasks.length === 0) {
				taskList.innerHTML = '<div class="empty-state">No tasks found. Complete Requirements → Design → Tasks workflow first.</div>';
				return;
			}
			
			taskList.innerHTML = tasks.map(task => {
				const statusIcon = task.status === 'done' ? '✓' : task.status === 'in-progress' ? '/' : '';
				return \`
					<div class="task-item \${task.status}">
						<div class="task-checkbox">\${statusIcon}</div>
						<div class="task-content">
							<div class="task-title">\${task.title}</div>
						</div>
						\${task.complexity ? '<span class="task-complexity">' + task.complexity + '</span>' : ''}
						\${task.status === 'pending' ? '<button class="task-btn" onclick="startTask(\\'' + task.id + '\\')">▶ Start</button>' : ''}
						\${task.status === 'in-progress' ? '<span class="task-complexity" style="background:#f59e0b">In Progress</span>' : ''}
					</div>
				\`;
			}).join('');
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
