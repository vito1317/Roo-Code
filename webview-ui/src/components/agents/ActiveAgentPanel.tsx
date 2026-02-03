import React from "react"
import type { SentinelAgentType, AgentStateStatus } from "@roo-code/types"

interface ActiveAgentPanelProps {
	agent: SentinelAgentType | null
	status: AgentStateStatus
	thinking?: string
	currentAction?: string
	progress?: { current: number; total: number }
	mcpTool?: string
	outputs?: string[]
}

// Agent colors matching Pencil design
const AGENT_COLORS: Record<SentinelAgentType, { primary: string; text: string; headerBg: string }> = {
	architect: { primary: "#10B981", text: "#0A0F1C", headerBg: "#10B981" },
	designer: { primary: "#EC4899", text: "#FFFFFF", headerBg: "#EC4899" },
	builder: { primary: "#3B82F6", text: "#FFFFFF", headerBg: "#3B82F6" },
	qa: { primary: "#8B5CF6", text: "#FFFFFF", headerBg: "#8B5CF6" },
	sentinel: { primary: "#F59E0B", text: "#0A0F1C", headerBg: "#F59E0B" },
}

// Agent icons
const AGENT_ICONS: Record<SentinelAgentType, string> = {
	architect: "🔷",
	designer: "🎨",
	builder: "🟩",
	qa: "🧪",
	sentinel: "🛡️",
}

const STATUS_BADGES: Record<AgentStateStatus, { label: string; style: string }> = {
	idle: { label: "IDLE", style: "idle" },
	active: { label: "ACTIVE", style: "active" },
	completed: { label: "✓ DONE", style: "done" },
	error: { label: "✗ ERROR", style: "error" },
}

export const ActiveAgentPanel: React.FC<ActiveAgentPanelProps> = ({
	agent,
	status,
	thinking,
	currentAction,
	progress,
	mcpTool,
	outputs = [],
}) => {
	if (!agent) {
		return (
			<div className="agent-panel empty">
				<span className="empty-icon">🔹</span>
				<span className="empty-text">等待 Agent 啟動...</span>
				<style>{panelStyles}</style>
			</div>
		)
	}

	const colors = AGENT_COLORS[agent]
	const icon = AGENT_ICONS[agent]
	const statusBadge = STATUS_BADGES[status]

	return (
		<div
			className={`agent-panel ${status}`}
			style={{ "--agent-color": colors.primary } as React.CSSProperties}
		>
			{/* Header */}
			<div className="panel-header" style={{ background: colors.headerBg }}>
				<div className="header-left">
					<span className="agent-icon">{icon}</span>
					<span className="agent-name" style={{ color: colors.text }}>
						{agent.charAt(0).toUpperCase() + agent.slice(1)}
					</span>
				</div>
				<div className={`status-badge ${statusBadge.style}`}>
					{status === "active" && <span className="badge-dot" />}
					<span className="badge-text">{statusBadge.label}</span>
				</div>
			</div>

			{/* Body */}
			<div className="panel-body">
				{/* MCP Tool */}
				{mcpTool && (
					<div className="info-row">
						<span className="info-label">MCP Tool:</span>
						<span className="info-value highlight">{mcpTool}</span>
					</div>
				)}

				{/* Current Action */}
				{currentAction && (
					<div className="action-section">
						<span className="info-label">Current Action:</span>
						<div className="action-code">
							<code>{currentAction}</code>
						</div>
					</div>
				)}

				{/* Progress */}
				{progress && (
					<div className="progress-section">
						<div className="progress-header">
							<span className="progress-label">Progress</span>
							<span className="progress-count">
								{progress.current} / {progress.total}
							</span>
						</div>
						<div className="progress-bar">
							<div
								className="progress-fill"
								style={{
									width: `${(progress.current / progress.total) * 100}%`,
									background: colors.primary,
								}}
							/>
						</div>
					</div>
				)}

				{/* Outputs */}
				{outputs.length > 0 && (
					<div className="outputs-section">
						{outputs.map((output, i) => (
							<div key={i} className="output-item">
								<span className="output-icon">✓</span>
								<span className="output-text">{output}</span>
							</div>
						))}
					</div>
				)}

				{/* Thinking */}
				{thinking && (
					<div className="thinking-section">
						<span className="info-label">Thinking:</span>
						<span className="thinking-text">"{thinking}"</span>
					</div>
				)}
			</div>

			<style>{panelStyles}</style>
		</div>
	)
}

const panelStyles = `
	.agent-panel {
		background: #1E293B;
		border-radius: 16px;
		overflow: hidden;
		border: 2px solid transparent;
		transition: all 0.3s ease;
	}

	.agent-panel.active {
		border-color: var(--agent-color, #EC4899);
	}

	.agent-panel.completed {
		border-color: #10B981;
	}

	.agent-panel.error {
		border-color: #EF4444;
	}

	.agent-panel.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px 20px;
		gap: 8px;
		background: linear-gradient(180deg, #1E293B 0%, #0F172A 100%);
	}

	.empty-icon {
		font-size: 32px;
		opacity: 0.5;
	}

	.empty-text {
		color: #64748B;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
	}

	/* Header */
	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 16px;
	}

	.header-left {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.agent-icon {
		font-size: 14px;
	}

	.agent-name {
		font-family: 'Inter', sans-serif;
		font-size: 14px;
		font-weight: 600;
	}

	.status-badge {
		display: flex;
		gap: 4px;
		align-items: center;
		padding: 3px 8px;
		border-radius: 4px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		font-weight: 700;
	}

	.status-badge.active {
		background: #FFFFFF;
		color: var(--agent-color, #EC4899);
	}

	.status-badge.done {
		background: #0A0F1C;
		color: #10B981;
	}

	.status-badge.error {
		background: #0A0F1C;
		color: #EF4444;
	}

	.status-badge.idle {
		background: #475569;
		color: #0A0F1C;
	}

	.badge-dot {
		width: 6px;
		height: 6px;
		background: currentColor;
		border-radius: 50%;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	/* Body */
	.panel-body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.info-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.info-label {
		color: #64748B;
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
	}

	.info-value {
		color: #94A3B8;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
	}

	.info-value.highlight {
		color: var(--agent-color, #EC4899);
		font-weight: 600;
	}

	/* Action */
	.action-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.action-code {
		background: #0A0F1C;
		border-radius: 6px;
		padding: 8px 10px;
	}

	.action-code code {
		color: var(--agent-color, #EC4899);
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
	}

	/* Progress */
	.progress-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
	}

	.progress-label {
		color: #64748B;
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
	}

	.progress-count {
		color: var(--agent-color, #EC4899);
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		font-weight: 600;
	}

	.progress-bar {
		height: 6px;
		background: #0A0F1C;
		border-radius: 3px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	/* Outputs */
	.outputs-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.output-item {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.output-icon {
		color: #10B981;
		font-size: 10px;
	}

	.output-text {
		color: #10B981;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
	}

	/* Thinking */
	.thinking-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.thinking-text {
		color: var(--agent-color, #EC4899);
		font-family: 'Inter', sans-serif;
		font-size: 11px;
		font-style: italic;
	}
`

export default ActiveAgentPanel
