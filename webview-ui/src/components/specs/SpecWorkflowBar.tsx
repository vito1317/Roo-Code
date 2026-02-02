/**
 * SpecWorkflowBar - Spec Workflow UI Component
 *
 * Displays the spec workflow progress bar with tabs for:
 * Requirements → Design → Tasks
 */

import React, { useCallback, useEffect, useState } from "react"
import { vscode } from "../../utils/vscode"

interface SpecFile {
	name: string
	label: string
	step: number
	exists: boolean
	content?: string
}

interface SpecWorkflowBarProps {
	projectName?: string
	onRunAllTasks?: () => void
	onUpdateSpecs?: () => void
}

export const SpecWorkflowBar: React.FC<SpecWorkflowBarProps> = ({
	projectName = "Project",
	onRunAllTasks,
	onUpdateSpecs,
}) => {
	const [specFiles, setSpecFiles] = useState<SpecFile[]>([
		{ name: "requirements.md", label: "Requirements", step: 1, exists: false },
		{ name: "design.md", label: "Design", step: 2, exists: false },
		{ name: "tasks.md", label: "Tasks", step: 3, exists: false },
	])
	const [activeStep, setActiveStep] = useState(0)

	// Check if .specs directory exists
	useEffect(() => {
		// Request spec files status from extension
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "specsStatus") {
				const { requirements, design, tasks } = message.values
				setSpecFiles([
					{ name: "requirements.md", label: "Requirements", step: 1, exists: requirements },
					{ name: "design.md", label: "Design", step: 2, exists: design },
					{ name: "tasks.md", label: "Tasks", step: 3, exists: tasks },
				])
				// Set active step based on which files exist
				if (tasks) setActiveStep(3)
				else if (design) setActiveStep(2)
				else if (requirements) setActiveStep(1)
			}
		}

		window.addEventListener("message", handleMessage)

		// Request initial status
		vscode.postMessage({ type: "requestSpecsStatus" })

		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleTabClick = useCallback((file: SpecFile) => {
		if (file.exists) {
			vscode.postMessage({
				type: "openSpecFile",
				file: file.name,
			})
		}
	}, [])

	const handleRunAllTasks = useCallback(() => {
		if (onRunAllTasks) {
			onRunAllTasks()
		} else {
			vscode.postMessage({
				type: "runAllSpecTasks",
			})
		}
	}, [onRunAllTasks])

	const handleUpdate = useCallback(() => {
		if (onUpdateSpecs) {
			onUpdateSpecs()
		} else {
			vscode.postMessage({
				type: "updateSpecs",
			})
		}
	}, [onUpdateSpecs])

	return (
		<div className="spec-workflow-bar">
			<style>{`
				.spec-workflow-bar {
					display: flex;
					align-items: center;
					gap: 8px;
					padding: 8px 12px;
					background: var(--vscode-editor-background);
					border-bottom: 1px solid var(--vscode-panel-border);
					overflow: hidden;
					min-width: 0;
				}

				.spec-workflow-project {
					font-weight: 600;
					font-size: 13px;
					color: var(--vscode-foreground);
					margin-right: 8px;
					white-space: nowrap;
					flex-shrink: 0;
				}

				.spec-workflow-tabs {
					display: flex;
					align-items: center;
					gap: 4px;
					flex-shrink: 1;
					min-width: 0;
					overflow: hidden;
				}

				.spec-workflow-tab {
					display: flex;
					align-items: center;
					gap: 4px;
					padding: 4px 8px;
					border-radius: 4px;
					font-size: 12px;
					cursor: pointer;
					background: transparent;
					border: none;
					color: var(--vscode-foreground);
					opacity: 0.6;
					transition: all 0.15s ease;
					white-space: nowrap;
					flex-shrink: 0;
				}

				.spec-workflow-tab:hover {
					background: var(--vscode-toolbar-hoverBackground);
					opacity: 1;
				}

				.spec-workflow-tab.active {
					background: var(--vscode-button-secondaryBackground);
					opacity: 1;
				}

				.spec-workflow-tab.completed {
					opacity: 1;
				}

				.spec-workflow-tab.disabled {
					opacity: 0.4;
					cursor: not-allowed;
				}

				.spec-workflow-step {
					display: inline-flex;
					align-items: center;
					justify-content: center;
					width: 18px;
					height: 18px;
					border-radius: 50%;
					font-size: 11px;
					font-weight: 600;
					background: var(--vscode-badge-background);
					color: var(--vscode-badge-foreground);
					flex-shrink: 0;
				}

				.spec-workflow-tab.completed .spec-workflow-step {
					background: var(--vscode-testing-iconPassed);
					color: white;
				}

				.spec-workflow-arrow {
					color: var(--vscode-foreground);
					opacity: 0.4;
					font-size: 12px;
					flex-shrink: 0;
				}

				.spec-workflow-actions {
					display: flex;
					align-items: center;
					gap: 6px;
					margin-left: auto;
					flex-shrink: 0;
				}

				.spec-workflow-btn {
					display: flex;
					align-items: center;
					gap: 4px;
					padding: 4px 8px;
					font-size: 12px;
					border-radius: 4px;
					border: none;
					cursor: pointer;
					transition: all 0.15s ease;
					white-space: nowrap;
				}

				.spec-workflow-btn-update {
					background: var(--vscode-button-secondaryBackground);
					color: var(--vscode-button-secondaryForeground);
				}

				.spec-workflow-btn-update:hover {
					background: var(--vscode-button-secondaryHoverBackground);
				}

				.spec-workflow-btn-run {
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
				}

				.spec-workflow-btn-run:hover {
					background: var(--vscode-button-hoverBackground);
				}

				.spec-workflow-btn-icon {
					font-size: 14px;
				}
				
				/* Hide button text on very narrow screens, show only icons */
				@media (max-width: 400px) {
					.spec-workflow-btn span:not(.spec-workflow-btn-icon) {
						display: none;
					}
					.spec-workflow-tab span:not(.spec-workflow-step) {
						display: none;
					}
				}
			`}</style>

			<span className="spec-workflow-project">📁 {projectName}</span>

			<div className="spec-workflow-tabs">
				{specFiles.map((file, index) => (
					<React.Fragment key={file.name}>
						{index > 0 && <span className="spec-workflow-arrow">›</span>}
						<button
							className={`spec-workflow-tab ${
								file.exists ? "completed" : "disabled"
							} ${activeStep === file.step ? "active" : ""}`}
							onClick={() => handleTabClick(file)}
							disabled={!file.exists}
							title={file.exists ? `Open ${file.name}` : `${file.name} not created yet`}
						>
							<span className="spec-workflow-step">{file.step}</span>
							<span>{file.label}</span>
						</button>
					</React.Fragment>
				))}
			</div>

			<div className="spec-workflow-actions">
				<button
					className="spec-workflow-btn spec-workflow-btn-update"
					onClick={handleUpdate}
					title="Update specifications"
				>
					<span className="spec-workflow-btn-icon">🔄</span>
					<span>Update</span>
				</button>

				<button
					className="spec-workflow-btn spec-workflow-btn-run"
					onClick={handleRunAllTasks}
					title="Run all tasks from tasks.md"
					disabled={!specFiles[2].exists}
				>
					<span className="spec-workflow-btn-icon">▶</span>
					<span>Run all tasks</span>
				</button>
			</div>
		</div>
	)
}

export default SpecWorkflowBar
