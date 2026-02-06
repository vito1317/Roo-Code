/**
 * Sentinel Workflow View
 *
 * Complete Sentinel mode visualization with workflow header,
 * agent topology canvas, and AI-to-AI conversation panel.
 * Follows Pencil design specs.
 */
import React, { useMemo, useCallback, useRef, useEffect } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AgentTopologyCanvas } from "./AgentTopologyCanvas"
import { ApiConfigSelector } from "./ApiConfigSelector"
import { UIDesignCanvasPreview } from "./UIDesignCanvasPreview"
import { vscode } from "@src/utils/vscode"

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

// Agent colors - support both uppercase and mixed-case names
const AGENT_COLORS: Record<string, string> = {
	// Uppercase (from workflow stages)
	ARCHITECT: "#10B981",
	DESIGNER: "#EC4899",
	DESIGN_REVIEW: "#F59E0B",
	BUILDER: "#3B82F6",
	CODE_REVIEW: "#8B5CF6",
	QA: "#F59E0B",
	TEST_REVIEW: "#22D3EE",
	SENTINEL: "#EF4444",
	FINAL_REVIEW: "#10B981",
	// Mixed-case (from handoff display names)
	"Architect": "#10B981",
	"Architect (Code Review)": "#8B5CF6",
	"Architect (Test Review)": "#22D3EE",
	"Architect (Final Review)": "#10B981",
	"Designer": "#EC4899",
	"Design Review": "#F59E0B",
	"Builder": "#3B82F6",
	"Code Review": "#8B5CF6",
	"Test Review": "#22D3EE",
	"Sentinel": "#EF4444",
	"Final Review": "#10B981",
	"Idle": "#64748B",
	"Completed": "#10B981",
	"Blocked": "#EF4444",
	"Unknown": "#64748B",
}

interface SentinelWorkflowViewProps {
	className?: string
}

export const SentinelWorkflowView: React.FC<SentinelWorkflowViewProps> = ({
	className,
}) => {
		const { 
			sentinelAgentState, 
			clineMessages, 
			apiConfiguration,
			listApiConfigMeta,
			currentApiConfigName,
			pinnedApiConfigs,
			togglePinnedApiConfig,
		} = useExtensionState()

	// Get current agent and state - default to ARCHITECT if no agent set
	// Map special agent names to their display equivalents
	const rawAgent = sentinelAgentState?.currentAgent || "ARCHITECT"
	
	// Agent name mapping for display in topology
	const AGENT_MAPPING: Record<string, string> = {
		"ARCHITECT_REVIEW": "ARCHITECT", // Architect reviewing goes back to ARCHITECT display
		"sentinel-architect": "ARCHITECT",
		"sentinel-designer": "DESIGNER", 
		"sentinel-builder": "BUILDER",
		"sentinel-qa": "QA",
		"sentinel-architect-review": "DESIGN_REVIEW", // Maps to nearest review stage
	}
	
	const currentAgent = AGENT_MAPPING[rawAgent] || rawAgent
	const activity = sentinelAgentState?.currentActivity || "正在分析需求與設計架構..."
	
	// Use actual handoff data from state - no hardcoded fallback
	const handoff = sentinelAgentState?.lastHandoff || null

	// Detect if currently streaming (last message is partial/streaming)
	const isStreaming = useMemo(() => {
		if (!clineMessages || clineMessages.length === 0) return false
		const lastMsg = clineMessages[clineMessages.length - 1]
		return lastMsg?.partial === true || lastMsg?.type === "say"
	}, [clineMessages])

	// Get streaming content (last say message text)
	const streamingContent = useMemo(() => {
		if (!clineMessages || clineMessages.length === 0) return ""
		// Find the last "say" message with text
		for (let i = clineMessages.length - 1; i >= 0; i--) {
			const msg = clineMessages[i]
			if (msg.type === "say" && msg.say === "text" && msg.text) {
				return msg.text
			}
		}
		return ""
	}, [clineMessages])

	// Get recent messages for display (last 20)
	const recentMessages = useMemo(() => {
		if (!clineMessages || clineMessages.length === 0) return []
		return clineMessages.slice(-20)
	}, [clineMessages])

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
	
	// Helper function to detect agent from message content (defined early for useMemo)
	const detectAgentFromContent = useCallback((text: string): string => {
		const lowerText = text.toLowerCase()
		// Check for explicit agent mentions in the text
		if (lowerText.includes("**architect") || lowerText.includes("architect:") || lowerText.includes("架構師")) return "ARCHITECT"
		if (lowerText.includes("**designer") || lowerText.includes("designer:") || lowerText.includes("設計師")) return "DESIGNER"
		if (lowerText.includes("**design review") || lowerText.includes("design_review") || lowerText.includes("設計審核")) return "DESIGN_REVIEW"
		if (lowerText.includes("**builder") || lowerText.includes("builder:") || lowerText.includes("建置者")) return "BUILDER"
		if (lowerText.includes("**code review") || lowerText.includes("code_review") || lowerText.includes("程式碼審核")) return "CODE_REVIEW"
		if (lowerText.includes("**qa") || lowerText.includes("qa:") || lowerText.includes("品質保證")) return "QA"
		if (lowerText.includes("**test review") || lowerText.includes("test_review") || lowerText.includes("測試審核")) return "TEST_REVIEW"
		if (lowerText.includes("**sentinel") || lowerText.includes("sentinel:") || lowerText.includes("哨兵")) return "SENTINEL"
		if (lowerText.includes("**final review") || lowerText.includes("final_review") || lowerText.includes("最終審核")) return "FINAL_REVIEW"
		// Default to currentAgent if no specific agent detected
		return currentAgent
	}, [currentAgent])
	
	// Extract agent activities from recent messages for topology display
	const agentActivities = useMemo(() => {
		const activities: Record<string, string> = {}
		if (!clineMessages || clineMessages.length === 0) return activities
		
		// Scan messages to find activities for each agent
		clineMessages.slice(-50).forEach((msg: any) => {
			const text = (msg.text || "").toLowerCase()
			const agent = detectAgentFromContent(text)
			
			// Detect file operations
			if (text.includes("read_file") || text.includes("reading file") || text.includes("讀取")) {
				const fileMatch = text.match(/(?:read_file|reading|讀取)[^\n]*?([a-zA-Z0-9_.-]+\.(ts|tsx|js|md|json))/i)
				activities[agent] = `📖 讀取 ${fileMatch ? fileMatch[1] : "檔案"}`
			} else if (text.includes("write_to_file") || text.includes("creating") || text.includes("創建") || text.includes("write")) {
				const fileMatch = text.match(/(?:write_to_file|creating|創建|write)[^\n]*?([a-zA-Z0-9_.-]+\.(ts|tsx|js|md|json))/i)
				activities[agent] = `📝 創建 ${fileMatch ? fileMatch[1] : "檔案"}`
			} else if (text.includes("edit") || text.includes("replace") || text.includes("修改")) {
				activities[agent] = "✏️ 編輯檔案"
			} else if (text.includes("run_command") || text.includes("執行") || text.includes("npm") || text.includes("pnpm")) {
				activities[agent] = "⚡ 執行命令"
			} else if (text.includes("plan") || text.includes("計劃") || text.includes("規劃")) {
				activities[agent] = "📋 規劃任務"
			} else if (text.includes("test") || text.includes("測試")) {
				activities[agent] = "🧪 執行測試"
			} else if (text.includes("review") || text.includes("審核")) {
				activities[agent] = "🔍 審核中"
			}
		})
		
		// Make sure current agent always has an activity
		if (!activities[currentAgent]) {
			activities[currentAgent] = activity
		}
		
		return activities
	}, [clineMessages, currentAgent, activity, detectAgentFromContent])

	// Current agent color
	const agentColor = AGENT_COLORS[currentAgent] || "#475569"

	// Parse AI-to-AI conversation from message text
	// Detects patterns like "💬 **agent-name 問：**" and "🤖 **Agent AI 回覆：**"
	interface AIConversation {
		hasQA: boolean
		asker: string
		askerContent: string
		responder: string
		responderContent: string
	}
	
	const parseAIConversation = useCallback((text: string): AIConversation => {
		// Default empty structure
		const empty: AIConversation = {
			hasQA: false,
			asker: "",
			askerContent: "",
			responder: "",
			responderContent: ""
		}
		
		if (!text) return empty
		
		// Pattern 1: 💬 **agent 問：** ... 🤖 **Agent AI 回覆：**
		const questionPattern = /💬\s*\*\*([^*]+)\s*問[：:]\*\*\s*>?\s*(.+?)(?=🤖|\*\*.*回覆|$)/s
		const responsePattern = /🤖\s*\*\*([^*]+)\s*(?:AI\s*)?回覆[：:]\*\*\s*(.+?)$/s
		
		// Pattern 2: sentinel-xxx-review format
		const sentinelQuestionPattern = /(?:\*\*)?sentinel-([a-z-]+)(?:-review)?\s*問[：:](?:\*\*)?\s*>?\s*(.+?)(?=🤖|\*\*.*回覆|$)/si
		
		// Pattern 3: **Agent**: or 【Agent】format
		const agentPrefixPattern = /(?:\*\*|【)([A-Za-z_\s]+)(?:\*\*|】)[:\s]*(.+)/s
		
		// Pattern 4: Handoff from/to patterns
		const handoffFromPattern = /(?:from|由|來自)[\s:]*\*?\*?([A-Za-z_]+)\*?\*?/i
		const handoffToPattern = /(?:to|至|移交)[\s:]*\*?\*?([A-Za-z_]+)\*?\*?/i
		
		const questionMatch = text.match(questionPattern) || text.match(sentinelQuestionPattern)
		const responseMatch = text.match(responsePattern)
		
		if (questionMatch && responseMatch) {
			return {
				hasQA: true,
				asker: questionMatch[1].trim(),
				askerContent: questionMatch[2].trim(),
				responder: responseMatch[1].trim(),
				responderContent: responseMatch[2].trim()
			}
		}
		
		// Check for simpler patterns
		const simpleQuestionPattern = /\*\*([^*]+)\*\*[^:]*[問asking][：:]/i
		const simpleResponsePattern = /\*\*([^*]+)\*\*[^:]*[回覆response][：:]/i
		
		const simpleQ = text.match(simpleQuestionPattern)
		const simpleR = text.match(simpleResponsePattern)
		
		if (simpleQ || simpleR) {
			return {
				hasQA: true,
				asker: simpleQ?.[1]?.trim() || "Agent",
				askerContent: text.split("回覆")[0] || text.substring(0, 200),
				responder: simpleR?.[1]?.trim() || "Architect",
				responderContent: text.split("回覆")[1] || ""
			}
		}
		
		// Check for agent prefix pattern (e.g., **Builder**: I have a question...)
		const agentMatch = text.match(agentPrefixPattern)
		if (agentMatch && (text.includes("?") || text.includes("？") || text.includes("問"))) {
			return {
				hasQA: true,
				asker: agentMatch[1].trim(),
				askerContent: agentMatch[2].trim().substring(0, 300),
				responder: "",
				responderContent: ""
			}
		}
		
		// Check for handoff patterns
		const fromMatch = text.match(handoffFromPattern)
		const toMatch = text.match(handoffToPattern)
		if (fromMatch && toMatch) {
			return {
				hasQA: true,
				asker: fromMatch[1].trim(),
				askerContent: text.substring(0, 200),
				responder: toMatch[1].trim(),
				responderContent: ""
			}
		}
		
		return empty
	}, [])
	
	// Map agent slug to display name & color
	const getAgentDisplayInfo = useCallback((slug: string): { name: string; color: string; icon: string } => {
		if (!slug || slug.trim() === "") {
			return { name: "Unknown", color: "#64748B", icon: "❓" }
		}
		const normalized = slug.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_")
		// Generic "agent" should not match anything and use current agent
		if (normalized === "agent" || normalized === "agent_agent") {
			return { name: currentAgent, color: AGENT_COLORS[currentAgent] || "#64748B", icon: "🤖" }
		}
		if (normalized.includes("architect") && (normalized.includes("code") || normalized.includes("review_code"))) return { name: "Architect (Code Review)", color: "#8B5CF6", icon: "�" }
		if (normalized.includes("architect") && (normalized.includes("test") || normalized.includes("review_test"))) return { name: "Architect (Test Review)", color: "#22D3EE", icon: "🧪" }
		if (normalized.includes("architect") && (normalized.includes("final") || normalized.includes("review_final"))) return { name: "Architect (Final Review)", color: "#10B981", icon: "🏁" }
		if (normalized.includes("architect")) return { name: "Architect", color: "#10B981", icon: "🔷" }
		if (normalized.includes("designer")) return { name: "Designer", color: "#EC4899", icon: "🎨" }
		if (normalized.includes("design") && normalized.includes("review")) return { name: "Design Review", color: "#F59E0B", icon: "🔎" }
		if (normalized.includes("builder")) return { name: "Builder", color: "#3B82F6", icon: "�" }
		if (normalized.includes("qa") || normalized.includes("engineer")) return { name: "QA", color: "#F59E0B", icon: "🧪" }
		if (normalized.includes("sentinel")) return { name: "Sentinel", color: "#EF4444", icon: "🛡️" }
		if (normalized.includes("code") && normalized.includes("review")) return { name: "Code Review", color: "#8B5CF6", icon: "�" }
		if (normalized.includes("test") && normalized.includes("review")) return { name: "Test Review", color: "#22D3EE", icon: "✅" }
		if (normalized.includes("final") && normalized.includes("review")) return { name: "Final Review", color: "#10B981", icon: "🏁" }
		// Fallback: use the current agent instead of the unknown slug
		return { name: currentAgent, color: AGENT_COLORS[currentAgent] || "#64748B", icon: "💬" }
	}, [currentAgent])
	
	// Ref for auto-scrolling messages container
	const messagesContainerRef = useRef<HTMLDivElement>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)
	
	// Auto-scroll to bottom when new messages arrive
	useEffect(() => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
		}
	}, [recentMessages, streamingContent])

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
					{/* API Config Profile Selector */}
				<ApiConfigSelector
					value={(() => {
						const currentConfig = listApiConfigMeta?.find((config) => config.name === currentApiConfigName)
						return currentConfig?.id || ""
					})()}
					displayName={currentApiConfigName || apiConfiguration?.apiModelId || "設定檔"}
					title="選擇 API 設定檔"
					disabled={false}
					onChange={(configId) => {
						// configId is the ID, not the name - use the correct message type
						vscode.postMessage({ type: "loadApiConfigurationById", text: configId })
					}}
					listApiConfigMeta={listApiConfigMeta || []}
					pinnedApiConfigs={pinnedApiConfigs}
					togglePinnedApiConfig={togglePinnedApiConfig}
				/>

					{/* Show simple model display when no configs available */}
					{(!listApiConfigMeta || listApiConfigMeta.length === 0) && apiConfiguration?.apiModelId && (
						<div
							style={{
								padding: "4px 10px",
								borderRadius: "4px",
								background: "#1E293B",
								fontFamily: "'JetBrains Mono', monospace",
								fontSize: "10px",
								color: "#94A3B8",
							}}
						>
							🤖 {apiConfiguration.apiModelId}
						</div>
					)}

					{/* Control buttons - show Cancel when streaming, Continue when not */}
					{isStreaming ? (
						<button
							onClick={() => {
								vscode.postMessage({ type: "cancelTask" })
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
					) : (
						<button
							onClick={() => {
								vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
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
					)}

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
					// Hide scrollbar while maintaining scroll functionality
					scrollbarWidth: "none", // Firefox
					msOverflowStyle: "none", // IE/Edge
				}}
				className="hide-scrollbar"
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
						activities={agentActivities}
						tasks={{}}
						isStreaming={isStreaming}
					/>
					
					{/* UI Design Preview - Shows when Designer is active */}
					{(currentAgent === "DESIGNER" || currentAgent === "DESIGN_REVIEW") && (
						<div
							style={{
								marginTop: "12px",
								background: "#1E293B",
								borderRadius: "12px",
								border: "1px solid rgba(236, 72, 153, 0.3)",
								padding: "12px",
								minHeight: "200px",
								maxHeight: "400px",
								overflowY: "auto",
							}}
						>
							{/* Header */}
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									marginBottom: "10px",
								}}
							>
								<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
									<span style={{ fontSize: "14px" }}>🎨</span>
									<span
										style={{
											color: "#EC4899",
											fontFamily: "'Inter', sans-serif",
											fontSize: "12px",
											fontWeight: 600,
										}}
									>
										UI Design Canvas
									</span>
								</div>
								<span
									style={{
										padding: "3px 8px",
										borderRadius: "100px",
										background: "rgba(236, 72, 153, 0.2)",
										color: "#EC4899",
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "9px",
									}}
								>
									{currentAgent === "DESIGN_REVIEW" ? "REVIEWING" : "DESIGNING"}
								</span>
							</div>
							
							{/* UIDesignCanvasPreview Component */}
							<UIDesignCanvasPreview />
						</div>
					)}
				</div>

				{/* AI-to-AI Conversation Panel */}
				<div
					style={{
						flex: "1 1 35%",
						minWidth: "280px",
						maxHeight: "400px", // Fixed height for independent scrolling
						background: "#1E293B",
						borderRadius: "12px",
						padding: "12px",
						border: "1px solid rgba(71, 85, 105, 0.3)",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
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

					{/* Pencil-Style Agent Status Indicators */}
					<div style={{ display: "flex", gap: "12px", marginBottom: "12px", justifyContent: handoff ? "flex-start" : "center" }}>
						{/* Show Asking Agent Status ONLY when there's a handoff (AI-to-AI) */}
						{handoff && (
							<div
								style={{
									flex: 1,
									padding: "10px 12px",
									borderRadius: "8px",
									background: "#0F172A",
									border: `1px solid ${AGENT_COLORS[handoff.from] || "#3B82F6"}`,
								}}
							>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
									<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
										<span style={{ fontSize: "12px" }}>🟦</span>
										<span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, color: AGENT_COLORS[handoff.from] || "#3B82F6" }}>
											{handoff.from}
										</span>
									</div>
									<span style={{
										padding: "2px 8px",
										borderRadius: "100px",
										background: "#F59E0B",
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "8px",
										fontWeight: 700,
										color: "#0A0F1C",
									}}>ASKING</span>
								</div>
								<div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", color: "#64748B", marginTop: "4px" }}>
									State: WAITING_FOR_ANSWER
								</div>
							</div>
						)}
						
						{/* Current Agent Status - always shown */}
						<div
							style={{
								flex: handoff ? 1 : "0 1 auto",
								minWidth: handoff ? undefined : "200px",
								padding: "10px 12px",
								borderRadius: "8px",
								background: "#0F172A",
								border: `1px solid ${agentColor}`,
							}}
						>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
								<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
									<span style={{ fontSize: "12px" }}>🟢</span>
									<span style={{ fontFamily: "'Inter', sans-serif", fontSize: "11px", fontWeight: 600, color: handoff ? AGENT_COLORS[handoff.to] || agentColor : agentColor }}>
										{handoff ? handoff.to : currentAgent}
									</span>
								</div>
								<span style={{
									padding: "2px 8px",
									borderRadius: "100px",
									background: handoff ? "#10B981" : "#3B82F6",
									fontFamily: "'JetBrains Mono', monospace",
									fontSize: "8px",
									fontWeight: 700,
									color: "#0A0F1C",
								}}>{handoff ? "RESPONDING" : "ACTIVE"}</span>
							</div>
							<div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", color: "#64748B", marginTop: "4px" }}>
								State: {handoff ? "ANSWERING_QUESTION" : "PROCESSING"}
							</div>
						</div>
					</div>

					{/* Pencil-Style Vertical Message Stack */}
					<div ref={messagesContainerRef} style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", paddingRight: "4px" }}>
						{/* Asking Agent Message Card */}
						{handoff && handoff.summary && (
							<div style={{
								background: "#0F172A",
								borderRadius: "10px",
								border: `2px solid ${AGENT_COLORS[handoff.from] || "#3B82F6"}`,
								overflow: "hidden",
							}}>
								{/* Header */}
								<div style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									padding: "10px 14px",
									background: `linear-gradient(135deg, ${AGENT_COLORS[handoff.from] || "#3B82F6"}20, ${AGENT_COLORS[handoff.from] || "#3B82F6"}10)`,
									borderBottom: `1px solid ${AGENT_COLORS[handoff.from] || "#3B82F6"}30`,
								}}>
									<span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", fontWeight: 600, color: AGENT_COLORS[handoff.from] || "#3B82F6" }}>
										{handoff.from}
									</span>
									<span style={{
										padding: "3px 10px",
										borderRadius: "6px",
										background: "rgba(139, 92, 246, 0.2)",
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "9px",
										fontWeight: 600,
										color: "#A78BFA",
									}}>ask_followup_question</span>
								</div>
								{/* Content */}
								<div style={{ padding: "14px" }}>
									<div style={{
										fontFamily: "'Inter', sans-serif",
										fontSize: "12px",
										color: AGENT_COLORS[handoff.from] || "#3B82F6",
										marginBottom: "8px",
										fontWeight: 600,
									}}>? 關於實現的問題：</div>
									<div style={{
										fontFamily: "'Inter', sans-serif",
										fontSize: "12px",
										color: "#E2E8F0",
										lineHeight: "1.7",
										whiteSpace: "pre-wrap",
									}}>
										{handoff.summary}
									</div>
								</div>
							</div>
						)}
						
					{/* API Request Loading Indicator - shows when streaming but no content yet */}
						{isStreaming && !streamingContent && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "8px",
									padding: "12px",
									borderRadius: "8px",
									background: "rgba(16, 185, 129, 0.1)",
									border: "1px solid rgba(16, 185, 129, 0.3)",
								}}
							>
								<div
									style={{
										width: "8px",
										height: "8px",
										borderRadius: "50%",
										background: "#10B981",
										animation: "pulse 1s ease-in-out infinite",
									}}
								/>
								<span style={{ color: "#10B981", fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 500 }}>
									API 請求中...
								</span>
							</div>
						)}
					</div>
					{/* Recent Messages with SSE Streaming Integration */}
					<div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", paddingRight: "4px" }}>
				{(() => {
					// Pre-calculate the last ask message index for button activation
					const messagesSlice = recentMessages.slice(-10)
					const lastAskIndex = messagesSlice.map((m: any, i: number) => m.type === "ask" ? i : -1).filter((i: number) => i >= 0).pop() ?? -1
					
					return messagesSlice.map((msg: any, idx: number) => {
					const text = msg.text || ""
					if (!text.trim()) return null
					
					// Check if this ask message is the LAST (active) one
					const isLastAskMessage = msg.type === "ask" && idx === lastAskIndex
					
					// Check if this is the last message and it's streaming (partial)
					const isLastMessage = idx === recentMessages.slice(-10).length - 1
					const isPartialMessage = msg.partial === true
					const isCurrentlyStreaming = isLastMessage && isPartialMessage && isStreaming

					// Skip JSON config messages (starts with { and contains common config keys)
					const trimmedText = text.trim()
					if (trimmedText.startsWith("{") && (
						trimmedText.includes('"apiProtocol"') ||
						trimmedText.includes('"tokensIn"') ||
						trimmedText.includes('"cacheWrites"') ||
						trimmedText.includes('"cacheReads"') ||
						trimmedText.includes('"cost"')
					)) {
						return null
					}
					
						// Detect error messages
					const isError = trimmedText.includes("Error") || 
						trimmedText.includes("error") ||
						trimmedText.includes("failed") ||
						trimmedText.includes("FAILED") ||
						trimmedText.includes("ERR_")
					
						// Detect ask type messages (AI requesting user action)
					const isAskMessage = msg.type === "ask"
					const askType = msg.ask // e.g., "tool", "followup", "command", etc.
					
					// Clean up display text early for use in ask messages and regular messages
					const displayText = trimmedText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
					
					// Render ask messages with Pencil-style UI
					if (isAskMessage) {
						return (
							<div key={msg.ts || idx} style={{
								padding: "16px",
								borderRadius: "12px",
								background: "linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)",
								border: "1px solid rgba(139, 92, 246, 0.4)",
								backdropFilter: "blur(8px)",
							}}>
								{/* Header with icon */}
								<div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
									<div style={{
										width: "32px",
										height: "32px",
										borderRadius: "50%",
										background: "linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: "14px",
									}}>
										💬
									</div>
									<div>
										<div style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 600, color: "#A78BFA" }}>
											{currentAgent} 請求確認
										</div>
										<div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "#94A3B8" }}>
											{askType === "tool" ? "工具執行請求" : 
											 askType === "followup" ? "跟進問題" : 
											 askType === "command" ? "命令執行" : "等待回應"}
										</div>
									</div>
								</div>
								
								{/* Content */}
								<div style={{
									fontFamily: "'Inter', sans-serif",
									fontSize: "11px",
									color: "#E2E8F0",
									lineHeight: "1.6",
									padding: "10px",
									borderRadius: "8px",
									background: "rgba(0, 0, 0, 0.2)",
									marginBottom: "12px",
									maxHeight: "150px",
									overflowY: "auto",
								}}>
									{displayText}
								</div>
								
								{/* Quick action buttons - only active for the LAST ask message */}
								{isLastAskMessage ? (
									<div style={{ display: "flex", gap: "8px" }}>
										<button
											onClick={() => {
												console.log("[SentinelWorkflowView] Tool APPROVE button clicked, sending askResponse yesButtonClicked")
												vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
											}}
											style={{
												flex: 1,
												padding: "8px 12px",
												borderRadius: "6px",
												background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
												border: "none",
												cursor: "pointer",
												fontFamily: "'Inter', sans-serif",
												fontSize: "10px",
												fontWeight: 600,
												color: "#FFFFFF",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												gap: "4px",
											}}
										>
											✓ 允許
										</button>
										<button
											onClick={() => {
												console.log("[SentinelWorkflowView] Tool REJECT button clicked, sending askResponse noButtonClicked")
												vscode.postMessage({ type: "askResponse", askResponse: "noButtonClicked" })
											}}
											style={{
												flex: 1,
												padding: "8px 12px",
												borderRadius: "6px",
												background: "rgba(239, 68, 68, 0.2)",
												border: "1px solid rgba(239, 68, 68, 0.4)",
												cursor: "pointer",
												fontFamily: "'Inter', sans-serif",
												fontSize: "10px",
												fontWeight: 600,
												color: "#F87171",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												gap: "4px",
											}}
										>
											✕ 拒絕
										</button>
									</div>
								) : (
									<div style={{
										padding: "8px 12px",
										borderRadius: "6px",
										background: "rgba(100, 116, 139, 0.2)",
										border: "1px solid rgba(100, 116, 139, 0.3)",
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "9px",
										color: "#64748B",
										textAlign: "center",
									}}>
										已處理
									</div>
								)}
							</div>
						)
					}
					
					// Detect AI-to-AI Q&A conversations and render as dual-card
					const aiConversation = parseAIConversation(text)
					if (aiConversation.hasQA) {
						const askerInfo = getAgentDisplayInfo(aiConversation.asker)
						const responderInfo = getAgentDisplayInfo(aiConversation.responder)
						return (
							<div key={msg.ts || idx} style={{
								display: "flex",
								flexDirection: "column",
								gap: "12px",
								marginBottom: "12px",
							}}>
								{/* Asker Card (ASKING) */}
								<div style={{
									flex: 1,
									background: "#0F172A",
									borderRadius: "12px",
									border: `2px solid ${askerInfo.color}`,
									overflow: "hidden",
								}}>
									<div style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										padding: "10px 12px",
										background: `linear-gradient(135deg, ${askerInfo.color}20, ${askerInfo.color}10)`,
										borderBottom: `1px solid ${askerInfo.color}30`,
									}}>
										<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
											<span style={{ fontSize: "16px" }}>{askerInfo.icon}</span>
											<span style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 600, color: askerInfo.color }}>
												{askerInfo.name}
											</span>
										</div>
										<span style={{
											padding: "3px 8px",
											borderRadius: "100px",
											background: "#F59E0B20",
											color: "#F59E0B",
											fontFamily: "'JetBrains Mono', monospace",
											fontSize: "8px",
											fontWeight: 600,
										}}>ASKING</span>
									</div>
									<div style={{ padding: "12px" }}>
										<div style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "12px",
											color: askerInfo.color,
											marginBottom: "8px",
											fontWeight: 600,
										}}>? 提問</div>
										<div style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "11px",
											color: "#E2E8F0",
											lineHeight: "1.6",
											maxHeight: "120px",
											overflowY: "auto",
										}}>
											{aiConversation.askerContent.substring(0, 300)}{aiConversation.askerContent.length > 300 ? "..." : ""}
										</div>
									</div>
								</div>
								
								{/* Responder Card (RESPONDING) */}
								<div style={{
									flex: 1,
									background: "#0F172A",
									borderRadius: "12px",
									border: `2px solid ${responderInfo.color}`,
									overflow: "hidden",
								}}>
									<div style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										padding: "10px 12px",
										background: `linear-gradient(135deg, ${responderInfo.color}20, ${responderInfo.color}10)`,
										borderBottom: `1px solid ${responderInfo.color}30`,
									}}>
										<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
											<span style={{ fontSize: "16px" }}>{responderInfo.icon}</span>
											<span style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 600, color: responderInfo.color }}>
												{responderInfo.name}
											</span>
										</div>
										<span style={{
											padding: "3px 8px",
											borderRadius: "100px",
											background: "#10B98120",
											color: "#10B981",
											fontFamily: "'JetBrains Mono', monospace",
											fontSize: "8px",
											fontWeight: 600,
										}}>RESPONDING</span>
									</div>
									<div style={{ padding: "12px" }}>
										<div style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "12px",
											color: responderInfo.color,
											marginBottom: "8px",
											fontWeight: 600,
										}}>💬 回覆</div>
										<div style={{
											fontFamily: "'Inter', sans-serif",
											fontSize: "11px",
											color: "#E2E8F0",
											lineHeight: "1.6",
											maxHeight: "120px",
											overflowY: "auto",
										}}>
											{aiConversation.responderContent.substring(0, 300)}{aiConversation.responderContent.length > 300 ? "..." : ""}
										</div>
									</div>
								</div>
							</div>
						)
					}
					
					// Detect file operations (write_to_file)
					const fileWriteMatch = text.match(/write_to_file[^]*?(?:path|file)[:\s]*[`"']?([^\s`"'<>]+\.(ts|tsx|js|jsx|md|json|vue|css|html|py))[`"']?/i)
					const fileCreateMatch = text.match(/(?:created|創建|建立)[^]*?(?:file|檔案)?[:\s]*[`"']?([^\s`"'<>]+\.(ts|tsx|js|jsx|md|json|vue|css|html|py))[`"']?/i)
					const detectedFile = fileWriteMatch?.[1] || fileCreateMatch?.[1]
					
					if (detectedFile) {
						return (
							<div key={msg.ts || idx} style={{
								padding: "12px",
								borderRadius: "10px",
								background: "linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)",
								border: "1px solid rgba(16, 185, 129, 0.4)",
								display: "flex",
								alignItems: "center",
								gap: "12px",
							}}>
								<div style={{
									width: "36px",
									height: "36px",
									borderRadius: "8px",
									background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "18px",
								}}>📄</div>
								<div>
									<div style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 600, color: "#10B981" }}>
										檔案已建立
									</div>
									<div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "#E2E8F0", marginTop: "2px" }}>
										{detectedFile}
									</div>
								</div>
								<div style={{
									marginLeft: "auto",
									padding: "4px 10px",
									borderRadius: "6px",
									background: "rgba(16, 185, 129, 0.2)",
									fontFamily: "'JetBrains Mono', monospace",
									fontSize: "9px",
									color: "#10B981",
								}}>✓ CREATED</div>
							</div>
						)
					}
					
					// Detect USER messages (user_feedback) - render with USER styling
					const isUserMessage = msg.type === "say" && msg.say === "user_feedback"
					if (isUserMessage && displayText) {
						return (
							<div key={msg.ts || idx} style={{
								padding: "12px 16px",
								borderRadius: "10px",
								background: "linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(99, 102, 241, 0.1) 100%)",
								border: "1px solid rgba(59, 130, 246, 0.4)",
								marginLeft: "20px",
							}}>
								<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
									<span style={{ fontSize: "14px" }}>👤</span>
									<span style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", fontWeight: 600, color: "#3B82F6" }}>
										USER
									</span>
								</div>
								<div style={{
									fontFamily: "'Inter', sans-serif",
									fontSize: "11px",
									color: "#E2E8F0",
									lineHeight: "1.5",
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
								}}>
									{displayText}
								</div>
							</div>
						)
					}
					
					// Skip non-error SYSTEM messages
					const isAI = msg.type === "say" && msg.say === "text"
					if (!isAI && !isError) return null
					
					// For streaming messages, show full content; for completed, truncate
					let truncatedDisplayText = displayText
					if (!isCurrentlyStreaming) {
						truncatedDisplayText = displayText.length > 200 ? displayText.substring(0, 200) + "..." : displayText
					}
					
					// Streaming message style - use agent color background
					if (isCurrentlyStreaming) {
						return (
							<div key={msg.ts || idx} style={{ 
								padding: "10px", 
								borderRadius: "8px", 
								background: agentColor,
								border: `2px solid ${agentColor}`,
								animation: "borderPulse 1.5s ease-in-out infinite",
							}}>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
									<span style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", fontWeight: 600, color: "#0A0F1C" }}>
										{currentAgent}
									</span>
									<span style={{ 
										display: "flex", 
										alignItems: "center", 
										gap: "4px", 
										fontFamily: "'JetBrains Mono', monospace", 
										fontSize: "8px", 
										color: "rgba(0,0,0,0.6)",
									}}>
										<span style={{ 
											width: "4px", 
											height: "4px", 
											borderRadius: "50%", 
											background: "#0A0F1C",
											animation: "pulse 0.8s ease-in-out infinite",
										}} />
										STREAMING
									</span>
								</div>
								<div style={{ 
									fontFamily: "'Inter', sans-serif", 
									fontSize: "11px", 
									color: "#0A0F1C", 
									lineHeight: "1.5",
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									maxHeight: "300px",
									overflowY: "auto",
								}}>
									{displayText}
									<span style={{ 
										display: "inline-block",
										width: "2px",
										height: "14px",
										background: "#0A0F1C",
										marginLeft: "2px",
										animation: "pulse 0.5s ease-in-out infinite",
									}} />
								</div>
							</div>
						)
					}
					
					// Regular completed message style
					return (
						<div key={msg.ts || idx} style={{ 
							padding: "8px", 
							borderRadius: "6px", 
							background: isError ? "rgba(239, 68, 68, 0.1)" : (isAI ? "rgba(16, 185, 129, 0.1)" : "#1E293B"), 
							border: isError ? "1px solid rgba(239, 68, 68, 0.3)" : (isAI ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid #334155") 
						}}>
							<div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", color: isError ? "#EF4444" : (isAI ? "#10B981" : "#64748B"), marginBottom: "4px" }}>
								{isError ? "⚠ ERROR" : (isAI ? detectAgentFromContent(text) : "SYSTEM")}
							</div>
							<div style={{ fontFamily: "'Inter', sans-serif", fontSize: "10px", color: isError ? "#F87171" : "#94A3B8", lineHeight: "1.4", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
								{truncatedDisplayText}
							</div>
						</div>
					)
				})})()} 
					{/* Scroll anchor for auto-scroll to bottom */}
					<div ref={messagesEndRef} />
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
				.hide-scrollbar::-webkit-scrollbar {
					display: none;
				}
				.hide-scrollbar {
					-ms-overflow-style: none;
					scrollbar-width: none;
				}
			`}</style>
		</div>
	)
}

export default SentinelWorkflowView
