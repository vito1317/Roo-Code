import { useState, useCallback, useMemo, useEffect } from "react"
import { useEvent } from "react-use"
import { LanguageModelChatSelector } from "vscode"

import type { ProviderSettings, ExtensionMessage, ModelInfo } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

import { ModelPicker } from "../ModelPicker"

// Module-level state to persist across component mounts
let cachedModels: LanguageModelChatSelector[] | null = null
let cachedIsLoading = true
let hasRequestedModels = false
let requestTimeoutId: ReturnType<typeof setTimeout> | null = null
// Keep track of all mounted component instances for state updates
let stateUpdaters: Set<() => void> = new Set()

// Notify all mounted components to re-render
function notifyStateChange() {
	console.log("[VSCodeLM] Notifying", stateUpdaters.size, "components of state change")
	stateUpdaters.forEach((updater) => updater())
}

type VSCodeLMProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const VSCodeLM = ({ apiConfiguration, setApiConfigurationField }: VSCodeLMProps) => {
	const { t } = useAppTranslation()

	// Force re-render mechanism
	const [, forceUpdate] = useState({})
	const triggerUpdate = useCallback(() => forceUpdate({}), [])

	// Read state from module-level cache
	const vsCodeLmModels = cachedModels ?? []
	const isLoading = cachedIsLoading

	// Register this component for state updates
	useEffect(() => {
		console.log("[VSCodeLM] Component mounted, registering for updates")
		stateUpdaters.add(triggerUpdate)

		return () => {
			console.log("[VSCodeLM] Component unmounting, unregistering")
			stateUpdaters.delete(triggerUpdate)
		}
	}, [triggerUpdate])

	// Request models on mount with timeout
	useEffect(() => {
		console.log("[VSCodeLM] useEffect triggered, hasRequestedModels:", hasRequestedModels, "cachedModels:", cachedModels)

		// If we already have cached models, use them
		if (cachedModels !== null) {
			console.log("[VSCodeLM] Using cached models:", cachedModels.length)
			cachedIsLoading = false
			return
		}

		// If we've already requested but don't have results yet, just wait
		if (hasRequestedModels) {
			console.log("[VSCodeLM] Already requested models, waiting...")
			return
		}

		hasRequestedModels = true
		cachedIsLoading = true
		console.log("[VSCodeLM] Requesting models...")
		vscode.postMessage({ type: "requestVsCodeLmModels" })

		// Set a timeout to stop loading after 5 seconds if no response
		requestTimeoutId = setTimeout(() => {
			console.log("[VSCodeLM] Timeout reached, setting isLoading to false")
			cachedModels = [] // Cache empty array to prevent re-requesting
			cachedIsLoading = false
			notifyStateChange() // Notify all components to re-render
		}, 5000)
	}, []) // Empty dependency array - only run on mount

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "vsCodeLmModels":
				{
					console.log("[VSCodeLM] Received vsCodeLmModels message:", message.vsCodeLmModels)
					const newModels = message.vsCodeLmModels ?? []
					cachedModels = newModels // Cache the result
					cachedIsLoading = false
					if (requestTimeoutId) {
						clearTimeout(requestTimeoutId)
						requestTimeoutId = null
					}
					notifyStateChange() // Notify all components to re-render
				}
				break
		}
	}, [])

	useEvent("message", onMessage)

	// Convert VSCode LM models array to Record format for ModelPicker
	const modelsRecord = useMemo((): Record<string, ModelInfo> => {
		return vsCodeLmModels.reduce(
			(acc, model) => {
				const modelId = `${model.vendor}/${model.family}`
				acc[modelId] = {
					maxTokens: 0,
					contextWindow: 0,
					supportsPromptCache: false,
					description: `${model.vendor} - ${model.family}`,
				}
				return acc
			},
			{} as Record<string, ModelInfo>,
		)
	}, [vsCodeLmModels])

	// Transform string model ID to { vendor, family } object for storage
	const valueTransform = useCallback((modelId: string) => {
		const [vendor, family] = modelId.split("/")
		return { vendor, family }
	}, [])

	// Transform stored { vendor, family } object back to display string
	const displayTransform = useCallback((value: unknown) => {
		if (!value) return ""
		const selector = value as { vendor?: string; family?: string }
		return selector.vendor && selector.family ? `${selector.vendor}/${selector.family}` : ""
	}, [])

	// Debug log for render state
	console.log("[VSCodeLM] Render - isLoading:", isLoading, "modelsCount:", vsCodeLmModels.length)

	return (
		<>
			{isLoading ? (
				<div>
					<label className="block font-medium mb-1">{t("settings:providers.vscodeLmModel")}</label>
					<div className="text-sm text-vscode-descriptionForeground">
						正在載入可用模型... (Loading available models...)
					</div>
				</div>
			) : vsCodeLmModels.length > 0 ? (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId=""
					models={modelsRecord}
					modelIdKey="vsCodeLmModelSelector"
					serviceName="VS Code LM"
					serviceUrl="https://code.visualstudio.com/api/extension-guides/language-model"
					valueTransform={valueTransform}
					displayTransform={displayTransform}
					hidePricing
				/>
			) : (
				<div>
					<label className="block font-medium mb-1">{t("settings:providers.vscodeLmModel")}</label>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{t("settings:providers.vscodeLmDescription")}
					</div>
					<div className="text-sm text-vscode-errorForeground p-2 border border-vscode-errorForeground rounded">
						⚠️ 未偵測到可用的語言模型。請確認：
						<ul className="list-disc list-inside mt-1">
							<li>已安裝 GitHub Copilot 和 Copilot Chat 擴充功能</li>
							<li>已登入 GitHub Copilot</li>
							<li>Copilot 已啟用</li>
						</ul>
						<div className="mt-2">
							(No language models detected. Please ensure GitHub Copilot is installed and enabled.)
						</div>
						<button
							className="mt-2 px-3 py-1 bg-vscode-button-background text-vscode-button-foreground rounded hover:bg-vscode-button-hoverBackground"
							onClick={() => {
								console.log("[VSCodeLM] Reload button clicked, clearing cache")
								// Clear cache to force re-request
								cachedModels = null
								cachedIsLoading = true
								notifyStateChange()
								vscode.postMessage({ type: "requestVsCodeLmModels" })
								// Set timeout for reload as well
								requestTimeoutId = setTimeout(() => {
									console.log("[VSCodeLM] Reload timeout reached")
									cachedModels = []
									cachedIsLoading = false
									notifyStateChange()
								}, 5000)
							}}
						>
							重新載入模型 (Reload Models)
						</button>
					</div>
				</div>
			)}
			<div className="text-sm text-vscode-errorForeground mt-2">{t("settings:providers.vscodeLmWarning")}</div>
		</>
	)
}
