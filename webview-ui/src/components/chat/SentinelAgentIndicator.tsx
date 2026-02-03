/**
 * Sentinel Agent Indicator with Workflow Bar
 *
 * Displays the current active Sentinel agent during FSM workflow
 * with a visual workflow progress bar showing all stages.
 * Updated to match Pencil design specs.
 */
import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Workflow stages in order
const WORKFLOW_STAGES = [
	{ id: "ARCHITECT", label: "ARCHITECT", icon: "🔷" },
	{ id: "DESIGNER", label: "DESIGNER", icon: "🎨" },
	{ id: "DESIGN_REVIEW", label: "DESIGN_REVIEW", icon: "🔎" },
	{ id: "BUILDER", label: "BUILDER", icon: "🟩" },
	{ id: "CODE_REVIEW", label: "CODE_REVIEW", icon: "📝" },
	{ id: "QA", label: "QA", icon: "🧪" },
	{ id: "TEST_REVIEW", label: "TEST_REVIEW", icon: "✅" },
	{ id: "SENTINEL", label: "SENTINEL", icon: "🛡️" },
	{ id: "FINAL_REVIEW", label: "FINAL_REVIEW", icon: "🏁" },
] as const

// Agent state configuration with Pencil design colors
const AGENT_CONFIG: Record<string, {
	headerBg: string
	borderColor: string
	textColor: string
	icon: string
	label: string
	statusMessage: string
	spinning: boolean
}> = {
	IDLE: {
		headerBg: "#1E293B",
		borderColor: "#475569",
		textColor: "#64748B",
		icon: "⚪",
		label: "Idle",
		statusMessage: "",
		spinning: false,
	},
	ARCHITECT: {
		headerBg: "#10B981",
		borderColor: "#10B981",
		textColor: "#0A0F1C",
		icon: "🔷",
		label: "Architect",
		statusMessage: "📐 規劃架構中...",
		spinning: false,
	},
	DESIGNER: {
		headerBg: "#EC4899",
		borderColor: "#EC4899",
		textColor: "#FFFFFF",
		icon: "🎨",
		label: "Designer",
		statusMessage: "🎨 Creating UI design...",
		spinning: false,
	},
	DESIGN_REVIEW: {
		headerBg: "#F59E0B",
		borderColor: "#F59E0B",
		textColor: "#0A0F1C",
		icon: "🔎",
		label: "Design Review",
		statusMessage: "🔍 Reviewing design...",
		spinning: true,
	},
	BUILDER: {
		headerBg: "#3B82F6",
		borderColor: "#3B82F6",
		textColor: "#FFFFFF",
		icon: "🟩",
		label: "Builder",
		statusMessage: "🔨 Building implementation...",
		spinning: false,
	},
	CODE_REVIEW: {
		headerBg: "#8B5CF6",
		borderColor: "#8B5CF6",
		textColor: "#FFFFFF",
		icon: "📝",
		label: "Code Review",
		statusMessage: "📝 Reviewing code...",
		spinning: true,
	},
	ARCHITECT_REVIEW: {
		headerBg: "#8B5CF6",
		borderColor: "#8B5CF6",
		textColor: "#FFFFFF",
		icon: "🔍",
		label: "Architect Review",
		statusMessage: "🔍 Reviewing & validating...",
		spinning: true,
	},
	QA: {
		headerBg: "#F59E0B",
		borderColor: "#F59E0B",
		textColor: "#0A0F1C",
		icon: "🧪",
		label: "QA Engineer",
		statusMessage: "🧪 Testing in progress...",
		spinning: true,
	},
	TEST_REVIEW: {
		headerBg: "#22D3EE",
		borderColor: "#22D3EE",
		textColor: "#0A0F1C",
		icon: "✅",
		label: "Test Review",
		statusMessage: "✅ Reviewing tests...",
		spinning: true,
	},
	SENTINEL: {
		headerBg: "#EF4444",
		borderColor: "#EF4444",
		textColor: "#FFFFFF",
		icon: "🛡️",
		label: "Sentinel",
		statusMessage: "🛡️ Security auditing...",
		spinning: true,
	},
	FINAL_REVIEW: {
		headerBg: "#10B981",
		borderColor: "#10B981",
		textColor: "#0A0F1C",
		icon: "🏁",
		label: "Final Review",
		statusMessage: "🏁 Final verification...",
		spinning: true,
	},
	COMPLETED: {
		headerBg: "#10B981",
		borderColor: "#10B981",
		textColor: "#0A0F1C",
		icon: "✅",
		label: "Completed",
		statusMessage: "✅ Workflow complete!",
		spinning: false,
	},
	BLOCKED: {
		headerBg: "#F59E0B",
		borderColor: "#F59E0B",
		textColor: "#0A0F1C",
		icon: "🚫",
		label: "Blocked",
		statusMessage: "⚠️ Human intervention required",
		spinning: false,
	},
}

interface SentinelAgentIndicatorProps {
	className?: string
	variant?: "compact" | "full"
}

// Get stage status based on current agent
const getStageStatus = (stageId: string, currentAgent: string): "completed" | "active" | "pending" => {
	const stageIndex = WORKFLOW_STAGES.findIndex((s) => s.id === stageId)
	const currentIndex = WORKFLOW_STAGES.findIndex((s) => s.id === currentAgent)

	// Map some agent names to workflow stages
	const agentToStage: Record<string, string> = {
		ARCHITECT_REVIEW: "CODE_REVIEW",
	}
	const mappedCurrent = agentToStage[currentAgent] || currentAgent
	const mappedCurrentIndex = WORKFLOW_STAGES.findIndex((s) => s.id === mappedCurrent)

	if (currentAgent === "COMPLETED") return "completed"
	if (currentAgent === "IDLE") return "pending"

	if (stageIndex < mappedCurrentIndex) return "completed"
	if (stageIndex === mappedCurrentIndex) return "active"
	return "pending"
}

export const SentinelAgentIndicator: React.FC<SentinelAgentIndicatorProps> = ({
	className,
	variant = "full",
}) => {
	const { sentinelAgentState } = useExtensionState()

	// Don't render if Sentinel mode is not active
	if (!sentinelAgentState?.enabled) {
		return null
	}

	const currentAgent = (sentinelAgentState.currentAgent || "IDLE") as string
	const config = AGENT_CONFIG[currentAgent] || AGENT_CONFIG.IDLE
	const activity = sentinelAgentState.currentActivity || config.statusMessage
	const handoff = sentinelAgentState.lastHandoff

	// Compact variant - just icon and label
	if (variant === "compact") {
		return (
			<div
				className={className}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: "6px",
					padding: "6px 12px",
					borderRadius: "8px",
					background: config.headerBg,
					border: `2px solid ${config.borderColor}`,
					fontFamily: "'JetBrains Mono', monospace",
					fontSize: "10px",
					fontWeight: 600,
					color: config.textColor,
					transition: "all 0.3s ease",
				}}
				data-testid="sentinel-agent-indicator"
			>
				<span style={{ fontSize: "14px" }}>{config.icon}</span>
				<span>{config.label}</span>
				{config.spinning && <span style={{ animation: "spin 1s linear infinite" }}>⟳</span>}
			</div>
		)
	}

	// Full variant - with workflow bar, status message, activity, and handoff info
	return (
		<div
			className={className}
			style={{
				background: "linear-gradient(180deg, #0A0F1C 0%, #0F172A 100%)",
				borderRadius: "12px",
				overflow: "hidden",
				border: "1px solid rgba(71, 85, 105, 0.3)",
			}}
			data-testid="sentinel-agent-indicator-full"
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					padding: "12px 16px",
					gap: "12px",
					flexWrap: "wrap",
				}}
			>
				<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
					<span
						style={{
							color: "#FFFFFF",
							fontFamily: "'Inter', sans-serif",
							fontSize: "14px",
							fontWeight: 700,
						}}
					>
						Sentinel Architect Workflow
					</span>
					<span
						style={{
							color: "#64748B",
							fontFamily: "'JetBrains Mono', monospace",
							fontSize: "10px",
						}}
					>
						Architect → Designer → Builder → QA → Sentinel
					</span>
				</div>

				{/* Status Badge */}
				{currentAgent !== "IDLE" && (
					<div
						style={{
							display: "flex",
							gap: "8px",
							alignItems: "center",
							padding: "6px 14px",
							borderRadius: "100px",
							background: config.headerBg,
						}}
					>
						<span
							style={{
								width: "6px",
								height: "6px",
								background: "#FFFFFF",
								borderRadius: "50%",
								animation: "pulse 1.5s ease-in-out infinite",
							}}
						/>
						<span
							style={{
								color: config.textColor,
								fontFamily: "'JetBrains Mono', monospace",
								fontSize: "10px",
								fontWeight: 700,
								letterSpacing: "0.5px",
							}}
						>
							{config.label.toUpperCase()} ACTIVE
						</span>
					</div>
				)}
			</div>

			{/* Workflow State Bar */}
			<div
				style={{
					display: "flex",
					gap: "4px",
					alignItems: "center",
					padding: "8px 16px",
					overflowX: "auto",
					flexWrap: "wrap",
				}}
			>
				{WORKFLOW_STAGES.map((stage, index) => {
					const status = getStageStatus(stage.id, currentAgent)
					const bgColor =
						status === "completed"
							? "#10B981"
							: status === "active"
								? config.headerBg
								: "#1E293B"
					const textColor =
						status === "completed"
							? "#0A0F1C"
							: status === "active"
								? config.textColor
								: "#64748B"

					return (
						<React.Fragment key={stage.id}>
							<div
								style={{
									display: "flex",
									gap: "6px",
									alignItems: "center",
									padding: "6px 10px",
									borderRadius: "8px",
									background: bgColor,
									transition: "all 0.2s ease",
								}}
							>
								{status === "completed" && (
									<span style={{ fontSize: "10px", color: textColor }}>✓</span>
								)}
								{status === "active" && (
									<span
										style={{
											width: "6px",
											height: "6px",
											background: "#FFFFFF",
											borderRadius: "50%",
										}}
									/>
								)}
								<span
									style={{
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "9px",
										fontWeight: 600,
										color: textColor,
									}}
								>
									{stage.label}
								</span>
							</div>
							{index < WORKFLOW_STAGES.length - 1 && (
								<span style={{ color: "#475569", fontSize: "12px" }}>›</span>
							)}
						</React.Fragment>
					)
				})}
			</div>

			{/* Current Agent Card */}
			{currentAgent !== "IDLE" && (
				<div
					style={{
						margin: "8px 16px 16px",
						background: "#1E293B",
						borderRadius: "12px",
						overflow: "hidden",
						border: `2px solid ${config.borderColor}`,
					}}
				>
					{/* Agent Header */}
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							padding: "10px 14px",
							background: config.headerBg,
						}}
					>
						<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
							<span style={{ fontSize: "14px" }}>{config.icon}</span>
							<span
								style={{
									fontFamily: "'Inter', sans-serif",
									fontSize: "13px",
									fontWeight: 600,
									color: config.textColor,
								}}
							>
								{config.label}
							</span>
						</div>
						<div
							style={{
								display: "flex",
								gap: "4px",
								alignItems: "center",
								padding: "2px 8px",
								borderRadius: "4px",
								background:
									currentAgent === "COMPLETED" ? "#0A0F1C" : "rgba(255,255,255,0.9)",
								fontFamily: "'JetBrains Mono', monospace",
								fontSize: "9px",
								fontWeight: 700,
								color: currentAgent === "COMPLETED" ? "#10B981" : config.headerBg,
							}}
						>
							{config.spinning && (
								<span
									style={{
										width: "5px",
										height: "5px",
										background: config.headerBg,
										borderRadius: "50%",
										animation: "pulse 1.5s ease-in-out infinite",
									}}
								/>
							)}
							<span>{currentAgent === "COMPLETED" ? "✓ DONE" : "ACTIVE"}</span>
						</div>
					</div>

					{/* Agent Body */}
					<div
						style={{
							padding: "12px 14px",
							display: "flex",
							flexDirection: "column",
							gap: "8px",
						}}
					>
						{/* Activity */}
						{activity && (
							<div
								style={{
									fontFamily: "'Inter', sans-serif",
									fontSize: "11px",
									color: config.borderColor,
									fontStyle: "italic",
								}}
							>
								"{activity}"
							</div>
						)}

						{/* Handoff */}
						{handoff && handoff.summary && (
							<div
								style={{
									marginTop: "4px",
									padding: "8px 10px",
									background: "#0A0F1C",
									borderRadius: "6px",
								}}
							>
								<div
									style={{
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "9px",
										color: "#64748B",
										marginBottom: "4px",
									}}
								>
									📤 {handoff.from} → {handoff.to}
								</div>
								<div
									style={{
										fontFamily: "'Inter', sans-serif",
										fontSize: "10px",
										color: "#94A3B8",
										lineHeight: "1.3",
									}}
								>
									{handoff.summary}
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			<style>{`
				@keyframes spin {
					to { transform: rotate(360deg); }
				}
				@keyframes pulse {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.5; }
				}
			`}</style>
		</div>
	)
}

export default SentinelAgentIndicator
