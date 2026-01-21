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
	setCachedStateField: SetCachedStateField<"figmaEnabled">
}

export const FigmaSettings = ({
	figmaEnabled,
	setCachedStateField,
	...props
}: FigmaSettingsProps) => {
	// Local state to ensure immediate UI feedback
	const [isEnabled, setIsEnabled] = useState(figmaEnabled ?? false)
	const [apiToken, setApiToken] = useState("")
	const [tokenSaved, setTokenSaved] = useState(false)
	const [testingConnection, setTestingConnection] = useState(false)
	const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

	// Sync local state with prop
	useEffect(() => {
		setIsEnabled(figmaEnabled ?? false)
	}, [figmaEnabled])

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
				<span className="flex items-center gap-2">
					🎨 Figma Integration
				</span>
			</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="figma-enable"
					section="figma"
					label="Enable Figma Integration">
					<VSCodeCheckbox
						checked={isEnabled}
						onChange={(e: any) => handleEnableChange(e.target.checked)}>
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
						<SearchableSetting
							settingId="figma-api-token"
							section="figma"
							label="Figma API Token">
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
							{tokenSaved && (
								<div className="text-green-400 text-sm mt-1">
									✓ Token saved securely
								</div>
							)}
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								Go to Figma Settings → Personal access tokens to generate a token.
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="figma-test-connection"
							section="figma"
							label="Test Connection">
							<Button
								onClick={handleTestConnection}
								disabled={testingConnection}>
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
					</div>
				)}
			</Section>
		</div>
	)
}
