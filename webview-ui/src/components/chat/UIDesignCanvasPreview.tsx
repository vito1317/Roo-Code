/**
 * UI Design Canvas Preview
 *
 * A compact preview of the UI Design Canvas that displays above the Sentinel Agent Indicator.
 * Connects to the MCP server's SSE endpoint for real-time design updates.
 */
import React, { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

interface DesignDocument {
	id: string
	name: string
	canvas?: {
		width: number
		height: number
		backgroundColor: string
		device?: string
	}
	elements?: DesignElement[]
}

interface DesignElement {
	id: string
	type: string
	name?: string
	bounds?: {
		x: number
		y: number
		width: number
		height: number
	}
	style?: {
		fill?: string
		stroke?: { color: string; width: number }
		radius?: number
		shadow?: { offsetX: number; offsetY: number; blur: number; color: string }
		text?: { fontSize: number; fontWeight?: string; textAlign?: string }
	}
	content?: string
	children?: DesignElement[]
}

interface UIDesignCanvasPreviewProps {
	className?: string
	collapsed?: boolean
	onToggleCollapse?: () => void
}

// SVG renderElement function removed - MCP-UI HTML is now used instead

export const UIDesignCanvasPreview: React.FC<UIDesignCanvasPreviewProps> = ({
	className,
	collapsed = false,
	onToggleCollapse,
}) => {
	const { sentinelAgentState } = useExtensionState()
	const [design, setDesign] = useState<DesignDocument | null>(null)
	const [connected, setConnected] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const eventSourceRef = useRef<EventSource | null>(null)
	const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	// MCP-UI HTML output state
	const [mcpUiHtml, setMcpUiHtml] = useState<string | null>(null)
	const mcpUiPreviewRef = useRef<HTMLDivElement>(null)

	// Show when Sentinel is enabled (any agent) - we want to show the design progress
	const isSentinelEnabled = sentinelAgentState?.enabled === true

	// Connect to the MCP server's design updates SSE endpoint
	const connectToDesignUpdates = useCallback(() => {
		// Clean up existing connection
		if (eventSourceRef.current) {
			eventSourceRef.current.close()
		}

		try {
			// Connect to the design updates endpoint
			const eventSource = new EventSource("http://127.0.0.1:4420/design-updates")
			eventSourceRef.current = eventSource

			eventSource.onopen = () => {
				console.log("[UIDesignCanvasPreview] SSE connection opened")
				setConnected(true)
				setError(null)
			}

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data) as DesignDocument
					setDesign(data)
				} catch (e) {
					console.error("[UIDesignCanvasPreview] Failed to parse design data:", e)
				}
			}

			eventSource.onerror = (e) => {
				console.error("[UIDesignCanvasPreview] SSE connection error:", e)
				setConnected(false)
				eventSource.close()

				// Retry after 3 seconds
				if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
				retryTimeoutRef.current = setTimeout(() => {
					if (isSentinelEnabled) {
						connectToDesignUpdates()
					}
				}, 3000)
			}
		} catch (e) {
			console.error("[UIDesignCanvasPreview] Failed to create EventSource:", e)
			setError("Failed to connect to UI Design Canvas")
		}
	}, [isSentinelEnabled])

	// Fetch initial design state
	const fetchDesign = useCallback(async () => {
		try {
			const response = await fetch("http://127.0.0.1:4420/design")
			if (response.ok) {
				const data = await response.json()
				setDesign(data)
				setConnected(true)
				setError(null)
			}
		} catch (_e) {
			// Server might not be running yet
			setError("Connecting...")
		}
	}, [])

	// Connect when Sentinel is enabled (try to show design whenever there's one)
	useEffect(() => {
		// Always try to fetch design on mount when Sentinel is enabled
		if (isSentinelEnabled) {
			fetchDesign()
			connectToDesignUpdates()
		}

			return () => {
			if (eventSourceRef.current) {
				eventSourceRef.current.close()
			}
			if (retryTimeoutRef.current) {
				clearTimeout(retryTimeoutRef.current)
			}
		}
	}, [isSentinelEnabled, fetchDesign, connectToDesignUpdates])

	// Listen for MCP-UI HTML output from extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "mcpUiHtml") {
				setMcpUiHtml(message.html)
				console.log("[UIDesignCanvasPreview] Received MCP-UI HTML")
			} else if (message.type === "clearMcpUiHtml") {
				setMcpUiHtml(null)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	// Calculate element count early for visibility check
	const elementCount = design?.elements?.length || 0
	const hasElements = elementCount > 0

	// Don't render if Sentinel is not enabled OR if there's no MCP-UI output to display
	// Only show Status area when there's actual content to display
	if (!isSentinelEnabled || !mcpUiHtml) {
		return null
	}

	// Note: These variables are kept for potential future use but not currently needed
	const _previewWidth = 200
	const _canvasWidth = design?.canvas?.width || 390
	const _canvasHeight = design?.canvas?.height || 844
	const _scale = _previewWidth / _canvasWidth
	const _previewHeight = _canvasHeight * _scale

	// hasElements already calculated above

	// Open full panel
	const handleOpenFullPanel = () => {
		vscode.postMessage({ type: "openUIDesignCanvas" })
	}

	return (
		<div
			className={cn(
				"mx-4 mb-2 rounded-lg border border-pink-500/30 bg-pink-500/5 overflow-hidden transition-all duration-300",
				className,
			)}>
			{/* Header */}
			<div
				className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-pink-500/10 transition-colors"
				onClick={onToggleCollapse}>
				<div className="flex items-center gap-2">
					<span className="text-lg">🎨</span>
					<span className="text-sm font-medium text-pink-400">Status</span>
					{connected && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
					{!connected && error && <span className="w-2 h-2 rounded-full bg-yellow-500" />}
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-vscode-descriptionForeground">
						{hasElements ? `${elementCount} elements` : "Empty"}
					</span>
					<button
						onClick={(e) => {
							e.stopPropagation()
							handleOpenFullPanel()
						}}
						className="p-1 hover:bg-pink-500/20 rounded transition-colors"
						title="Open Full Panel">
						<svg className="w-4 h-4 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
							/>
						</svg>
					</button>
					<span
						className={cn("codicon transition-transform duration-200", collapsed ? "" : "rotate-180")}
						style={{ fontFamily: "codicon" }}>
						&#xeab4;
					</span>
				</div>
			</div>

			{/* Preview Area */}
			{!collapsed && (
				<div className="px-3 pb-3">
					{/* MCP-UI HTML Preview - always show since we only render when mcpUiHtml exists */}
					<div
						ref={mcpUiPreviewRef}
						className="relative bg-[#1e1e1e] rounded-lg overflow-auto shadow-inner mx-auto p-3"
						style={{ maxHeight: 250 }}
						dangerouslySetInnerHTML={{ __html: mcpUiHtml }}
					/>
				</div>
			)}
		</div>
	)
}

export default UIDesignCanvasPreview
