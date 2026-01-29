import { useCallback, useEffect, useMemo, useState, memo } from "react"
import { Server, ChevronDown } from "lucide-react"
import { useEvent } from "react-use"
import { useTranslation } from "react-i18next"

import {
	type ExtensionMessage,
	type ClineAskUseMcpServer,
	type McpExecutionStatus,
	mcpExecutionStatusSchema,
} from "@roo-code/types"

import { safeJsonParse } from "@roo/core"

// MCP-UI client for rendering rich tool UIs
import { UIResourceRenderer, isUIResource, type UIActionResult } from "@mcp-ui/client"

import { cn } from "@src/lib/utils"
import { Button } from "@src/components/ui"

import CodeBlock from "../common/CodeBlock"
import McpToolRow from "../mcp/McpToolRow"

import { Markdown } from "./Markdown"

interface McpExecutionProps {
	executionId: string
	text?: string
	serverName?: string
	toolName?: string
	isArguments?: boolean
	server?: {
		tools?: Array<{
			name: string
			description?: string
			alwaysAllow?: boolean
		}>
		source?: "global" | "project"
	}
	useMcpServer?: ClineAskUseMcpServer
	alwaysAllowMcp?: boolean
}

export const McpExecution = ({
	executionId,
	text,
	serverName: initialServerName,
	toolName: initialToolName,
	isArguments = false,
	server,
	useMcpServer,
	alwaysAllowMcp = false,
}: McpExecutionProps) => {
	const { t } = useTranslation("mcp")

	// State for tracking MCP response status
	const [status, setStatus] = useState<McpExecutionStatus | null>(null)
	const [responseText, setResponseText] = useState(text || "")
	const [argumentsText, setArgumentsText] = useState(text || "")
	const [serverName, setServerName] = useState(initialServerName)
	const [toolName, setToolName] = useState(initialToolName)

	// Only need expanded state for response section (like command output)
	// Auto-expand for MCP-UI server responses
	const isMcpUiServer = serverName === "MCP-UI" || initialServerName === "MCP-UI"
	const [isResponseExpanded, setIsResponseExpanded] = useState(isMcpUiServer)

	// Try to parse JSON and return both the result and formatted text
	const tryParseJson = useCallback((text: string): { isJson: boolean; formatted: string } => {
		if (!text) return { isJson: false, formatted: "" }

		try {
			const parsed = JSON.parse(text)
			return {
				isJson: true,
				formatted: JSON.stringify(parsed, null, 2),
			}
		} catch {
			return {
				isJson: false,
				formatted: text,
			}
		}
	}, [])

	// Only parse response data when expanded AND complete to avoid parsing partial JSON
	const responseData = useMemo(() => {
		if (!isResponseExpanded) {
			return { isJson: false, formatted: responseText }
		}
		// Only try to parse JSON if the response is complete
		if (status && status.status === "completed") {
			return tryParseJson(responseText)
		}
		// For partial responses, just return as-is without parsing
		return { isJson: false, formatted: responseText }
	}, [responseText, isResponseExpanded, tryParseJson, status])

	// Only parse arguments data when complete to avoid parsing partial JSON
	const argumentsData = useMemo(() => {
		if (!argumentsText) {
			return { isJson: false, formatted: "" }
		}

		// For arguments, we don't have a streaming status, so we check if it looks like complete JSON
		const trimmed = argumentsText.trim()

		// Basic check for complete JSON structure
		if (
			trimmed &&
			((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))
		) {
			// Try to parse, but if it fails, return as-is
			try {
				const parsed = JSON.parse(trimmed)
				return {
					isJson: true,
					formatted: JSON.stringify(parsed, null, 2),
				}
			} catch {
				// JSON structure looks complete but is invalid, return as-is
				return { isJson: false, formatted: argumentsText }
			}
		}

		// For non-JSON or incomplete data, just return as-is
		return { isJson: false, formatted: argumentsText }
	}, [argumentsText])

	const formattedResponseText = responseData.formatted
	const formattedArgumentsText = argumentsData.formatted
	const responseIsJson = responseData.isJson

	const onToggleResponseExpand = useCallback(() => {
		setIsResponseExpanded(!isResponseExpanded)
	}, [isResponseExpanded])

	// Listen for MCP execution status messages
	const onMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "mcpExecutionStatus") {
				try {
					const result = mcpExecutionStatusSchema.safeParse(safeJsonParse(message.text || "{}", {}))

					if (result.success) {
						const data = result.data

						// Only update if this message is for our response
						if (data.executionId === executionId) {
							setStatus(data)

							if (data.status === "output" && data.response) {
								setResponseText((prev) => prev + data.response)
							} else if (data.status === "completed" && data.response) {
								setResponseText(data.response)
							}
						}
					}
				} catch (e) {
					console.error("Failed to parse MCP execution status", e)
				}
			}
		},
		[executionId],
	)

	useEvent("message", onMessage)

	// Initialize with text if provided and parse command/response sections
	useEffect(() => {
		// Handle arguments text - don't parse JSON here as it might be incomplete
		if (text) {
			setArgumentsText(text)
		}

		// Handle response text
		if (useMcpServer?.response) {
			setResponseText(useMcpServer.response)
		}

		if (initialServerName && initialServerName !== serverName) {
			setServerName(initialServerName)
		}

		if (initialToolName && initialToolName !== toolName) {
			setToolName(initialToolName)
		}
	}, [text, useMcpServer, initialServerName, initialToolName, serverName, toolName, isArguments])

	// For MCP-UI server, use a simplified/minimal display with enhanced styling
	if (isMcpUiServer) {
		const isLoading = status && status.status !== "completed"
		const hasResponse = formattedResponseText && formattedResponseText.length > 0

		return (
			<div className="w-full">
				{/* MCP-UI styled container */}
				<div className="rounded-lg overflow-hidden">
					{/* Loading state with animated gradient */}
					{isLoading && (
						<div className="flex items-center gap-3 px-3 py-2 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-lg mb-2">
							<div className="relative">
								<div className="animate-spin rounded-full size-4 border-2 border-blue-400/30 border-t-blue-400" />
							</div>
							<span className="text-xs font-medium text-blue-400">
								{t("execution.rendering", "渲染 UI 中...")}
							</span>
						</div>
					)}

					{/* Response section - auto-expanded for MCP-UI */}
					{hasResponse && (
						<ResponseContainer
							isExpanded={isResponseExpanded}
							response={formattedResponseText}
							isJson={responseIsJson}
							hasArguments={false}
							isPartial={status ? status.status !== "completed" : false}
							isMcpUi={true}
						/>
					)}

					{/* Empty state when no response yet */}
					{!isLoading && !hasResponse && (
						<div className="flex items-center justify-center py-4 text-xs text-vscode-descriptionForeground opacity-50">
							<span>{t("execution.waiting", "等待 UI 回應...")}</span>
						</div>
					)}
				</div>
			</div>
		)
	}

	return (
		<>
			<div className="flex flex-row items-center justify-between gap-2 mb-1">
				<div className="flex flex-row items-center gap-1 flex-wrap">
					<Server size={16} className="text-vscode-descriptionForeground" />
					<div className="flex items-center gap-1 flex-wrap">
						{serverName && <span className="font-bold text-vscode-foreground">{serverName}</span>}
					</div>
				</div>
				<div className="flex flex-row items-center justify-between gap-2 px-1">
					<div className="flex flex-row items-center gap-1">
						{status && (
							<div className="flex flex-row items-center gap-2 font-mono text-xs">
								<div
									className={cn("rounded-full size-1.5", {
										"bg-lime-400": status.status === "started" || status.status === "completed",
										"bg-red-400": status.status === "error",
									})}
								/>
								<div
									className={cn("whitespace-nowrap", {
										"text-vscode-foreground":
											status.status === "started" || status.status === "completed",
										"text-vscode-errorForeground": status.status === "error",
									})}>
									{status.status === "started"
										? t("execution.running")
										: status.status === "completed"
											? t("execution.completed")
											: t("execution.error")}
								</div>
								{status.status === "error" && "error" in status && status.error && (
									<div className="whitespace-nowrap">({status.error})</div>
								)}
							</div>
						)}
						{responseText && responseText.length > 0 && (
							<Button variant="ghost" size="icon" onClick={onToggleResponseExpand}>
								<ChevronDown
									className={cn("size-4 transition-transform duration-300", {
										"rotate-180": isResponseExpanded,
									})}
								/>
							</Button>
						)}
					</div>
				</div>
			</div>

			<div className="w-full bg-vscode-editor-background rounded-xs p-2">
				{/* Tool information section */}
				{useMcpServer?.type === "use_mcp_tool" && (
					<div onClick={(e) => e.stopPropagation()}>
						<McpToolRow
							tool={{
								name: useMcpServer.toolName || "",
								description:
									server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.description ||
									"",
								alwaysAllow:
									server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.alwaysAllow ||
									false,
							}}
							serverName={useMcpServer.serverName}
							serverSource={server?.source}
							alwaysAllowMcp={alwaysAllowMcp}
							isInChatContext={true}
						/>
					</div>
				)}
				{!useMcpServer && toolName && serverName && (
					<div onClick={(e) => e.stopPropagation()}>
						<McpToolRow
							tool={{
								name: toolName || "",
								description: "",
								alwaysAllow: false,
							}}
							serverName={serverName}
							serverSource={undefined}
							alwaysAllowMcp={alwaysAllowMcp}
							isInChatContext={true}
						/>
					</div>
				)}

				{/* Arguments section - display like command (always visible) */}
				{(isArguments || useMcpServer?.arguments || argumentsText) && (
					<div
						className={cn({
							"mt-1 pt-1":
								!isArguments && (useMcpServer?.type === "use_mcp_tool" || (toolName && serverName)),
						})}>
						<CodeBlock source={formattedArgumentsText} language="json" />
					</div>
				)}

				{/* Response section - collapsible like command output */}
				<ResponseContainer
					isExpanded={isResponseExpanded}
					response={formattedResponseText}
					isJson={responseIsJson}
					hasArguments={!!(isArguments || useMcpServer?.arguments || argumentsText)}
					isPartial={status ? status.status !== "completed" : false}
				/>
			</div>
		</>
	)
}

McpExecution.displayName = "McpExecution"

/**
 * Check if parsed response contains MCP-UI resource content or raw HTML
 * MCP-UI tools return responses with embedded UI resources in the format:
 * { content: [{ type: "resource", resource: { uri: "ui://...", blob: "<html>..." } }] }
 * Also supports raw HTML content for rendering in iframe
 */
function extractUIResource(response: string): { hasUI: boolean; resource?: any; content?: any[]; rawHtml?: string } {
	// First check for raw HTML content (starts with <!DOCTYPE or <html or contains HTML tags)
	const trimmed = response.trim()
	if (
		trimmed.startsWith("<!DOCTYPE") ||
		trimmed.startsWith("<html") ||
		trimmed.startsWith("<HTML") ||
		(trimmed.startsWith("<") && trimmed.includes("</") && /<[a-z][\s\S]*>/i.test(trimmed))
	) {
		console.log("[MCP-UI] Found raw HTML content")
		return { hasUI: true, rawHtml: trimmed }
	}

	try {
		const parsed = JSON.parse(response)
		console.log("[MCP-UI] Checking response for UI resource:", parsed)

		// Check if response follows MCP tool result format with content array
		if (parsed && Array.isArray(parsed.content)) {
			for (const item of parsed.content) {
				// Type for MCP content items
				const contentItem = item as { type?: string; resource?: any; text?: string } | null
				console.log("[MCP-UI] Checking content item:", contentItem)

				// Check using isUIResource helper - need to provide proper type
				if (contentItem && contentItem.type) {
					const typedItem = { type: contentItem.type, resource: contentItem.resource }
					if (isUIResource(typedItem)) {
						console.log("[MCP-UI] Found UI resource via isUIResource!", contentItem.resource)
						return { hasUI: true, resource: contentItem.resource, content: parsed.content }
					}
				}

				// Also check for embedded resource with blob/text containing HTML
				if (contentItem && contentItem.type === "resource" && contentItem.resource) {
					console.log("[MCP-UI] Found resource type item:", contentItem.resource)
					return { hasUI: true, resource: contentItem.resource, content: parsed.content }
				}

				// Check for text content that might be HTML
				if (contentItem && contentItem.type === "text" && contentItem.text) {
					const textContent = contentItem.text.trim()
					if (
						textContent.startsWith("<!DOCTYPE") ||
						textContent.startsWith("<html") ||
						(textContent.startsWith("<") && textContent.includes("</"))
					) {
						console.log("[MCP-UI] Found HTML in text content")
						return { hasUI: true, rawHtml: textContent }
					}
				}
			}
		}

		// Check for html property directly in parsed object
		if (parsed && typeof parsed.html === "string") {
			console.log("[MCP-UI] Found html property in response")
			return { hasUI: true, rawHtml: parsed.html }
		}

		// Check for ui or widget property
		if (parsed && (parsed.ui || parsed.widget)) {
			const uiContent = parsed.ui || parsed.widget
			if (typeof uiContent === "string") {
				console.log("[MCP-UI] Found ui/widget string property")
				return { hasUI: true, rawHtml: uiContent }
			}
		}

		// Also check if the response itself is a UI resource
		const parsedWithType = parsed as { type?: string; resource?: any }
		if (parsedWithType.type) {
			const typedParsed = { type: parsedWithType.type, resource: parsedWithType.resource }
			if (isUIResource(typedParsed)) {
				console.log("[MCP-UI] Response itself is UI resource")
				return { hasUI: true, resource: parsedWithType.resource }
			}
		}

		// Check for direct resource object
		const parsedAsResource = parsed as { type?: string; resource?: any }
		if (parsedAsResource && parsedAsResource.type === "resource" && parsedAsResource.resource) {
			console.log("[MCP-UI] Found direct resource object")
			return { hasUI: true, resource: parsedAsResource.resource }
		}

		console.log("[MCP-UI] No UI resource found in response")
		return { hasUI: false }
	} catch (e) {
		console.log("[MCP-UI] Failed to parse response as JSON:", e)
		return { hasUI: false }
	}
}

const ResponseContainerInternal = ({
	isExpanded,
	response,
	isJson,
	hasArguments,
	isPartial = false,
	isMcpUi = false,
}: {
	isExpanded: boolean
	response: string
	isJson: boolean
	hasArguments?: boolean
	isPartial?: boolean
	isMcpUi?: boolean
}) => {
	// Handle UI actions from MCP-UI renderer
	const handleUIAction = useCallback(async (result: UIActionResult): Promise<unknown> => {
		console.log("[McpExecution] UI Action:", result)
		// Handle different action types based on result.type
		switch (result.type) {
			case "link":
				// Open link in browser
				window.open(result.payload.url, "_blank")
				break
			case "notify":
				// Show notification (could integrate with VSCode notifications)
				console.log("[McpExecution] Notification:", result.payload.message)
				break
			case "tool":
				// Tool call request - would need to forward to extension host
				console.log("[McpExecution] Tool call:", result.payload.toolName, result.payload.params)
				break
			case "prompt":
				// Prompt request
				console.log("[McpExecution] Prompt:", result.payload.prompt)
				break
			case "intent":
				// Custom intent
				console.log("[McpExecution] Intent:", result.payload.intent, result.payload.params)
				break
		}
		return undefined
	}, [])

	// Only render content when expanded to prevent performance issues with large responses
	if (!isExpanded || response.length === 0) {
		return (
			<div
				className={cn("overflow-hidden", {
					"max-h-0": !isExpanded,
				})}
			/>
		)
	}

	// Check if response contains UI resource
	const uiResourceData = extractUIResource(response)

	// Render raw HTML content in an iframe
	const renderHtmlIframe = (html: string) => {
		// Extract any existing <style> tags from the HTML to preserve MCP-UI styles
		const styleMatches = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []
		const extractedStyles = styleMatches.join("\n")

		// Clean HTML content (remove doctype, html tags, but keep body content and styles)
		let cleanedHtml = html
		if (html.startsWith("<!DOCTYPE") || html.startsWith("<html")) {
			// Extract body content
			const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
			cleanedHtml = bodyMatch ? bodyMatch[1] : html.replace(/<!DOCTYPE[^>]*>|<html[^>]*>|<\/html>|<head>[\s\S]*?<\/head>/gi, "")
		}

		// Create a complete HTML document with styles for dark mode
		const htmlWithStyles = `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<style>
					:root {
						color-scheme: dark;
					}
					body {
						font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
						margin: 0;
						padding: 12px;
						background: #1e1e1e;
						color: #e0e0e0;
					}
					* { box-sizing: border-box; }
					/* Override MCP-UI styles for dark mode */
					.mcp-ui { color: #e0e0e0; }
					.mcp-progress-bar { background: #3a3a3a; }
					.mcp-table th { background: #2a2a2a; color: #e0e0e0; }
					.mcp-table td { border-color: #3a3a3a; }
					.mcp-card { border-color: #3a3a3a; background: #252525; }
					.mcp-card-header { border-color: #3a3a3a; color: #e0e0e0; }
					.mcp-card-body { color: #d0d0d0; }
					.mcp-card-footer { background: #2a2a2a; border-color: #3a3a3a; color: #a0a0a0; }
				</style>
				${extractedStyles}
			</head>
			<body>${cleanedHtml}</body>
			</html>
		`
		return (
			<iframe
				srcDoc={htmlWithStyles}
				sandbox="allow-scripts"
				className="w-full min-h-[200px] border-0 rounded-md bg-vscode-editor-background"
				style={{ height: "auto", minHeight: "200px" }}
				onLoad={(e) => {
					// Auto-resize iframe to fit content
					const iframe = e.target as HTMLIFrameElement
					try {
						const contentHeight = iframe.contentDocument?.body?.scrollHeight
						if (contentHeight && contentHeight > 200) {
							iframe.style.height = `${Math.min(contentHeight + 32, 500)}px`
						}
					} catch {
						// Cross-origin restrictions may prevent this
					}
				}}
			/>
		)
	}

	return (
		<div
			className={cn("overflow-hidden", {
				"max-h-[500px] overflow-y-auto mt-1 pt-1 border-t border-border/25": hasArguments && !isMcpUi,
				"max-h-[500px] overflow-y-auto mt-1 pt-1": !hasArguments && !isMcpUi,
				"max-h-[600px] overflow-y-auto": isMcpUi,
			})}>
			{uiResourceData.hasUI && uiResourceData.resource ? (
				<div className={cn("mcp-ui-container rounded-lg overflow-hidden shadow-sm", {
					"border border-border/50": !isMcpUi,
					"bg-vscode-editor-background/50 backdrop-blur-sm": isMcpUi,
				})}>
					<UIResourceRenderer
						resource={uiResourceData.resource}
						onUIAction={handleUIAction}
						htmlProps={{
							style: { width: "100%", minHeight: "200px" },
							autoResizeIframe: { height: true },
							sandboxPermissions: "allow-scripts allow-same-origin",
						}}
					/>
				</div>
			) : uiResourceData.hasUI && uiResourceData.rawHtml ? (
				<div className={cn("mcp-ui-container rounded-lg overflow-hidden shadow-sm", {
					"border border-border/50": !isMcpUi,
					"bg-vscode-editor-background/50 backdrop-blur-sm": isMcpUi,
				})}>
					{renderHtmlIframe(uiResourceData.rawHtml)}
				</div>
			) : isJson && !isMcpUi ? (
				<CodeBlock source={response} language="json" />
			) : isMcpUi && isJson ? (
				// For MCP-UI with JSON response that's not a UI resource, show completion indicator
				<div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
					<div className="size-2 rounded-full bg-green-400" />
					<span className="text-xs font-medium text-green-400">UI 渲染完成</span>
				</div>
			) : (
				<Markdown markdown={response} partial={isPartial} />
			)}
		</div>
	)
}

const ResponseContainer = memo(ResponseContainerInternal)
