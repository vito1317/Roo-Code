import { VSCodeCheckbox, VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { HTMLAttributes, useEffect, useState } from "react"

import { Button } from "@/components/ui"
import { vscode } from "@/utils/vscode"

import { SearchableSetting } from "./SearchableSetting"
import { Section } from "./Section"
import { SectionHeader } from "./SectionHeader"
import { SetCachedStateField } from "./types"

type FigmaSettingsProps = HTMLAttributes<HTMLDivElement> & {
	figmaEnabled?: boolean
	figmaWriteEnabled?: boolean
	talkToFigmaEnabled?: boolean
	setCachedStateField: SetCachedStateField<"figmaEnabled" | "figmaWriteEnabled" | "talkToFigmaEnabled">
}

export const FigmaSettings = ({
	figmaEnabled,
	figmaWriteEnabled,
	talkToFigmaEnabled,
	setCachedStateField,
	...props
}: FigmaSettingsProps) => {
	// Local state to ensure immediate UI feedback
	const [isEnabled, setIsEnabled] = useState(figmaEnabled ?? false)
	const [isFigmaWriteEnabled, setIsFigmaWriteEnabled] = useState(figmaWriteEnabled ?? false)
	const [isTalkToFigmaEnabled, setIsTalkToFigmaEnabled] = useState(talkToFigmaEnabled ?? true)
	const [apiToken, setApiToken] = useState("")
	const [tokenSaved, setTokenSaved] = useState(false)
	const [testingConnection, setTestingConnection] = useState(false)
	const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

	// Sync local state with props
	useEffect(() => {
		setIsEnabled(figmaEnabled ?? false)
	}, [figmaEnabled])

	useEffect(() => {
		setIsFigmaWriteEnabled(figmaWriteEnabled ?? false)
	}, [figmaWriteEnabled])

	useEffect(() => {
		setIsTalkToFigmaEnabled(talkToFigmaEnabled ?? true)
	}, [talkToFigmaEnabled])

	// Listen for connection test results
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "figmaConnectionResult") {
				setTestResult({
					success: message.success,
					message: message.message,
				})
				setTestingConnection(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleEnableChange = (checked: boolean) => {
		setIsEnabled(checked) // Immediate local update
		setCachedStateField("figmaEnabled", checked) // Update parent state
	}

	const handleSaveToken = () => {
		if (apiToken.trim()) {
			vscode.postMessage({
				type: "setFigmaApiToken",
				text: apiToken.trim(),
			})
			setTokenSaved(true)
			setApiToken("")
			setTimeout(() => setTokenSaved(false), 3000)
		}
	}

	const handleTestConnection = () => {
		setTestingConnection(true)
		setTestResult(null)
		vscode.postMessage({ type: "testFigmaConnection" })
	}

	return (
		<div {...props}>
			<SectionHeader>
				<span className="flex items-center gap-2">🎨 Figma Integration</span>
			</SectionHeader>

			<Section>
				<SearchableSetting settingId="figma-enable" section="figma" label="Enable Figma Integration">
					<VSCodeCheckbox checked={isEnabled} onChange={(e: any) => handleEnableChange(e.target.checked)}>
						<span className="font-medium">Enable Figma Integration</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						Allow Sentinel workflow to read designs from Figma.
						<VSCodeLink
							href="https://www.figma.com/developers/api#access-tokens"
							style={{ display: "inline", marginLeft: "4px" }}>
							Get API Token
						</VSCodeLink>
					</div>
				</SearchableSetting>

				{isEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background mt-3">
						{/* MCP Server Selection - Radio style toggle */}
						<SearchableSetting settingId="figma-mcp-servers" section="figma" label="MCP Server">
							<div className="space-y-3">
								<div className="font-medium mb-2">🔌 選擇 MCP 伺服器 (Select MCP Server)</div>

								{/* figma-write Server - Radio option */}
								<div
									className={`p-3 rounded-md border cursor-pointer transition-all ${
										isFigmaWriteEnabled && !isTalkToFigmaEnabled
											? "bg-vscode-button-background border-vscode-button-background"
											: "bg-vscode-input-background border-vscode-input-border hover:border-vscode-button-background"
									}`}
									onClick={() => {
										setIsFigmaWriteEnabled(true)
										setIsTalkToFigmaEnabled(false)
										setCachedStateField("figmaWriteEnabled", true)
										setCachedStateField("talkToFigmaEnabled", false)
									}}>
									<div className="flex items-center gap-2">
										<div
											className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
												isFigmaWriteEnabled && !isTalkToFigmaEnabled
													? "border-white"
													: "border-vscode-descriptionForeground"
											}`}>
											{isFigmaWriteEnabled && !isTalkToFigmaEnabled && (
												<div className="w-2 h-2 rounded-full bg-white"></div>
											)}
										</div>
										<span className="font-medium">figma-write (本地橋接)</span>
									</div>
									<div className="text-vscode-descriptionForeground text-xs mt-2 ml-6">
										使用本地 WebSocket 橋接連接 Figma 插件。 需要在 Figma 中安裝並啟動 &quot;Cursor Talk
										to Figma&quot; 插件。
									</div>
								</div>

								{/* TalkToFigma Server - Radio option */}
								<div
									className={`p-3 rounded-md border cursor-pointer transition-all ${
										isTalkToFigmaEnabled && !isFigmaWriteEnabled
											? "bg-vscode-button-background border-vscode-button-background"
											: "bg-vscode-input-background border-vscode-input-border hover:border-vscode-button-background"
									}`}
									onClick={() => {
										setIsTalkToFigmaEnabled(true)
										setIsFigmaWriteEnabled(false)
										setCachedStateField("talkToFigmaEnabled", true)
										setCachedStateField("figmaWriteEnabled", false)
									}}>
									<div className="flex items-center gap-2">
										<div
											className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
												isTalkToFigmaEnabled && !isFigmaWriteEnabled
													? "border-white"
													: "border-vscode-descriptionForeground"
											}`}>
											{isTalkToFigmaEnabled && !isFigmaWriteEnabled && (
												<div className="w-2 h-2 rounded-full bg-white"></div>
											)}
										</div>
										<span className="font-medium">TalkToFigma (ai-figma-mcp) ⭐ 推薦</span>
									</div>
									<div className="text-vscode-descriptionForeground text-xs mt-2 ml-6">
										使用 ai-figma-mcp 套件連接 Figma 插件。 功能更完整，支援更多 Figma 操作。
									</div>
								</div>

								<div className="text-vscode-descriptionForeground text-xs mt-2 p-2 bg-yellow-800/20 rounded">
									⚠️ 修改後需要重新載入 VS Code 才會生效。
								</div>
							</div>
						</SearchableSetting>

						<SearchableSetting settingId="figma-api-token" section="figma" label="Figma API Token">
							<label className="block font-medium mb-1">API Token</label>
							<div className="flex items-center gap-2">
								<VSCodeTextField
									type="password"
									value={apiToken}
									onChange={(e: any) => setApiToken(e.target.value)}
									placeholder="Enter your Figma Personal Access Token"
									style={{ flexGrow: 1 }}
								/>
								<Button onClick={handleSaveToken} disabled={!apiToken.trim()}>
									Save
								</Button>
							</div>
							{tokenSaved && <div className="text-green-400 text-sm mt-1">✓ Token saved securely</div>}
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								Go to Figma Settings → Personal access tokens to generate a token.
							</div>
						</SearchableSetting>

						<SearchableSetting settingId="figma-test-connection" section="figma" label="Test Connection">
							<Button onClick={handleTestConnection} disabled={testingConnection}>
								{testingConnection ? "Testing..." : "Test Connection"}
							</Button>
							{testResult && (
								<div
									className={`p-2 rounded-xs text-sm mt-2 ${
										testResult.success
											? "bg-green-800/20 text-green-400"
											: "bg-red-800/20 text-red-400"
									}`}>
									{testResult.message}
								</div>
							)}
						</SearchableSetting>

						{/* Figma Write Tools */}
						<SearchableSetting settingId="figma-write-tools" section="figma" label="Figma Write Tools">
							<div className="mt-2 space-y-3">
								{/* Tools Header */}
								<div className="p-3 bg-vscode-input-background rounded-md border border-vscode-input-border">
									<div className="flex items-center justify-between">
										<div>
											<span className="font-medium">✏️ Figma Write Tools</span>
											<div className="text-vscode-descriptionForeground text-sm mt-1">
												Allows AI to create and modify Figma designs directly.
											</div>
										</div>
										<span className={`text-sm ${isEnabled ? "text-green-400" : "text-gray-500"}`}>
											{isEnabled ? "● Enabled" : "○ Disabled"}
										</span>
									</div>
								</div>

								{/* Auto-allow MCP Tools */}
								<VSCodeCheckbox checked={true} disabled={true}>
									<span className="font-medium">Auto-allow Figma tools</span>
								</VSCodeCheckbox>
								<div className="text-vscode-descriptionForeground text-xs ml-6 -mt-2">
									Figma tools (find_nodes, create_frame, etc.) are auto-approved without confirmation
									dialogs.
								</div>

								{/* Available Tools List */}
								<div className="text-xs text-vscode-descriptionForeground">
									<span className="font-medium block mb-1">Available Tools:</span>
									<div className="grid grid-cols-2 gap-1 ml-2">
										<span>• create_frame</span>
										<span>• create_rectangle</span>
										<span>• add_text</span>
										<span>• set_fill</span>
										<span>• set_position</span>
										<span>• find_nodes</span>
									</div>
								</div>
							</div>
						</SearchableSetting>
					</div>
				)}
			</Section>
		</div>
	)
}
