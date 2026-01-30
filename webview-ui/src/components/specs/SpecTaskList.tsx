/**
 * SpecTaskList - Task List with Start Task Buttons
 *
 * Displays tasks from tasks.md with:
 * - Checkbox status ([x], [/], [ ])
 * - Task title and description
 * - "Start task" button for each pending task
 */

import React, { useCallback, useEffect, useState } from "react"
import { vscode } from "../../utils/vscode"

interface TaskItem {
	id: string
	title: string
	description?: string
	status: "pending" | "in-progress" | "done"
	complexity?: string
	dependencies?: string[]
}

interface SpecTaskListProps {
	tasks?: TaskItem[]
	onStartTask?: (taskId: string) => void
}

export const SpecTaskList: React.FC<SpecTaskListProps> = ({ tasks: propTasks, onStartTask }) => {
	const [tasks, setTasks] = useState<TaskItem[]>(propTasks || [])
	const [isLoading, setIsLoading] = useState(!propTasks)

	useEffect(() => {
		if (propTasks) {
			setTasks(propTasks)
			return
		}

		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "specTasksList") {
				setTasks(message.tasks || [])
				setIsLoading(false)
			}
		}

		window.addEventListener("message", handleMessage)
		vscode.postMessage({ type: "requestSpecTasks" })

		return () => window.removeEventListener("message", handleMessage)
	}, [propTasks])

	const handleStartTask = useCallback(
		(taskId: string) => {
			if (onStartTask) {
				onStartTask(taskId)
			} else {
				vscode.postMessage({
					type: "startSpecTask",
					taskId,
				})
			}
		},
		[onStartTask]
	)

	const getStatusIcon = (status: TaskItem["status"]) => {
		switch (status) {
			case "done":
				return "✓"
			case "in-progress":
				return "/"
			default:
				return " "
		}
	}

	const getStatusClass = (status: TaskItem["status"]) => {
		switch (status) {
			case "done":
				return "task-done"
			case "in-progress":
				return "task-in-progress"
			default:
				return "task-pending"
		}
	}

	if (isLoading) {
		return <div className="spec-task-list-loading">Loading tasks...</div>
	}

	if (tasks.length === 0) {
		return (
			<div className="spec-task-list-empty">
				<p>No tasks found in tasks.md</p>
				<button
					className="spec-task-create-btn"
					onClick={() => vscode.postMessage({ type: "createSpecsFromPrompt" })}
				>
					Create Specs
				</button>
			</div>
		)
	}

	return (
		<div className="spec-task-list">
			<style>{`
				.spec-task-list {
					padding: 8px 0;
				}

				.spec-task-list-loading,
				.spec-task-list-empty {
					padding: 16px;
					text-align: center;
					color: var(--vscode-descriptionForeground);
				}

				.spec-task-create-btn {
					margin-top: 8px;
					padding: 6px 12px;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					border-radius: 4px;
					cursor: pointer;
				}

				.spec-task-create-btn:hover {
					background: var(--vscode-button-hoverBackground);
				}

				.spec-task-item {
					display: flex;
					align-items: flex-start;
					gap: 8px;
					padding: 8px 12px;
					border-radius: 4px;
					margin: 4px 8px;
					background: var(--vscode-editor-background);
					transition: background 0.15s ease;
				}

				.spec-task-item:hover {
					background: var(--vscode-list-hoverBackground);
				}

				.spec-task-checkbox {
					display: flex;
					align-items: center;
					justify-content: center;
					width: 18px;
					height: 18px;
					border: 1px solid var(--vscode-checkbox-border);
					border-radius: 3px;
					font-size: 12px;
					font-weight: bold;
					flex-shrink: 0;
					margin-top: 2px;
				}

				.spec-task-item.task-done .spec-task-checkbox {
					background: var(--vscode-testing-iconPassed);
					border-color: var(--vscode-testing-iconPassed);
					color: white;
				}

				.spec-task-item.task-in-progress .spec-task-checkbox {
					background: var(--vscode-charts-yellow);
					border-color: var(--vscode-charts-yellow);
					color: white;
				}

				.spec-task-content {
					flex: 1;
					min-width: 0;
				}

				.spec-task-header {
					display: flex;
					align-items: center;
					gap: 8px;
				}

				.spec-task-id {
					font-family: var(--vscode-editor-font-family);
					font-size: 11px;
					padding: 1px 4px;
					border-radius: 3px;
					background: var(--vscode-badge-background);
					color: var(--vscode-badge-foreground);
				}

				.spec-task-title {
					font-size: 13px;
					color: var(--vscode-foreground);
					font-weight: 500;
				}

				.spec-task-item.task-done .spec-task-title {
					text-decoration: line-through;
					opacity: 0.7;
				}

				.spec-task-description {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-top: 4px;
					line-height: 1.4;
				}

				.spec-task-meta {
					display: flex;
					gap: 8px;
					margin-top: 4px;
					font-size: 11px;
					color: var(--vscode-descriptionForeground);
				}

				.spec-task-complexity {
					padding: 1px 6px;
					border-radius: 3px;
					background: var(--vscode-textBlockQuote-background);
				}

				.spec-task-deps {
					opacity: 0.8;
				}

				.spec-task-actions {
					display: flex;
					align-items: center;
					gap: 4px;
					flex-shrink: 0;
				}

				.spec-task-start-btn {
					display: flex;
					align-items: center;
					gap: 4px;
					padding: 4px 8px;
					font-size: 11px;
					background: transparent;
					color: var(--vscode-textLink-foreground);
					border: 1px solid var(--vscode-textLink-foreground);
					border-radius: 4px;
					cursor: pointer;
					opacity: 0;
					transition: all 0.15s ease;
				}

				.spec-task-item:hover .spec-task-start-btn {
					opacity: 1;
				}

				.spec-task-start-btn:hover {
					background: var(--vscode-textLink-foreground);
					color: var(--vscode-button-foreground);
				}

				.spec-task-start-btn:disabled {
					opacity: 0.4;
					cursor: not-allowed;
				}

				.spec-task-start-btn-icon {
					font-size: 10px;
				}

				.spec-task-item.task-in-progress .spec-task-start-btn {
					opacity: 1;
					background: var(--vscode-charts-yellow);
					border-color: var(--vscode-charts-yellow);
					color: white;
					cursor: default;
				}
			`}</style>

			{tasks.map((task) => (
				<div key={task.id} className={`spec-task-item ${getStatusClass(task.status)}`}>
					<div className="spec-task-checkbox">{getStatusIcon(task.status)}</div>

					<div className="spec-task-content">
						<div className="spec-task-header">
							<span className="spec-task-id">{task.id}</span>
							<span className="spec-task-title">{task.title}</span>
						</div>

						{task.description && <div className="spec-task-description">{task.description}</div>}

						{(task.complexity || task.dependencies?.length) && (
							<div className="spec-task-meta">
								{task.complexity && (
									<span className="spec-task-complexity">📊 {task.complexity}</span>
								)}
								{task.dependencies && task.dependencies.length > 0 && (
									<span className="spec-task-deps">
										🔗 Depends: {task.dependencies.join(", ")}
									</span>
								)}
							</div>
						)}
					</div>

					<div className="spec-task-actions">
						{task.status === "pending" && (
							<button
								className="spec-task-start-btn"
								onClick={() => handleStartTask(task.id)}
								title={`Start task ${task.id}`}
							>
								<span className="spec-task-start-btn-icon">▶</span>
								<span>Start task</span>
							</button>
						)}
						{task.status === "in-progress" && (
							<button className="spec-task-start-btn" disabled>
								<span className="spec-task-start-btn-icon">⏳</span>
								<span>In progress</span>
							</button>
						)}
					</div>
				</div>
			))}
		</div>
	)
}

export default SpecTaskList
