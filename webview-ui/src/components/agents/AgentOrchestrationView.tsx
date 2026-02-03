import React, { useState } from "react"
import { AgentWorkflowBar } from "./AgentWorkflowBar"
import { ActiveAgentPanel } from "./ActiveAgentPanel"
import { ToolActivityFeed } from "./ToolActivityFeed"
import type { SentinelAgentType, AgentStateStatus, ToolCallInfo } from "@roo-code/types"

export interface AgentOrchestrationViewProps {
	currentAgent: SentinelAgentType | null
	agentStates: Record<SentinelAgentType, AgentStateStatus>
	currentTask: string
	progress: number
	context: {
		filesRead: number
		filesWritten: number
		toolsUsed: number
	}
	toolCalls: ToolCallInfo[]
	thinking?: string
	onUserInput?: (message: string) => void
}

export const AgentOrchestrationView: React.FC<AgentOrchestrationViewProps> = ({
	currentAgent,
	agentStates,
	currentTask: _currentTask,
	progress,
	context,
	toolCalls,
	thinking,
	onUserInput,
}) => {
	const [inputValue, setInputValue] = useState("")

	const handleSubmit = () => {
		if (inputValue.trim() && onUserInput) {
			onUserInput(inputValue.trim())
			setInputValue("")
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			handleSubmit()
		}
	}

	return (
		<div className="agent-orchestration-view">
			{/* Top: Agent Workflow Pipeline */}
			<AgentWorkflowBar currentAgent={currentAgent} agentStates={agentStates} />

			{/* Middle: Two Column Layout */}
			<div className="orchestration-content">
				<div className="left-panel">
					<ActiveAgentPanel
						agent={currentAgent}
						status={currentAgent ? agentStates[currentAgent] : "idle"}
						thinking={thinking}
						progress={progress ? { current: progress, total: 100 } : undefined}
						outputs={[
							...(context.filesRead > 0 ? [`${context.filesRead} files read`] : []),
							...(context.filesWritten > 0 ? [`${context.filesWritten} files written`] : []),
						]}
					/>
				</div>
				<div className="right-panel">
					<ToolActivityFeed toolCalls={toolCalls} />
				</div>
			</div>

			{/* Bottom: User Input */}
			<div className="user-input-section">
				<div className="input-container">
					<textarea
						className="message-input"
						placeholder="輸入您的需求..."
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						onKeyDown={handleKeyDown}
						rows={1}
					/>
					<button className="send-button" onClick={handleSubmit} disabled={!inputValue.trim()}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
						</svg>
					</button>
				</div>
			</div>

			<style>{`
				.agent-orchestration-view {
					display: flex;
					flex-direction: column;
					height: 100%;
					padding: 16px;
					gap: 16px;
					background: linear-gradient(180deg, #0f0f14 0%, #1a1a24 100%);
					overflow: hidden;
				}

				.orchestration-content {
					flex: 1;
					display: grid;
					grid-template-columns: 1fr 1fr;
					gap: 16px;
					min-height: 0;
					overflow: hidden;
				}

				.left-panel, .right-panel {
					overflow: hidden;
					display: flex;
					flex-direction: column;
				}

				.left-panel > *, .right-panel > * {
					flex: 1;
					min-height: 0;
				}

				.user-input-section {
					flex-shrink: 0;
					padding-top: 8px;
				}

				.input-container {
					display: flex;
					gap: 12px;
					align-items: flex-end;
					background: rgba(30, 30, 40, 0.95);
					border: 1px solid rgba(99, 102, 241, 0.2);
					border-radius: 16px;
					padding: 12px 16px;
					backdrop-filter: blur(10px);
				}

				.message-input {
					flex: 1;
					background: transparent;
					border: none;
					color: rgba(255, 255, 255, 0.9);
					font-size: 14px;
					resize: none;
					outline: none;
					font-family: inherit;
					line-height: 1.5;
					max-height: 120px;
				}

				.message-input::placeholder {
					color: rgba(255, 255, 255, 0.4);
				}

				.send-button {
					width: 40px;
					height: 40px;
					border-radius: 12px;
					background: linear-gradient(135deg, #6366f1, #8b5cf6);
					border: none;
					cursor: pointer;
					display: flex;
					align-items: center;
					justify-content: center;
					transition: all 0.2s ease;
					flex-shrink: 0;
				}

				.send-button:hover:not(:disabled) {
					transform: scale(1.05);
					box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
				}

				.send-button:disabled {
					opacity: 0.5;
					cursor: not-allowed;
				}

				.send-button svg {
					width: 18px;
					height: 18px;
					color: white;
				}

				/* Responsive: Stack on narrow screens */
				@media (max-width: 600px) {
					.orchestration-content {
						grid-template-columns: 1fr;
					}
				}
			`}</style>
		</div>
	)
}

export default AgentOrchestrationView
