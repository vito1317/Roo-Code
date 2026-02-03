/**
 * Agent Topology Canvas
 *
 * Visual representation of all agents in the Sentinel workflow.
 * Shows agent nodes, their states, and connections between them.
 * Follows Pencil design specs - linear flow layout.
 */
import React from "react"

// Agent configuration with Pencil design colors and default activities
// Use a single row linear flow to avoid overlapping connections
const AGENTS = [
	{ id: "ARCHITECT", label: "Architect", icon: "🔷", index: 0, color: "#10B981", defaultActivity: "分析需求與架構" },
	{ id: "DESIGNER", label: "Designer", icon: "🎨", index: 1, color: "#EC4899", defaultActivity: "設計 UI/UX" },
	{ id: "DESIGN_REVIEW", label: "Design Review", icon: "🔎", index: 2, color: "#F59E0B", defaultActivity: "審核設計" },
	{ id: "BUILDER", label: "Builder", icon: "🟩", index: 3, color: "#3B82F6", defaultActivity: "編寫程式碼" },
	{ id: "CODE_REVIEW", label: "Code Review", icon: "📝", index: 4, color: "#8B5CF6", defaultActivity: "審核程式碼" },
	{ id: "QA", label: "QA", icon: "🧪", index: 5, color: "#F59E0B", defaultActivity: "撰寫測試" },
	{ id: "TEST_REVIEW", label: "Test Review", icon: "✅", index: 6, color: "#22D3EE", defaultActivity: "審核測試" },
	{ id: "SENTINEL", label: "Sentinel", icon: "🛡️", index: 7, color: "#EF4444", defaultActivity: "監督與協調" },
	{ id: "FINAL_REVIEW", label: "Final Review", icon: "🏁", index: 8, color: "#10B981", defaultActivity: "最終審核" },
] as const

interface AgentNodeProps {
	agent: (typeof AGENTS)[number]
	status: "completed" | "active" | "pending"
	activity?: string
	x: number
	y: number
}

const AgentNode: React.FC<AgentNodeProps & { isStreaming?: boolean }> = ({ agent, status, activity, x, y, isStreaming = false }) => {
	const isActive = status === "active"
	const isCompleted = status === "completed"
	const displayActivity = activity || agent.defaultActivity
	// Only show animation when active AND streaming (actually running API request)
	const showAnimation = isActive && isStreaming

	return (
		<div
			className={showAnimation ? "agent-node-active" : ""}
			style={{
				position: "absolute",
				left: x,
				top: y,
				width: "120px",
				background: "#1E293B",
				borderRadius: "8px",
				overflow: "hidden",
				border: `2px solid ${isActive ? agent.color : isCompleted ? "#10B981" : "#475569"}`,
				opacity: status === "pending" ? 0.7 : 1,
				transition: "all 0.3s ease",
				boxShadow: isActive ? `0 0 16px ${agent.color}40` : "none",
				color: isActive ? agent.color : "inherit",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "4px 6px",
					background: isActive ? agent.color : isCompleted ? "#10B981" : "#0F172A",
				}}
			>
				<div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
					<span style={{ fontSize: "9px" }}>{agent.icon}</span>
					<span
						style={{
							fontFamily: "'Inter', sans-serif",
							fontSize: "8px",
							fontWeight: 600,
							color: isActive || isCompleted ? "#0A0F1C" : "#64748B",
						}}
					>
						{agent.label}
					</span>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "2px",
						padding: "1px 4px",
						borderRadius: "3px",
						background: isActive ? "rgba(255,255,255,0.9)" : isCompleted ? "#0A0F1C" : "#475569",
						fontFamily: "'JetBrains Mono', monospace",
						fontSize: "5px",
						fontWeight: 700,
						color: isActive ? agent.color : isCompleted ? "#10B981" : "#0A0F1C",
					}}
				>
					{isActive && (
						<span
							style={{
								width: "3px",
								height: "3px",
								background: agent.color,
								borderRadius: "50%",
								animation: "pulse 1.5s ease-in-out infinite",
							}}
						/>
					)}
					{isActive ? "ACTIVE" : isCompleted ? "✓" : "..."}
				</div>
			</div>

			{/* Body */}
			<div
				style={{
					padding: "4px 6px",
					minHeight: "20px",
				}}
			>
				<div
					style={{
						fontFamily: "'Inter', sans-serif",
						fontSize: "7px",
						color: isActive ? agent.color : isCompleted ? "#94A3B8" : "#475569",
						fontStyle: "italic",
						lineHeight: "1.2",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{displayActivity}
				</div>
			</div>
		</div>
	)
}

interface AgentTopologyCanvasProps {
	currentAgent: string
	completedAgents: string[]
	activities: Record<string, string>
	tasks: Record<string, string>
	isStreaming?: boolean
}

export const AgentTopologyCanvas: React.FC<AgentTopologyCanvasProps> = ({
	currentAgent,
	completedAgents,
	activities,
	isStreaming = false,
}) => {
	const getStatus = (agentId: string): "completed" | "active" | "pending" => {
		if (completedAgents.includes(agentId)) return "completed"
		if (currentAgent === agentId) return "active"
		return "pending"
	}

	// Layout: 2 rows with snake pattern
	// Row 0: ARCHITECT → DESIGNER → DESIGN_REVIEW → BUILDER → CODE_REVIEW
	// Row 1: QA ← TEST_REVIEW ← SENTINEL ← FINAL_REVIEW (reversed for snake)
	const NODE_WIDTH = 120
	const NODE_HEIGHT = 52
	const H_GAP = 15
	const V_GAP = 20
	const PADDING = 10

	const getNodePosition = (index: number) => {
		const row = index < 5 ? 0 : 1
		let col: number
		if (row === 0) {
			col = index
		} else {
			// Reverse order for row 1 to create snake pattern
			col = 4 - (index - 5)
		}
		return {
			x: PADDING + col * (NODE_WIDTH + H_GAP),
			y: PADDING + 30 + row * (NODE_HEIGHT + V_GAP),
		}
	}

	// Get connection line color based on status
	const getLineColor = (fromAgent: string, toAgent: string) => {
		const fromStatus = getStatus(fromAgent)
		const toStatus = getStatus(toAgent)
		if (fromStatus === "completed" && (toStatus === "completed" || toStatus === "active")) {
			return "#10B981"
		}
		return "#475569"
	}

	// Total width needed
	const totalWidth = PADDING * 2 + 5 * NODE_WIDTH + 4 * H_GAP

	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "200px",
				background: "#0A0F1C",
				borderRadius: "10px",
				overflow: "auto",
			}}
		>
			{/* Title */}
			<div
				style={{
					padding: "8px 12px",
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<span
					style={{
						color: "#64748B",
						fontFamily: "'JetBrains Mono', monospace",
						fontSize: "9px",
						letterSpacing: "1px",
					}}
				>
					TOPOLOGY
				</span>
				<span
					style={{
						color: "#475569",
						fontFamily: "'JetBrains Mono', monospace",
						fontSize: "8px",
					}}
				>
					Step {completedAgents.length + 1} • {currentAgent}
				</span>
			</div>

			{/* Canvas with nodes */}
			<div
				style={{
					position: "relative",
					width: `${totalWidth}px`,
					height: "160px",
					margin: "0 auto",
				}}
			>
				{/* Connection lines (SVG) */}
				<svg
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: "100%",
						height: "100%",
						pointerEvents: "none",
					}}
				>
					<defs>
						<marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
							<polygon points="0 0, 6 3, 0 6" fill="#475569" />
						</marker>
						<marker id="arrow-active" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
							<polygon points="0 0, 6 3, 0 6" fill="#10B981" />
						</marker>
					</defs>

					{/* Row 0 horizontal connections */}
					{[0, 1, 2, 3].map((i) => {
						const from = getNodePosition(i)
						const to = getNodePosition(i + 1)
						const fromAgent = AGENTS[i].id
						const toAgent = AGENTS[i + 1].id
						const lineColor = getLineColor(fromAgent, toAgent)
						return (
							<line
								key={`conn-${i}`}
								x1={from.x + NODE_WIDTH}
								y1={from.y + NODE_HEIGHT / 2 - 30}
								x2={to.x}
								y2={to.y + NODE_HEIGHT / 2 - 30}
								stroke={lineColor}
								strokeWidth="2"
								markerEnd={lineColor === "#10B981" ? "url(#arrow-active)" : "url(#arrow)"}
							/>
						)
					})}

					{/* Connection from CODE_REVIEW (index 4) to QA (index 5) - goes straight down */}
					{(() => {
						const from = getNodePosition(4)
						const to = getNodePosition(5)
						const lineColor = getLineColor("CODE_REVIEW", "QA")
						const isActive = lineColor === "#10B981"
						// Both are at col 4, so arrow goes straight down from CODE_REVIEW bottom to QA top
						const centerX = from.x + NODE_WIDTH / 2
						// Position arrow outside the nodes - from bottom of CODE_REVIEW to top of QA
						const startY = from.y + NODE_HEIGHT // Bottom edge of CODE_REVIEW node + gap
						const endY = to.y - 5 // Top edge of QA node (adjusted for node y offset)
						return (
							<line
								key="conn-4-5"
								x1={centerX}
								y1={startY}
								x2={centerX}
								y2={endY}
								stroke={lineColor}
								strokeWidth="2"
								markerEnd={isActive ? "url(#arrow-active)" : "url(#arrow)"}
							/>
						)
					})()}

					{/* Row 1 horizontal connections (right-to-left direction: from left side of current to right side of next) */}
					{[5, 6, 7].map((i) => {
						const from = getNodePosition(i)
						const to = getNodePosition(i + 1)
						const fromAgent = AGENTS[i].id
						const toAgent = AGENTS[i + 1].id
						const lineColor = getLineColor(fromAgent, toAgent)
						// Row 1 is reversed: higher index = further left
						// Arrow should go from left edge of 'from' node to right edge of 'to' node
						return (
							<line
								key={`conn-${i}`}
								x1={from.x}
								y1={from.y + NODE_HEIGHT / 2 - 30}
								x2={to.x + NODE_WIDTH}
								y2={to.y + NODE_HEIGHT / 2 - 30}
								stroke={lineColor}
								strokeWidth="2"
								markerEnd={lineColor === "#10B981" ? "url(#arrow-active)" : "url(#arrow)"}
							/>
						)
					})}
				</svg>

				{/* Agent Nodes */}
				{AGENTS.map((agent) => {
					const pos = getNodePosition(agent.index)
					return (
						<AgentNode
							key={agent.id}
							agent={agent}
							status={getStatus(agent.id)}
							activity={activities[agent.id]}
							x={pos.x}
							y={pos.y}
							isStreaming={agent.id === currentAgent && isStreaming}
						/>
					)
				})}
			</div>

			<style>{`
				@keyframes pulse {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.5; }
				}
				@keyframes activeGlow {
					0%, 100% { 
						box-shadow: 0 0 8px currentColor, 0 0 16px currentColor;
					}
					50% { 
						box-shadow: 0 0 16px currentColor, 0 0 32px currentColor, 0 0 48px currentColor;
					}
				}
				@keyframes borderPulse {
					0%, 100% { border-color: inherit; }
					50% { border-color: rgba(255,255,255,0.8); }
				}
				@keyframes dotBlink {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.3; }
				}
				.agent-node-active {
					animation: activeGlow 2s ease-in-out infinite;
				}
			`}</style>
		</div>
	)
}

export default AgentTopologyCanvas
