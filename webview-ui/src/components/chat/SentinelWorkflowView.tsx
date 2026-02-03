/**
 * Sentinel Workflow View
 *
 * Complete Sentinel mode visualization with workflow header,
 * agent topology canvas, and AI-to-AI conversation panel.
 * Follows Pencil design specs.
 */
import React, { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AgentTopologyCanvas } from "./AgentTopologyCanvas"

// Workflow stages
const WORKFLOW_STAGES = [
	{ id: "ARCHITECT", label: "ARCHITECT" },
	{ id: "DESIGNER", label: "DESIGNER" },
	{ id: "DESIGN_REVIEW", label: "DESIGN_REVIEW" },
	{ id: "BUILDER", label: "BUILDER" },
	{ id: "CODE_REVIEW", label: "CODE_REVIEW" },
	{ id: "QA", label: "QA" },
	{ id: "TEST_REVIEW", label: "TEST_REVIEW" },
	{ id: "SENTINEL", label: "SENTINEL" },
	{ id: "FINAL_REVIEW", label: "FINAL_REVIEW" },
] as const

// Agent colors
const AGENT_COLORS: Record<string, string> = {
	ARCHITECT: "#10B981",
	DESIGNER: "#EC4899",
	DESIGN_REVIEW: "#F59E0B",
	BUILDER: "#3B82F6",
	CODE_REVIEW: "#8B5CF6",
	QA: "#F59E0B",
	TEST_REVIEW: "#22D3EE",
	SENTINEL: "#EF4444",
	FINAL_REVIEW: "#10B981",
}

interface SentinelWorkflowViewProps {
	className?: string
}

export const SentinelWorkflowView: React.FC<SentinelWorkflowViewProps> = ({
	className,
}) => {
		const { sentinelAgentState } = useExtensionState()

	// Get current agent and state - default to ARCHITECT if no agent set
	const currentAgent = sentinelAgentState?.currentAgent || "ARCHITECT"
	const activity = sentinelAgentState?.currentActivity || "正在分析需求與設計架構..."
	
	// Use actual handoff data from state - no hardcoded fallback
	const handoff = sentinelAgentState?.lastHandoff || null

		// Calculate completed agents
	const completedAgents = useMemo(() => {
		const currentIndex = WORKFLOW_STAGES.findIndex((s) => s.id === currentAgent)
		if (currentIndex <= 0) return [] as string[]
		return WORKFLOW_STAGES.slice(0, currentIndex).map((s) => s.id as string)
	}, [currentAgent])

	// Get stage status
	const getStageStatus = (stageId: string): "completed" | "active" | "pending" => {
		if (completedAgents.includes(stageId)) return "completed"
		if (currentAgent === stageId) return "active"
		return "pending"
	}

	// Current agent color
	const agentColor = AGENT_COLORS[currentAgent] || "#475569"

	return (
		<div
			className={className}
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "12px",
				height: "100%",
				minHeight: "100%",
				padding: "16px",
				boxSizing: "border-box",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					flexWrap: "wrap",
					gap: "12px",
				}}
			>
				<div>
					<h2
						style={{
							margin: 0,
							color: "#FFFFFF",
							fontFamily: "'Inter', sans-serif",
							fontSize: "18px",
							fontWeight: 700,
						}}
					>
						Sentinel Architect Workflow
					</h2>
					<p
						style={{
							margin: "4px 0 0",
							color: "#64748B",
							fontFamily: "'Inter', sans-serif",
							fontSize: "11px",
						}}
					>
						Architect → Designer → Builder → QA → Sentinel
					</p>
				</div>

								{/* Status badges and controls */}
				<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
					{/* Task ID */}
					<div
						style={{
							padding: "4px 10px",
							borderRadius: "4px",
							background: "#1E293B",
							fontFamily: "'JetBrains Mono', monospace",
							fontSize: "10px",
							color: "#64748B",
						}}
					>
						TASK-001 WORKFLOW.RUN
					</div>

					{/* Control buttons */}
					<button
						onClick={() => {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(window as any).vscode?.postMessage({ type: "cancelTask" })
						}}
						style={{
							display: "flex",
							alignItems: "center",
							gap: "4px",
							padding: "6px 12px",
							borderRadius: "6px",
							background: "#EF4444",
							border: "none",
							cursor: "pointer",
							fontFamily: "'Inter', sans-serif",
							fontSize: "10px",
							fontWeight: 600,
							color: "#FFFFFF",
						}}
					>
						<span style={{ fontSize: "12px" }}>⏹</span>
						中斷
					</button>

					<button
						onClick={() => {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(window as any).vscode?.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
						}}
						style={{
							display: "flex",
							alignItems: "center",
							gap: "4px",
							padding: "6px 12px",
							borderRadius: "6px",
							background: "#10B981",
							border: "none",
							cursor: "pointer",
							fontFamily: "'Inter', sans-serif",
							fontSize: "10px",
							fontWeight: 600,
							color: "#FFFFFF",
						}}
					>
						<span style={{ fontSize: "12px" }}>▶</span>
						繼續
					</button>

					{/* Active status */}
					<div
						style={{
							display: "flex",
							gap: "6px",
							alignItems: "center",
							padding: "6px 12px",
							borderRadius: "100px",
							background: agentColor,
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
								fontFamily: "'JetBrains Mono', monospace",
								fontSize: "10px",
								fontWeight: 700,
								color: currentAgent === "QA" || currentAgent === "DESIGN_REVIEW" ? "#0A0F1C" : "#FFFFFF",
							}}
						>
							{currentAgent.replace("_", " ")} ACTIVE
						</span>
					</div>
				</div>
			</div>

			{/* Workflow State Bar */}
			<div
				style={{
					display: "flex",
					gap: "4px",
					alignItems: "center",
					overflowX: "auto",
					padding: "8px 0",
				}}
			>
				{WORKFLOW_STAGES.map((stage, index) => {
					const status = getStageStatus(stage.id)
					const color = AGENT_COLORS[stage.id] || "#475569"
					const bgColor =
						status === "completed" ? "#10B981" : status === "active" ? color : "#1E293B"
					const textColor =
						status === "completed" || status === "active" ? "#FFFFFF" : "#64748B"

					return (
						<React.Fragment key={stage.id}>
							<div
								style={{
									display: "flex",
									gap: "4px",
									alignItems: "center",
									padding: "6px 10px",
									borderRadius: "6px",
									background: bgColor,
									border: status === "active" ? `2px solid ${color}` : "none",
									transition: "all 0.2s ease",
								}}
							>
								{status === "completed" && (
									<span style={{ fontSize: "9px", color: textColor }}>✓</span>
								)}
								{status === "active" && (
									<span
										style={{
											width: "5px",
											height: "5px",
											background: "#FFFFFF",
											borderRadius: "50%",
										}}
									/>
								)}
								<span
									style={{
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "8px",
										fontWeight: 600,
										color: textColor,
									}}
								>
									{stage.label}
								</span>
							</div>
							{index < WORKFLOW_STAGES.length - 1 && (
								<span style={{ color: "#475569", fontSize: "10px" }}>›</span>
							)}
						</React.Fragment>
					)
				})}
			</div>

			{/* Main Content Area */}
			<div
				style={{
					display: "flex",
					gap: "16px",
					flexWrap: "wrap",
				}}
			>
				{/* Agent Topology Canvas */}
				<div style={{ flex: "1 1 60%", minWidth: "400px" }}>
					<AgentTopologyCanvas
						currentAgent={currentAgent}
						completedAgents={completedAgents}
						activities={{ [currentAgent]: activity }}
						tasks={{}}
					/>
				</div>

				{/* AI-to-AI Conversation Panel */}
				<div
					style={{
						flex: "1 1 35%",
						minWidth: "280px",
						background: "#1E293B",
						borderRadius: "12px",
						padding: "12px",
						border: "1px solid rgba(71, 85, 105, 0.3)",
					}}
				>
					{/* Conversation Header */}
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
							🤖 AI-to-AI Conversation
						</span>
						<span
							style={{
								display: "flex",
								alignItems: "center",
								gap: "4px",
								padding: "3px 8px",
								borderRadius: "100px",
								background: "#10B981",
								fontFamily: "'JetBrains Mono', monospace",
								fontSize: "8px",
								fontWeight: 700,
								color: "#0A0F1C",
							}}
						>
							<span
								style={{
									width: "4px",
									height: "4px",
									background: "#0A0F1C",
									borderRadius: "50%",
								}}
							/>
							LIVE
						</span>
					</div>

					{/* Agent Badges */}
					{handoff && (
						<div
							style={{
								display: "flex",
								gap: "8px",
								marginBottom: "12px",
							}}
						>
							<div
								style={{
									flex: 1,
									padding: "8px",
									borderRadius: "8px",
									background: "#0F172A",
									border: `1px solid ${AGENT_COLORS[handoff.from] || "#475569"}`,
								}}
							>
								<div
									style={{
										fontFamily: "'Inter', sans-serif",
										fontSize: "10px",
										fontWeight: 600,
										color: AGENT_COLORS[handoff.from] || "#64748B",
									}}
								>
									{handoff.from} Agent
								</div>
								<div
									style={{
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "8px",
										color: "#475569",
										marginTop: "2px",
									}}
								>
									STATE: WAITING_FOR_RESPONSE
								</div>
							</div>
							<div
								style={{
									flex: 1,
									padding: "8px",
									borderRadius: "8px",
									background: AGENT_COLORS[handoff.to || currentAgent] || "#0F172A",
								}}
							>
								<div
									style={{
										fontFamily: "'Inter', sans-serif",
										fontSize: "10px",
										fontWeight: 600,
										color: "#FFFFFF",
									}}
								>
									{handoff.to || currentAgent} Agent
								</div>
								<div
									style={{
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "8px",
										color: "rgba(255,255,255,0.7)",
										marginTop: "2px",
									}}
								>
									STATE: PROCESSING
								</div>
							</div>
						</div>
					)}

					{/* Conversation Messages */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "8px",
							maxHeight: "200px",
							overflowY: "auto",
						}}
					>
						{handoff && handoff.summary && (
							<div
								style={{
									padding: "10px",
									borderRadius: "8px",
									background: "#0F172A",
									border: `2px solid ${AGENT_COLORS[handoff.from] || "#475569"}`,
								}}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: "6px",
									}}
								>
									<span
										style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "10px",
											fontWeight: 600,
											color: AGENT_COLORS[handoff.from] || "#64748B",
										}}
									>
										{handoff.from}
									</span>
									<span
										style={{
											fontFamily: "'JetBrains Mono', monospace",
											fontSize: "8px",
											color: "#475569",
										}}
									>
										DELEGATING_WORK
									</span>
								</div>
								<div
									style={{
										fontFamily: "'Inter', sans-serif",
										fontSize: "10px",
										color: "#94A3B8",
										lineHeight: "1.4",
									}}
								>
									{handoff.summary}
								</div>
							</div>
						)}

						{activity && (
							<div
								style={{
									padding: "10px",
									borderRadius: "8px",
									background: agentColor,
								}}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: "6px",
									}}
								>
									<span
										style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "10px",
											fontWeight: 600,
											color: "#0A0F1C",
										}}
									>
										{currentAgent}
									</span>
									<span
										style={{
											fontFamily: "'JetBrains Mono', monospace",
											fontSize: "8px",
											color: "rgba(0,0,0,0.5)",
										}}
									>
										WORKING
									</span>
								</div>
								<div
									style={{
										fontFamily: "'Inter', sans-serif",
										fontSize: "10px",
										color: "#0A0F1C",
										lineHeight: "1.4",
									}}
								>
									{activity}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			<style>{`
				@keyframes pulse {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.5; }
				}
				@keyframes glow {
					0%, 100% { 
						box-shadow: 0 0 5px rgba(16, 185, 129, 0.3);
					}
					50% { 
						box-shadow: 0 0 20px rgba(16, 185, 129, 0.6), 0 0 40px rgba(16, 185, 129, 0.3);
					}
				}
				@keyframes slideInRight {
					from {
						opacity: 0;
						transform: translateX(20px);
					}
					to {
						opacity: 1;
						transform: translateX(0);
					}
				}
				@keyframes slideInUp {
					from {
						opacity: 0;
						transform: translateY(10px);
					}
					to {
						opacity: 1;
						transform: translateY(0);
					}
				}
				@keyframes typing {
					0% { opacity: 0.3; }
					50% { opacity: 1; }
					100% { opacity: 0.3; }
				}
				@keyframes borderPulse {
					0%, 100% { border-color: rgba(16, 185, 129, 0.3); }
					50% { border-color: rgba(16, 185, 129, 0.8); }
				}
				@keyframes shimmer {
					0% { background-position: -200% 0; }
					100% { background-position: 200% 0; }
				}
				.sentinel-animate-in {
					animation: slideInUp 0.4s ease-out;
				}
				.sentinel-glow {
					animation: glow 2s ease-in-out infinite;
				}
				.sentinel-typing {
					animation: typing 1.5s ease-in-out infinite;
				}
				.sentinel-shimmer {
					background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
					background-size: 200% 100%;
					animation: shimmer 2s ease-in-out infinite;
				}
			`}</style>
		</div>
	)
}

export default SentinelWorkflowView
