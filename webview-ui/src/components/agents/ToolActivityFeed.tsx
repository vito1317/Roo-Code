import React from "react"
import type { ToolCallInfo } from "@roo-code/types"

interface ToolActivityFeedProps {
	toolCalls: ToolCallInfo[]
	maxItems?: number
}

const TOOL_ICONS: Record<string, string> = {
	read_file: "📄",
	write_to_file: "✍️",
	list_dir: "📁",
	execute_command: "⚡",
	search_files: "🔍",
	browser_action: "🌐",
	ask_followup_question: "❓",
	attempt_completion: "✅",
	use_mcp_tool: "🔧",
	new_task: "📋",
	handoff_context: "🤝",
	create_rectangle: "⬜",
	create_text: "📝",
	default: "🔹",
}

const getToolIcon = (toolName: string): string => {
	return TOOL_ICONS[toolName] || TOOL_ICONS.default
}

const formatDuration = (ms: number): string => {
	if (ms < 1000) return `${ms}ms`
	return `${(ms / 1000).toFixed(1)}s`
}

const formatTime = (timestamp: number): string => {
	const date = new Date(timestamp)
	return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export const ToolActivityFeed: React.FC<ToolActivityFeedProps> = ({ toolCalls, maxItems = 10 }) => {
	const displayedCalls = toolCalls.slice(0, maxItems)

	return (
		<div className="tool-feed">
			{/* Header */}
			<div className="feed-header">
				<div className="header-left">
					<span className="header-icon">🔧</span>
					<span className="header-title">TOOL ACTIVITY</span>
				</div>
				<span className="feed-count">{toolCalls.length}</span>
			</div>

			{/* List */}
			<div className="feed-list">
				{displayedCalls.length === 0 ? (
					<div className="empty-state">
						<span className="empty-icon">⏳</span>
						<span className="empty-text">Waiting for tool calls...</span>
					</div>
				) : (
					displayedCalls.map((call) => {
						const duration = call.endTime ? call.endTime - call.startTime : undefined
						return (
							<div key={call.id} className={`tool-item ${call.status}`}>
								<div className="tool-icon">{getToolIcon(call.toolName)}</div>
								<div className="tool-content">
									<div className="tool-header">
										<span className="tool-name">{call.toolName}</span>
										<span className="tool-time">{formatTime(call.startTime)}</span>
									</div>
									{call.params && Object.keys(call.params).length > 0 && (
										<div className="tool-params">
											{Object.entries(call.params)
												.slice(0, 2)
												.map(([key, value]) => (
													<span key={key} className="param">
														{key}: {String(value).slice(0, 25)}
														{String(value).length > 25 ? "…" : ""}
													</span>
												))}
										</div>
									)}
									<div className="tool-status">
										{call.status === "running" && (
											<>
												<span className="status-spinner" />
												<span className="status-text">Executing...</span>
											</>
										)}
										{call.status === "success" && (
											<>
												<span className="status-icon success">✓</span>
												<span className="status-text success">
													Done {duration && `(${formatDuration(duration)})`}
												</span>
											</>
										)}
										{call.status === "error" && (
											<>
												<span className="status-icon error">✗</span>
												<span className="status-text error">Failed</span>
											</>
										)}
										{call.status === "pending" && (
											<>
												<span className="status-icon pending">○</span>
												<span className="status-text pending">Pending</span>
											</>
										)}
									</div>
								</div>
							</div>
						)
					})
				)}
			</div>

			{toolCalls.length > maxItems && (
				<div className="feed-more">
					<button className="more-button">Show more ({toolCalls.length - maxItems})</button>
				</div>
			)}

			<style>{feedStyles}</style>
		</div>
	)
}

const feedStyles = `
	.tool-feed {
		background: linear-gradient(180deg, #0F172A 0%, #1E293B 100%);
		border: 1px solid rgba(71, 85, 105, 0.3);
		border-radius: 12px;
		overflow: hidden;
		max-height: 350px;
		display: flex;
		flex-direction: column;
	}

	/* Header */
	.feed-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 16px;
		background: rgba(0, 0, 0, 0.2);
		border-bottom: 1px solid rgba(71, 85, 105, 0.2);
	}

	.header-left {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.header-icon {
		font-size: 14px;
	}

	.header-title {
		color: #64748B;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 1.5px;
	}

	.feed-count {
		background: #22D3EE;
		color: #0A0F1C;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 10px;
	}

	/* List */
	.feed-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 30px 20px;
		color: #475569;
		gap: 8px;
	}

	.empty-icon {
		font-size: 24px;
		opacity: 0.5;
	}

	.empty-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
	}

	/* Tool Item */
	.tool-item {
		display: flex;
		gap: 10px;
		padding: 10px 12px;
		background: rgba(30, 41, 59, 0.5);
		border-radius: 8px;
		border: 1px solid transparent;
		transition: all 0.2s ease;
	}

	.tool-item:hover {
		background: rgba(30, 41, 59, 0.8);
	}

	.tool-item.running {
		border-color: rgba(99, 102, 241, 0.5);
		background: rgba(99, 102, 241, 0.1);
	}

	.tool-item.success {
		border-color: rgba(16, 185, 129, 0.3);
	}

	.tool-item.error {
		border-color: rgba(239, 68, 68, 0.4);
		background: rgba(239, 68, 68, 0.05);
	}

	.tool-icon {
		font-size: 16px;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 6px;
		flex-shrink: 0;
	}

	.tool-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tool-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.tool-name {
		color: #E2E8F0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		font-weight: 500;
	}

	.tool-time {
		color: #475569;
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
	}

	.tool-params {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.param {
		color: #64748B;
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		background: rgba(0, 0, 0, 0.2);
		padding: 2px 6px;
		border-radius: 4px;
	}

	.tool-status {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.status-spinner {
		width: 10px;
		height: 10px;
		border: 2px solid rgba(99, 102, 241, 0.3);
		border-top-color: #6366F1;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.status-icon {
		font-size: 10px;
	}

	.status-icon.success { color: #10B981; }
	.status-icon.error { color: #EF4444; }
	.status-icon.pending { color: #475569; }

	.status-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #64748B;
	}

	.status-text.success { color: #10B981; }
	.status-text.error { color: #EF4444; }

	/* More Button */
	.feed-more {
		padding: 8px;
		border-top: 1px solid rgba(71, 85, 105, 0.2);
	}

	.more-button {
		width: 100%;
		padding: 8px;
		background: rgba(99, 102, 241, 0.15);
		border: 1px solid rgba(99, 102, 241, 0.3);
		border-radius: 6px;
		color: #A5B4FC;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.more-button:hover {
		background: rgba(99, 102, 241, 0.25);
	}
`

export default ToolActivityFeed
