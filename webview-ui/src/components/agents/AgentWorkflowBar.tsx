import React from "react"
import type { SentinelAgentType, AgentStateStatus } from "@roo-code/types"

// Extended agent types to include review phases
type ExtendedAgentType = SentinelAgentType | "design_review" | "code_review" | "test_review" | "final_review"

interface AgentWorkflowBarProps {
	currentAgent: SentinelAgentType | null
	agentStates: Record<SentinelAgentType, AgentStateStatus>
	currentTask?: string
	step?: number
}

// Mapping of agent types to display names and icons
const AGENT_CONFIG: Record<ExtendedAgentType, { name: string; icon: string }> = {
	architect: { name: "ARCHITECT", icon: "🔷" },
	designer: { name: "DESIGNER", icon: "🎨" },
	design_review: { name: "DESIGN_REVIEW", icon: "🔎" },
	builder: { name: "BUILDER", icon: "🟩" },
	code_review: { name: "CODE_REVIEW", icon: "📝" },
	qa: { name: "QA", icon: "🧪" },
	test_review: { name: "TEST_REVIEW", icon: "✅" },
	sentinel: { name: "SENTINEL", icon: "🛡️" },
	final_review: { name: "FINAL_REVIEW", icon: "🏁" },
}

// Workflow order
const WORKFLOW_ORDER: ExtendedAgentType[] = [
	"architect",
	"designer",
	"design_review",
	"builder",
	"code_review",
	"qa",
	"test_review",
	"sentinel",
	"final_review",
]

// Get status from current agent position
const getAgentStatus = (
	agent: ExtendedAgentType,
	currentAgent: SentinelAgentType | null,
	agentStates: Record<SentinelAgentType, AgentStateStatus>
): "active" | "completed" | "pending" => {
	// Handle review phases as pending by default
	if (agent.includes("_review") || agent === "final_review") {
		const currentIndex = currentAgent ? WORKFLOW_ORDER.indexOf(currentAgent) : -1
		const agentIndex = WORKFLOW_ORDER.indexOf(agent)
		if (agentIndex < currentIndex) return "completed"
		if (agentIndex === currentIndex) return "active"
		return "pending"
	}

	// Standard agents
	const state = agentStates[agent as SentinelAgentType]
	if (state === "completed") return "completed"
	if (state === "active") return "active"
	return "pending"
}

export const AgentWorkflowBar: React.FC<AgentWorkflowBarProps> = ({
	currentAgent,
	agentStates,
	currentTask,
	step,
}) => {
	return (
		<div className="workflow-bar">
			{/* Header */}
			<div className="workflow-header">
				<div className="header-left">
					<span className="header-title">Sentinel Architect Workflow</span>
					<span className="header-subtitle">
						Architect → Designer → Builder → QA → Sentinel → Final Review
					</span>
				</div>
				<div className="header-right">
					{currentTask && (
						<div className="task-badge">
							<span className="task-id">TASK</span>
							<span className="task-desc">{currentTask}</span>
						</div>
					)}
					{currentAgent && (
						<div className={`status-badge ${currentAgent}`}>
							<span className="status-dot" />
							<span className="status-text">
								{AGENT_CONFIG[currentAgent]?.name || currentAgent.toUpperCase()} ACTIVE
							</span>
						</div>
					)}
				</div>
			</div>

			{/* State Bar */}
			<div className="state-bar">
				{WORKFLOW_ORDER.map((agent, index) => {
					const status = getAgentStatus(agent, currentAgent, agentStates)
					const config = AGENT_CONFIG[agent]

					return (
						<React.Fragment key={agent}>
							<div className={`state-item ${status}`}>
								{status === "completed" && <span className="state-icon">✓</span>}
								{status === "active" && <span className="state-dot" />}
								<span className="state-text">{config.name}</span>
							</div>
							{index < WORKFLOW_ORDER.length - 1 && (
								<span className="state-arrow">›</span>
							)}
						</React.Fragment>
					)
				})}
			</div>

			{/* Step indicator */}
			{step !== undefined && currentAgent && (
				<div className="step-indicator">
					<span className="step-text">[Step {step} · {AGENT_CONFIG[currentAgent]?.name || currentAgent} Phase]</span>
				</div>
			)}

			<style>{workflowStyles}</style>
		</div>
	)
}

const workflowStyles = `
	.workflow-bar {
		background: linear-gradient(180deg, #0A0F1C 0%, #0F172A 100%);
		border: 1px solid rgba(71, 85, 105, 0.3);
		border-radius: 12px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
	}

	/* Header */
	.workflow-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 12px;
	}

	.header-left {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.header-title {
		color: #FFFFFF;
		font-size: 16px;
		font-weight: 700;
	}

	.header-subtitle {
		color: #64748B;
		font-family: 'JetBrains Mono', 'SF Mono', Monaco, monospace;
		font-size: 11px;
	}

	.header-right {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
	}

	.task-badge {
		background: #1E293B;
		border-radius: 8px;
		padding: 6px 12px;
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.task-id {
		color: #22D3EE;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		font-weight: 700;
	}

	.task-desc {
		color: #94A3B8;
		font-size: 10px;
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-badge {
		background: #EC4899;
		border-radius: 100px;
		padding: 6px 14px;
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.status-badge.architect { background: #10B981; }
	.status-badge.designer { background: #EC4899; }
	.status-badge.builder { background: #3B82F6; }
	.status-badge.qa { background: #8B5CF6; }
	.status-badge.sentinel { background: #F59E0B; }

	.status-dot {
		width: 6px;
		height: 6px;
		background: #FFFFFF;
		border-radius: 50%;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	.status-text {
		color: #FFFFFF;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.5px;
	}

	/* State Bar */
	.state-bar {
		display: flex;
		gap: 4px;
		align-items: center;
		flex-wrap: wrap;
		padding: 8px 0;
	}

	.state-item {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 6px 12px;
		border-radius: 8px;
		background: #1E293B;
		transition: all 0.2s ease;
	}

	.state-item.completed {
		background: #10B981;
	}

	.state-item.active {
		background: #EC4899;
	}

	.state-item.pending {
		background: #1E293B;
	}

	.state-icon {
		font-size: 10px;
		color: #0A0F1C;
	}

	.state-item .state-dot {
		width: 6px;
		height: 6px;
		background: #FFFFFF;
		border-radius: 50%;
	}

	.state-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		font-weight: 600;
	}

	.state-item.completed .state-text {
		color: #0A0F1C;
	}

	.state-item.active .state-text {
		color: #FFFFFF;
	}

	.state-item.pending .state-text {
		color: #64748B;
	}

	.state-arrow {
		color: #475569;
		font-size: 14px;
		margin: 0 2px;
	}

	/* Step Indicator */
	.step-indicator {
		text-align: right;
	}

	.step-text {
		color: #EC4899;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
	}

	/* Responsive */
	@media (max-width: 600px) {
		.workflow-header {
			flex-direction: column;
		}
		.state-bar {
			overflow-x: auto;
			flex-wrap: nowrap;
		}
	}
`

export default AgentWorkflowBar
