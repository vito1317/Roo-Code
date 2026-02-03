/**
 * Dual Agent Conversation Panel
 *
 * Displays two AI agents side-by-side when they are actively communicating.
 * Shows both agents' status, current activity, and handoff information.
 * Follows Pencil design specs.
 */
import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Agent configuration with Pencil design colors
const AGENT_CONFIG: Record<string, {
	headerBg: string
	borderColor: string
	textColor: string
	icon: string
	label: string
}> = {
	ARCHITECT: {
		headerBg: "#10B981",
		borderColor: "#10B981",
		textColor: "#0A0F1C",
		icon: "🔷",
		label: "Architect",
	},
	DESIGNER: {
		headerBg: "#EC4899",
		borderColor: "#EC4899",
		textColor: "#FFFFFF",
		icon: "🎨",
		label: "Designer",
	},
	DESIGN_REVIEW: {
		headerBg: "#F59E0B",
		borderColor: "#F59E0B",
		textColor: "#0A0F1C",
		icon: "🔎",
		label: "Design Review",
	},
	BUILDER: {
		headerBg: "#3B82F6",
		borderColor: "#3B82F6",
		textColor: "#FFFFFF",
		icon: "🟩",
		label: "Builder",
	},
	CODE_REVIEW: {
		headerBg: "#8B5CF6",
		borderColor: "#8B5CF6",
		textColor: "#FFFFFF",
		icon: "📝",
		label: "Code Review",
	},
	QA: {
		headerBg: "#F59E0B",
		borderColor: "#F59E0B",
		textColor: "#0A0F1C",
		icon: "🧪",
		label: "QA Engineer",
	},
	TEST_REVIEW: {
		headerBg: "#22D3EE",
		borderColor: "#22D3EE",
		textColor: "#0A0F1C",
		icon: "✅",
		label: "Test Review",
	},
	SENTINEL: {
		headerBg: "#EF4444",
		borderColor: "#EF4444",
		textColor: "#FFFFFF",
		icon: "🛡️",
		label: "Sentinel",
	},
	FINAL_REVIEW: {
		headerBg: "#10B981",
		borderColor: "#10B981",
		textColor: "#0A0F1C",
		icon: "🏁",
		label: "Final Review",
	},
}

interface AgentCardProps {
	agentId: string
	isActive: boolean
	isReceiver?: boolean
	activity?: string
	task?: string
}

const AgentCard: React.FC<AgentCardProps> = ({
	agentId,
	isActive,
	isReceiver = false,
	activity,
	task,
}) => {
	const config = AGENT_CONFIG[agentId] || {
		headerBg: "#1E293B",
		borderColor: "#475569",
		textColor: "#64748B",
		icon: "⚪",
		label: agentId,
	}

	return (
		<div
			style={{
				flex: 1,
				minWidth: "140px",
				background: "#1E293B",
				borderRadius: "12px",
				overflow: "hidden",
				border: `2px solid ${isActive ? config.borderColor : "#475569"}`,
				opacity: isActive || isReceiver ? 1 : 0.6,
				transition: "all 0.3s ease",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "8px 12px",
					background: isActive ? config.headerBg : "#0F172A",
				}}
			>
				<div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
					<span style={{ fontSize: "12px" }}>{config.icon}</span>
					<span
						style={{
							fontFamily: "'Inter', sans-serif",
							fontSize: "11px",
							fontWeight: 600,
							color: isActive ? config.textColor : "#64748B",
						}}
					>
						{config.label}
					</span>
				</div>

				{/* Status Badge */}
				<div
					style={{
						display: "flex",
						gap: "4px",
						alignItems: "center",
						padding: "2px 6px",
						borderRadius: "4px",
						background: isActive ? "rgba(255,255,255,0.9)" : "#475569",
						fontFamily: "'JetBrains Mono', monospace",
						fontSize: "8px",
						fontWeight: 700,
						color: isActive ? config.headerBg : "#0A0F1C",
					}}
				>
					{isActive && (
						<span
							style={{
								width: "4px",
								height: "4px",
								background: config.headerBg,
								borderRadius: "50%",
								animation: "pulse 1.5s ease-in-out infinite",
							}}
						/>
					)}
					<span>
						{isActive ? "ACTIVE" : isReceiver ? "RECEIVING" : "PENDING"}
					</span>
				</div>
			</div>

			{/* Body */}
			<div
				style={{
					padding: "10px 12px",
					display: "flex",
					flexDirection: "column",
					gap: "6px",
				}}
			>
				{/* Activity */}
				{activity && (
					<div
						style={{
							fontFamily: "'Inter', sans-serif",
							fontSize: "10px",
							color: isActive ? config.borderColor : "#475569",
							fontStyle: "italic",
						}}
					>
						"						&ldquo;{activity}&rdquo;"
					</div>
				)}

				{/* Task */}
				{task && (
					<div
						style={{
							fontFamily: "'JetBrains Mono', monospace",
							fontSize: "9px",
							color: "#64748B",
							background: "#0A0F1C",
							padding: "6px 8px",
							borderRadius: "4px",
						}}
					>
						{task}
					</div>
				)}
			</div>
		</div>
	)
}

interface DualAgentConversationPanelProps {
	className?: string
}

export const DualAgentConversationPanel: React.FC<DualAgentConversationPanelProps> = ({
	className,
}) => {
	const { sentinelAgentState } = useExtensionState()

	// Don't render if Sentinel mode is not active or no handoff
	if (!sentinelAgentState?.enabled || !sentinelAgentState.lastHandoff) {
		return null
	}

	const currentAgent = sentinelAgentState.currentAgent || "IDLE"
	const handoff = sentinelAgentState.lastHandoff
	const activity = sentinelAgentState.currentActivity

	// Determine the two agents in conversation
	const sourceAgent = handoff.from
	const targetAgent = handoff.to || currentAgent

	// Don't show if the agents are the same
	if (sourceAgent === targetAgent) {
		return null
	}

	return (
		<div
			className={className}
			style={{
				background: "linear-gradient(180deg, #0A0F1C 0%, #0F172A 100%)",
				borderRadius: "12px",
				padding: "12px",
				border: "1px solid rgba(71, 85, 105, 0.3)",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "12px",
				}}
			>
				<span
					style={{
						color: "#FFFFFF",
						fontFamily: "'Inter', sans-serif",
						fontSize: "12px",
						fontWeight: 600,
					}}
				>
					🤖 AI Agent Conversation
				</span>
				<span
					style={{
						color: "#64748B",
						fontFamily: "'JetBrains Mono', monospace",
						fontSize: "9px",
					}}
				>
					LIVE
				</span>
			</div>

			{/* Dual Agent Display */}
			<div
				style={{
					display: "flex",
					gap: "12px",
					alignItems: "stretch",
				}}
			>
				{/* Source Agent (who handed off) */}
				<AgentCard
					agentId={sourceAgent}
					isActive={currentAgent === sourceAgent}
					task={handoff.summary ? `Sent: ${handoff.summary.substring(0, 50)}...` : undefined}
				/>

				{/* Connection Arrow */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						justifyContent: "center",
						alignItems: "center",
						gap: "4px",
					}}
				>
					<div
						style={{
							width: "24px",
							height: "2px",
							background: "linear-gradient(90deg, #10B981, #EC4899)",
						}}
					/>
					<span style={{ fontSize: "12px" }}>→</span>
					<div
						style={{
							width: "24px",
							height: "2px",
							background: "linear-gradient(90deg, #EC4899, #3B82F6)",
						}}
					/>
				</div>

				{/* Target Agent (current) */}
				<AgentCard
					agentId={targetAgent}
					isActive={currentAgent === targetAgent}
					isReceiver={currentAgent !== targetAgent}
					activity={activity}
				/>
			</div>

			<style>{`
				@keyframes pulse {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.5; }
				}
			`}</style>
		</div>
	)
}

export default DualAgentConversationPanel
