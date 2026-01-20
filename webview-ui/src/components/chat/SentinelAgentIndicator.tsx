/**
 * Sentinel Agent Indicator
 *
 * Displays the current active Sentinel agent during FSM workflow.
 * Shows visual states for each agent with appropriate colors, icons, and status messages.
 */
import React from "react"
import { cn } from "@/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Agent state configuration with colors, icons, labels, and status messages
const AGENT_CONFIG = {
	IDLE: {
		borderColor: "border-gray-500/30",
		bgColor: "bg-gray-500/10",
		textColor: "text-gray-400",
		icon: "⚪",
		label: "Idle",
		statusMessage: "",
		spinning: false,
	},
	ARCHITECT: {
		borderColor: "border-blue-500/50",
		bgColor: "bg-blue-500/10",
		textColor: "text-blue-400",
		icon: "🟦",
		label: "Architect",
		statusMessage: "📐 Designing architecture...",
		spinning: false,
	},
	BUILDER: {
		borderColor: "border-green-500/50",
		bgColor: "bg-green-500/10",
		textColor: "text-green-400",
		icon: "🟩",
		label: "Builder",
		statusMessage: "🔨 Building implementation...",
		spinning: false,
	},
	ARCHITECT_REVIEW: {
		borderColor: "border-purple-500/50",
		bgColor: "bg-purple-500/10",
		textColor: "text-purple-400",
		icon: "🔍",
		label: "Architect Review",
		statusMessage: "🔍 Reviewing & validating...",
		spinning: true,
	},
	QA: {
		borderColor: "border-yellow-500/50",
		bgColor: "bg-yellow-500/10",
		textColor: "text-yellow-400",
		icon: "🟨",
		label: "QA Engineer",
		statusMessage: "🧪 Testing in progress...",
		spinning: true,
	},
	SENTINEL: {
		borderColor: "border-red-500/50",
		bgColor: "bg-red-500/10",
		textColor: "text-red-400",
		icon: "🛡️",
		label: "Sentinel",
		statusMessage: "🛡️ Security auditing...",
		spinning: true,
	},
	COMPLETED: {
		borderColor: "border-emerald-500/50",
		bgColor: "bg-emerald-500/10",
		textColor: "text-emerald-400",
		icon: "✅",
		label: "Completed",
		statusMessage: "✅ Workflow complete!",
		spinning: false,
	},
	BLOCKED: {
		borderColor: "border-orange-500/50",
		bgColor: "bg-orange-500/10",
		textColor: "text-orange-400",
		icon: "🚫",
		label: "Blocked",
		statusMessage: "⚠️ Human intervention required",
		spinning: false,
	},
} as const

type AgentState = keyof typeof AGENT_CONFIG

interface SentinelAgentIndicatorProps {
	className?: string
	variant?: "compact" | "full"
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

	const currentAgent = (sentinelAgentState.currentAgent || "IDLE") as AgentState
	const config = AGENT_CONFIG[currentAgent] || AGENT_CONFIG.IDLE
	const activity = sentinelAgentState.currentActivity || config.statusMessage
	const handoff = sentinelAgentState.lastHandoff

	// Compact variant - just icon and label
	if (variant === "compact") {
		return (
			<div
				className={cn(
					"inline-flex items-center gap-1.5 px-2 py-1 rounded-md",
					config.bgColor,
					"border",
					config.borderColor,
					"text-xs font-medium transition-all duration-300",
					className,
				)}
				data-testid="sentinel-agent-indicator">
				<span className="text-sm">{config.icon}</span>
				<span className={cn("opacity-90", config.textColor)}>{config.label}</span>

				{/* Spinning indicator for active testing/auditing */}
				{config.spinning && (
					<svg
						className="animate-spin h-3 w-3 ml-1"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24">
						<circle
							className="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							strokeWidth="4"
						/>
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						/>
					</svg>
				)}

				{/* Pulsing dot for non-spinning active states */}
				{!config.spinning && currentAgent !== "IDLE" && currentAgent !== "COMPLETED" && (
					<span className="relative flex h-2 w-2 ml-1">
						<span
							className={cn(
								"animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
								config.bgColor.replace("/10", "/50"),
							)}
						/>
						<span
							className={cn("relative inline-flex rounded-full h-2 w-2", config.bgColor.replace("/10", ""))}
						/>
					</span>
				)}
			</div>
		)
	}

	// Full variant - with status message, activity, and handoff info
	return (
		<div
			className={cn(
				"flex flex-col gap-2 px-4 py-3 rounded-lg",
				config.bgColor,
				"border-2",
				config.borderColor,
				"transition-all duration-300 animate-fadeIn",
				className,
			)}
			data-testid="sentinel-agent-indicator-full">
			
			{/* Header with icon and name */}
			<div className="flex items-center gap-3">
				<div className="flex items-center justify-center w-10 h-10 rounded-full bg-black/20 shadow-lg">
					<span className="text-2xl">{config.icon}</span>
				</div>

				<div className="flex flex-col flex-1">
					<span className={cn("text-sm font-bold", config.textColor)}>
						{config.label}
						{config.spinning && (
							<svg
								className="animate-spin h-3 w-3 inline-block ml-2"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24">
								<circle
									className="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									strokeWidth="4"
								/>
								<path
									className="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								/>
							</svg>
						)}
					</span>
					{activity && (
						<span className="text-xs text-vscode-descriptionForeground animate-pulse">
							{activity}
						</span>
					)}
				</div>

				{/* Animated pulse indicator */}
				{currentAgent !== "IDLE" && currentAgent !== "COMPLETED" && !config.spinning && (
					<span className="relative flex h-3 w-3">
						<span
							className={cn(
								"animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
								config.bgColor.replace("/10", "/50"),
							)}
						/>
						<span
							className={cn("relative inline-flex rounded-full h-3 w-3", config.bgColor.replace("/10", ""))}
						/>
					</span>
				)}
			</div>

			{/* Handoff summary bar */}
			{handoff && handoff.summary && (
				<div className="mt-1 px-3 py-2 bg-black/20 rounded-md border border-white/10">
					<div className="text-xs text-vscode-descriptionForeground mb-1">
						📤 <span className="font-medium">{handoff.from}</span> → <span className="font-medium">{handoff.to}</span>
					</div>
					<div className="text-xs opacity-80 flex flex-wrap gap-2">
						{handoff.summary}
					</div>
				</div>
			)}
		</div>
	)
}

export default SentinelAgentIndicator
