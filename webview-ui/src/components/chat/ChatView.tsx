import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useDeepCompareEffect, useEvent } from "react-use"
import debounce from "debounce"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import removeMd from "remove-markdown"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import useSound from "use-sound"
import { LRUCache } from "lru-cache"
import { Trans } from "react-i18next"

import { useDebounceEffect } from "@src/utils/useDebounceEffect"
import { appendImages } from "@src/utils/imageUtils"
import { getCostBreakdownIfNeeded } from "@src/utils/costFormatting"

import type { ClineAsk, ClineSayTool, ClineMessage, ExtensionMessage, AudioType } from "@roo-code/types"

import { findLast } from "@roo/array"
import { SuggestionItem } from "@roo-code/types"
import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { getApiMetrics } from "@roo/getApiMetrics"
import { getAllModes } from "@roo/modes"
import { ProfileValidator } from "@roo/ProfileValidator"
import { getLatestTodo } from "@roo/todo"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import RooHero from "@src/components/welcome/RooHero"
import { SpecModeToggle, SpecModeInfo, SpecWorkflowBar } from "@src/components/specs"
import RooTips from "@src/components/welcome/RooTips"
import { StandardTooltip, Button } from "@src/components/ui"
import { CloudUpsellDialog } from "@src/components/cloud/CloudUpsellDialog"

import TelemetryBanner from "../common/TelemetryBanner"
import VersionIndicator from "../common/VersionIndicator"
import HistoryPreview from "../history/HistoryPreview"
import Announcement from "./Announcement"
import BrowserActionRow from "./BrowserActionRow"
import BrowserSessionStatusRow from "./BrowserSessionStatusRow"
import ChatRow from "./ChatRow"
import { ChatTextArea } from "./ChatTextArea"
import TaskHeader from "./TaskHeader"
import SystemPromptWarning from "./SystemPromptWarning"
import ProfileViolationWarning from "./ProfileViolationWarning"
import { CheckpointWarning } from "./CheckpointWarning"
import { QueuedMessages } from "./QueuedMessages"
import { WorktreeSelector } from "./WorktreeSelector"
import DismissibleUpsell from "../common/DismissibleUpsell"
import { SentinelAgentIndicator } from "./SentinelAgentIndicator"
import { UIDesignCanvasPreview } from "./UIDesignCanvasPreview"
import { useCloudUpsell } from "@src/hooks/useCloudUpsell"
import { Cloud } from "lucide-react"

export interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
}

export interface ChatViewRef {
	acceptInput: () => void
}

export const MAX_IMAGES_PER_MESSAGE = 20 // This is the Anthropic limit.

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

const ChatViewComponent: React.ForwardRefRenderFunction<ChatViewRef, ChatViewProps> = (
	{ isHidden, showAnnouncement, hideAnnouncement },
	ref,
) => {
	const isMountedRef = useRef(true)

	const [audioBaseUri] = useState(() => {
		const w = window as any
		return w.AUDIO_BASE_URI || ""
	})

	const { t } = useAppTranslation()
	const modeShortcutText = `${isMac ? "⌘" : "Ctrl"} + . ${t("chat:forNextMode")}, ${isMac ? "⌘" : "Ctrl"} + Shift + . ${t("chat:forPreviousMode")}`

	const {
		clineMessages: messages,
		currentTaskItem,
		currentTaskTodos,
		taskHistory,
		apiConfiguration,
		organizationAllowList,
		mode,
		setMode,
		alwaysAllowModeSwitch,
		customModes,
		telemetrySetting,
		hasSystemPromptOverride,
		soundEnabled,
		soundVolume,
		cloudIsAuthenticated,
		messageQueue = [],
		isBrowserSessionActive,
		sentinelAgentState,
		showWorktreesInHomeScreen,
	} = useExtensionState()

	const messagesRef = useRef(messages)

	useEffect(() => {
		messagesRef.current = messages
	}, [messages])

	// Leaving this less safe version here since if the first message is not a
	// task, then the extension is in a bad state and needs to be debugged (see
	// Cline.abort).
	const task = useMemo(() => messages.at(0), [messages])

	const latestTodos = useMemo(() => {
		// First check if we have initial todos from the state (for new subtasks)
		if (currentTaskTodos && currentTaskTodos.length > 0) {
			// Check if there are any todo updates in messages
			const messageBasedTodos = getLatestTodo(messages)
			// If there are message-based todos, they take precedence (user has updated them)
			if (messageBasedTodos && messageBasedTodos.length > 0) {
				return messageBasedTodos
			}
			// Otherwise use the initial todos from state
			return currentTaskTodos
		}
		// Fall back to extracting from messages
		return getLatestTodo(messages)
	}, [messages, currentTaskTodos])

	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])

	// Has to be after api_req_finished are all reduced into api_req_started messages.
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const inputValueRef = useRef(inputValue)
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [sendingDisabled, setSendingDisabled] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])

	// We need to hold on to the ask because useEffect > lastMessage will always
	// let us know when an ask comes in and handle it, but by the time
	// handleMessage is called, the last message might not be the ask anymore
	// (it could be a say that followed).
	const [clineAsk, setClineAsk] = useState<ClineAsk | undefined>(undefined)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)
	const [_didClickCancel, setDidClickCancel] = useState(false)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const prevExpandedRowsRef = useRef<Record<number, boolean>>()
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const stickyFollowRef = useRef<boolean>(false)
	const [showScrollToBottom, setShowScrollToBottom] = useState(false)
	const [isAtBottom, setIsAtBottom] = useState(false)
	const lastTtsRef = useRef<string>("")
	const [wasStreaming, setWasStreaming] = useState<boolean>(false)
	const [checkpointWarning, setCheckpointWarning] = useState<
		{ type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"; timeout: number } | undefined
	>(undefined)
	const [isCondensing, setIsCondensing] = useState<boolean>(false)
	const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
	const [isCanvasPreviewCollapsed, setIsCanvasPreviewCollapsed] = useState(false)
	const everVisibleMessagesTsRef = useRef<LRUCache<number, boolean>>(
		new LRUCache({
			max: 100,
			ttl: 1000 * 60 * 5,
		}),
	)
	const autoApproveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const userRespondedRef = useRef<boolean>(false)
	const [currentFollowUpTs, setCurrentFollowUpTs] = useState<number | null>(null)
	const [aggregatedCostsMap, setAggregatedCostsMap] = useState<
		Map<
			string,
			{
				totalCost: number
				ownCost: number
				childrenCost: number
			}
		>
	>(new Map())

	const clineAskRef = useRef(clineAsk)
	useEffect(() => {
		clineAskRef.current = clineAsk
	}, [clineAsk])

	const {
		isOpen: isUpsellOpen,
		openUpsell,
		closeUpsell,
		handleConnect,
	} = useCloudUpsell({
		autoOpenOnAuth: false,
	})

	// Keep inputValueRef in sync with inputValue state
	useEffect(() => {
		inputValueRef.current = inputValue
	}, [inputValue])

	// Compute whether auto-approval is paused (user is typing in a followup)
	const isFollowUpAutoApprovalPaused = useMemo(() => {
		return !!(inputValue && inputValue.trim().length > 0 && clineAsk === "followup")
	}, [inputValue, clineAsk])

	// Cancel auto-approval timeout when user starts typing
	useEffect(() => {
		// Only send cancel if there's actual input (user is typing)
		// and we have a pending follow-up question
		if (isFollowUpAutoApprovalPaused) {
			vscode.postMessage({ type: "cancelAutoApproval" })
		}
	}, [isFollowUpAutoApprovalPaused])

	useEffect(() => {
		isMountedRef.current = true
		return () => {
			isMountedRef.current = false
		}
	}, [])

	const isProfileDisabled = useMemo(
		() => !!apiConfiguration && !ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList),
		[apiConfiguration, organizationAllowList],
	)

	// UI layout depends on the last 2 messages (since it relies on the content
	// of these messages, we are deep comparing) i.e. the button state after
	// hitting button sets enableButtons to false,  and this effect otherwise
	// would have to true again even if messages didn't change.
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])

	const volume = typeof soundVolume === "number" ? soundVolume : 0.5
	const [playNotification] = useSound(`${audioBaseUri}/notification.wav`, { volume, soundEnabled })
	const [playCelebration] = useSound(`${audioBaseUri}/celebration.wav`, { volume, soundEnabled })
	const [playProgressLoop] = useSound(`${audioBaseUri}/progress_loop.wav`, { volume, soundEnabled })

	const playSound = useCallback(
		(audioType: AudioType) => {
			if (!soundEnabled) {
				return
			}

			switch (audioType) {
				case "notification":
					playNotification()
					break
				case "celebration":
					playCelebration()
					break
				case "progress_loop":
					playProgressLoop()
					break
				default:
					console.warn(`Unknown audio type: ${audioType}`)
			}
		},
		[soundEnabled, playNotification, playCelebration, playProgressLoop],
	)

	function playTts(text: string, agentSlug?: string) {
		vscode.postMessage({ type: "playTts", text, agentSlug })
	}

	useDeepCompareEffect(() => {
		// if last message is an ask, show user ask UI
		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					// Reset user response flag when a new ask arrives to allow auto-approval
					userRespondedRef.current = false
					const isPartial = lastMessage.partial === true
					switch (lastMessage.ask) {
						case "api_req_failed":
							playSound("progress_loop")
							setSendingDisabled(true)
							setClineAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:retry.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "mistake_limit_reached":
							playSound("progress_loop")
							setSendingDisabled(false)
							setClineAsk("mistake_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedAnyways.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "followup":
							setSendingDisabled(isPartial)
							setClineAsk("followup")
							// setting enable buttons to `false` would trigger a focus grab when
							// the text area is enabled which is undesirable.
							// We have no buttons for this tool, so no problem having them "enabled"
							// to workaround this issue.  See #1358.
							setEnableButtons(true)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "tool":
							setSendingDisabled(isPartial)
							setClineAsk("tool")
							setEnableButtons(!isPartial)
							const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool
							switch (tool.tool) {
								case "editedExistingFile":
								case "appliedDiff":
								case "newFileCreated":
								case "generateImage":
									setPrimaryButtonText(t("chat:save.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
								case "finishTask":
									setPrimaryButtonText(t("chat:completeSubtaskAndReturn"))
									setSecondaryButtonText(undefined)
									break
								case "readFile":
									if (tool.batchFiles && Array.isArray(tool.batchFiles)) {
										setPrimaryButtonText(t("chat:read-batch.approve.title"))
										setSecondaryButtonText(t("chat:read-batch.deny.title"))
									} else {
										setPrimaryButtonText(t("chat:approve.title"))
										setSecondaryButtonText(t("chat:reject.title"))
									}
									break
								default:
									setPrimaryButtonText(t("chat:approve.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
							}
							break
						case "browser_action_launch":
							setSendingDisabled(isPartial)
							setClineAsk("browser_action_launch")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command":
							setSendingDisabled(isPartial)
							setClineAsk("command")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:runCommand.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command_output":
							setSendingDisabled(false)
							setClineAsk("command_output")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
							setSecondaryButtonText(t("chat:killCommand.title"))
							break
						case "use_mcp_server":
							setSendingDisabled(isPartial)
							setClineAsk("use_mcp_server")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "completion_result":
							// Extension waiting for feedback, but we can just present a new task button.
							// Only play celebration sound if there are no queued messages.
							if (!isPartial && messageQueue.length === 0) {
								playSound("celebration")
							}
							setSendingDisabled(isPartial)
							setClineAsk("completion_result")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							setSendingDisabled(false)
							setClineAsk("resume_task")
							setEnableButtons(true)
							// For completed subtasks, show "Start New Task" instead of "Resume"
							// A subtask is considered completed if:
							// - It has a parentTaskId AND
							// - Its messages contain a completion_result (either ask or say)
							const isCompletedSubtask =
								currentTaskItem?.parentTaskId &&
								messages.some(
									(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
								)
							if (isCompletedSubtask) {
								setPrimaryButtonText(t("chat:startNewTask.title"))
								setSecondaryButtonText(undefined)
							} else {
								setPrimaryButtonText(t("chat:resumeTask.title"))
								setSecondaryButtonText(t("chat:terminate.title"))
							}
							setDidClickCancel(false) // special case where we reset the cancel button state
							break
						case "resume_completed_task":
							setSendingDisabled(false)
							setClineAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
					}
					break
				case "say":
					// Don't want to reset since there could be a "say" after
					// an "ask" while ask is waiting for response.
					switch (lastMessage.say) {
						case "api_req_retry_delayed":
						case "api_req_rate_limit_wait":
							setSendingDisabled(true)
							break
						case "api_req_started":
							// Clear button state when a new API request starts
							// This fixes buttons persisting when the task continues
							setSendingDisabled(true)
							setSelectedImages([])
							setClineAsk(undefined)
							setEnableButtons(false)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "api_req_finished":
						case "error":
						case "text":
						case "browser_action":
						case "browser_action_result":
						case "command_output":
						case "mcp_server_request_started":
						case "mcp_server_response":
						case "completion_result":
							break
					}
					break
			}
		}
	}, [lastMessage, secondLastMessage])

	// Update button text when messages change (e.g., completion_result is added) for subtasks in resume_task state
	useEffect(() => {
		if (clineAsk === "resume_task" && currentTaskItem?.parentTaskId) {
			const hasCompletionResult = messages.some(
				(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
			)
			if (hasCompletionResult) {
				setPrimaryButtonText(t("chat:startNewTask.title"))
				setSecondaryButtonText(undefined)
			}
		}
	}, [clineAsk, currentTaskItem?.parentTaskId, messages, t])

	useEffect(() => {
		if (messages.length === 0) {
			setSendingDisabled(false)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	useEffect(() => {
		// Reset UI states only when task changes
		setExpandedRows({})
		everVisibleMessagesTsRef.current.clear() // Clear for new task
		setCurrentFollowUpTs(null) // Clear follow-up answered state for new task
		setIsCondensing(false) // Reset condensing state when switching tasks
		// Note: sendingDisabled is not reset here as it's managed by message effects

		// Clear any pending auto-approval timeout from previous task
		if (autoApproveTimeoutRef.current) {
			clearTimeout(autoApproveTimeoutRef.current)
			autoApproveTimeoutRef.current = null
		}
		// Reset user response flag for new task
		userRespondedRef.current = false
	}, [task?.ts])

	const taskTs = task?.ts

	// Request aggregated costs when task changes and has childIds
	useEffect(() => {
		if (taskTs && currentTaskItem?.childIds && currentTaskItem.childIds.length > 0) {
			vscode.postMessage({
				type: "getTaskWithAggregatedCosts",
				text: currentTaskItem.id,
			})
		}
	}, [taskTs, currentTaskItem?.id, currentTaskItem?.childIds])

	useEffect(() => {
		if (isHidden) {
			everVisibleMessagesTsRef.current.clear()
		}
	}, [isHidden])

	useEffect(() => {
		const cache = everVisibleMessagesTsRef.current
		return () => {
			cache.clear()
		}
	}, [])

	useEffect(() => {
		const prev = prevExpandedRowsRef.current
		let wasAnyRowExpandedByUser = false
		if (prev) {
			// Check if any row transitioned from false/undefined to true
			for (const [tsKey, isExpanded] of Object.entries(expandedRows)) {
				const ts = Number(tsKey)
				if (isExpanded && !(prev[ts] ?? false)) {
					wasAnyRowExpandedByUser = true
					break
				}
			}
		}

		// Expanding a row indicates the user is browsing; disable sticky follow
		if (wasAnyRowExpandedByUser) {
			stickyFollowRef.current = false
		}

		prevExpandedRowsRef.current = expandedRows // Store current state for next comparison
	}, [expandedRows])

	const isStreaming = useMemo(() => {
		// Checking clineAsk isn't enough since messages effect may be called
		// again for a tool for example, set clineAsk to its value, and if the
		// next message is not an ask then it doesn't reset. This is likely due
		// to how much more often we're updating messages as compared to before,
		// and should be resolved with optimizations as it's likely a rendering
		// bug. But as a final guard for now, the cancel button will show if the
		// last message is not an ask.
		const isLastAsk = !!modifiedMessages.at(-1)?.ask

		const isToolCurrentlyAsking =
			isLastAsk && clineAsk !== undefined && enableButtons && primaryButtonText !== undefined

		if (isToolCurrentlyAsking) {
			return false
		}

		const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true

		if (isLastMessagePartial) {
			return true
		} else {
			const lastApiReqStarted = findLast(
				modifiedMessages,
				(message: ClineMessage) => message.say === "api_req_started",
			)

			if (
				lastApiReqStarted &&
				lastApiReqStarted.text !== null &&
				lastApiReqStarted.text !== undefined &&
				lastApiReqStarted.say === "api_req_started"
			) {
				const cost = JSON.parse(lastApiReqStarted.text).cost

				if (cost === undefined) {
					return true // API request has not finished yet.
				}
			}
		}

		return false
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText])

	const markFollowUpAsAnswered = useCallback(() => {
		const lastFollowUpMessage = messagesRef.current.findLast((msg: ClineMessage) => msg.ask === "followup")
		if (lastFollowUpMessage) {
			setCurrentFollowUpTs(lastFollowUpMessage.ts)
		}
	}, [])

	const handleChatReset = useCallback(() => {
		// Clear any pending auto-approval timeout
		if (autoApproveTimeoutRef.current) {
			clearTimeout(autoApproveTimeoutRef.current)
			autoApproveTimeoutRef.current = null
		}
		// Reset user response flag for new message
		userRespondedRef.current = false

		// Only reset message-specific state, preserving mode.
		setInputValue("")
		setSendingDisabled(true)
		setSelectedImages([])
		setClineAsk(undefined)
		setEnableButtons(false)
		// Do not reset mode here as it should persist.
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
	}, [])

	/**
	 * Handles sending messages to the extension
	 * @param text - The message text to send
	 * @param images - Array of image data URLs to send with the message
	 */
	const handleSendMessage = useCallback(
		(text: string, images: string[]) => {
			text = text.trim()

			if (text || images.length > 0) {
				// Queue message if:
				// - Task is busy (sendingDisabled)
				// - API request in progress (isStreaming)
				// - Queue has items (preserve message order during drain)
				if (sendingDisabled || isStreaming || messageQueue.length > 0) {
					try {
						console.log("queueMessage", text, images)
						vscode.postMessage({ type: "queueMessage", text, images })
						setInputValue("")
						setSelectedImages([])
					} catch (error) {
						console.error(
							`Failed to queue message: ${error instanceof Error ? error.message : String(error)}`,
						)
					}

					return
				}

				// Mark that user has responded - this prevents any pending auto-approvals.
				userRespondedRef.current = true

				if (messagesRef.current.length === 0) {
					vscode.postMessage({ type: "newTask", text, images })
				} else if (clineAskRef.current) {
					if (clineAskRef.current === "followup") {
						markFollowUpAsAnswered()
					}

					// Use clineAskRef.current
					switch (
						clineAskRef.current // Use clineAskRef.current
					) {
						case "followup":
						case "tool":
						case "browser_action_launch":
						case "command": // User can provide feedback to a tool or command use.
						case "command_output": // User can send input to command stdin.
						case "use_mcp_server":
						case "completion_result": // If this happens then the user has feedback for the completion result.
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
							vscode.postMessage({
								type: "askResponse",
								askResponse: "messageResponse",
								text,
								images,
							})
							break
						// There is no other case that a textfield should be enabled.
					}
				} else {
					// This is a new message in an ongoing task.
					vscode.postMessage({ type: "askResponse", askResponse: "messageResponse", text, images })
				}

				handleChatReset()
			}
		},
		[handleChatReset, markFollowUpAsAnswered, sendingDisabled, isStreaming, messageQueue.length], // messagesRef and clineAskRef are stable
	)

	const handleSetChatBoxMessage = useCallback(
		(text: string, images: string[]) => {
			// Avoid nested template literals by breaking down the logic
			let newValue = text

			if (inputValue !== "") {
				newValue = inputValue + " " + text
			}

			setInputValue(newValue)
			setSelectedImages([...selectedImages, ...images])
		},
		[inputValue, selectedImages],
	)

	const startNewTask = useCallback(() => vscode.postMessage({ type: "clearTask" }), [])

	// Handle stop button click from textarea
	const handleStopTask = useCallback(() => {
		vscode.postMessage({ type: "cancelTask" })
		setDidClickCancel(true)
	}, [setDidClickCancel])

	// Handle enqueue button click from textarea
	const handleEnqueueCurrentMessage = useCallback(() => {
		const text = inputValue.trim()
		if (text || selectedImages.length > 0) {
			vscode.postMessage({
				type: "queueMessage",
				text,
				images: selectedImages,
			})
			setInputValue("")
			setSelectedImages([])
		}
	}, [inputValue, selectedImages])

	// This logic depends on the useEffect[messages] above to set clineAsk,
	// after which buttons are shown and we then send an askResponse to the
	// extension.
	const handlePrimaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			// Mark that user has responded
			userRespondedRef.current = true

			const trimmedInput = text?.trim()

			switch (clineAsk) {
				case "api_req_failed":
				case "command":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
				case "mistake_limit_reached":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							text: trimmedInput,
							images: images,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
					}
					break
				case "resume_task":
					// For completed subtasks (tasks with a parentTaskId and a completion_result),
					// start a new task instead of resuming since the subtask is done
					const isCompletedSubtaskForClick =
						currentTaskItem?.parentTaskId &&
						messagesRef.current.some(
							(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
						)
					if (isCompletedSubtaskForClick) {
						startNewTask()
					} else {
						// Only send text/images if they exist
						if (trimmedInput || (images && images.length > 0)) {
							vscode.postMessage({
								type: "askResponse",
								askResponse: "yesButtonClicked",
								text: trimmedInput,
								images: images,
							})
							// Clear input state after sending
							setInputValue("")
							setSelectedImages([])
						} else {
							vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
						}
					}
					break
				case "completion_result":
				case "resume_completed_task":
					// Waiting for feedback, but we can just present a new task button
					startNewTask()
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "continue" })
					break
			}

			setSendingDisabled(true)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		},
		[clineAsk, startNewTask, currentTaskItem?.parentTaskId],
	)

	const handleSecondaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			// Mark that user has responded
			userRespondedRef.current = true

			const trimmedInput = text?.trim()

			if (isStreaming) {
				vscode.postMessage({ type: "cancelTask" })
				setDidClickCancel(true)
				return
			}

			switch (clineAsk) {
				case "api_req_failed":
				case "mistake_limit_reached":
				case "resume_task":
					startNewTask()
					break
				case "command":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
							text: trimmedInput,
							images: images,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						// Responds to the API with a "This operation failed" and lets it try again
						vscode.postMessage({ type: "askResponse", askResponse: "noButtonClicked" })
					}
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "abort" })
					break
			}
			setSendingDisabled(true)
			setClineAsk(undefined)
			setEnableButtons(false)
		},
		[clineAsk, startNewTask, isStreaming, setDidClickCancel],
	)

	const { info: model } = useSelectedModel(apiConfiguration)

	const selectImages = useCallback(() => vscode.postMessage({ type: "selectImages" }), [])

	const shouldDisableImages = !model?.supportsImages || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data

			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							if (!isHidden && !sendingDisabled && !enableButtons) {
								textAreaRef.current?.focus()
							}
							break
						case "focusInput":
							textAreaRef.current?.focus()
							break
					}
					break
				case "selectedImages":
					// Only handle selectedImages if it's not for editing context
					// When context is "edit", ChatRow will handle the images
					if (message.context !== "edit") {
						setSelectedImages((prevImages: string[]) =>
							appendImages(prevImages, message.images, MAX_IMAGES_PER_MESSAGE),
						)
					}
					break
				case "invoke":
					switch (message.invoke!) {
						case "newChat":
							handleChatReset()
							break
						case "sendMessage":
							handleSendMessage(message.text ?? "", message.images ?? [])
							break
						case "setChatBoxMessage":
							handleSetChatBoxMessage(message.text ?? "", message.images ?? [])
							break
						case "primaryButtonClick":
							handlePrimaryButtonClick(message.text ?? "", message.images ?? [])
							break
						case "secondaryButtonClick":
							handleSecondaryButtonClick(message.text ?? "", message.images ?? [])
							break
					}
					break
				case "condenseTaskContextStarted":
					// Handle both manual and automatic condensation start
					// We don't check the task ID because:
					// 1. There can only be one active task at a time
					// 2. Task switching resets isCondensing to false (see useEffect with task?.ts dependency)
					// 3. For new tasks, currentTaskItem may not be populated yet due to async state updates
					if (message.text) {
						setIsCondensing(true)
						// Note: sendingDisabled is only set for manual condensation via handleCondenseContext
						// Automatic condensation doesn't disable sending since the task is already running
					}
					break
				case "condenseTaskContextResponse":
					// Same reasoning as above - we trust this is for the current task
					if (message.text) {
						if (isCondensing && sendingDisabled) {
							setSendingDisabled(false)
						}
						setIsCondensing(false)
					}
					break
				case "checkpointInitWarning":
					setCheckpointWarning(message.checkpointWarning)
					break
				case "interactionRequired":
					playSound("notification")
					break
				case "taskWithAggregatedCosts":
					if (message.text && message.aggregatedCosts) {
						setAggregatedCostsMap((prev) => {
							const newMap = new Map(prev)
							newMap.set(message.text!, message.aggregatedCosts!)
							return newMap
						})
					}
					break
			}
			// textAreaRef.current is not explicitly required here since React
			// guarantees that ref will be stable across re-renders, and we're
			// not using its value but its reference.
		},
		[
			isCondensing,
			isHidden,
			sendingDisabled,
			enableButtons,
			handleChatReset,
			handleSendMessage,
			handleSetChatBoxMessage,
			handlePrimaryButtonClick,
			handleSecondaryButtonClick,
			setCheckpointWarning,
			playSound,
		],
	)

	useEvent("message", handleMessage)

	const visibleMessages = useMemo(() => {
		// Pre-compute checkpoint hashes that have associated user messages for O(1) lookup
		const userMessageCheckpointHashes = new Set<string>()
		modifiedMessages.forEach((msg) => {
			if (
				msg.say === "user_feedback" &&
				msg.checkpoint &&
				(msg.checkpoint as any).type === "user_message" &&
				(msg.checkpoint as any).hash
			) {
				userMessageCheckpointHashes.add((msg.checkpoint as any).hash)
			}
		})

		// Remove the 500-message limit to prevent array index shifting
		// Virtuoso is designed to efficiently handle large lists through virtualization
		const newVisibleMessages = modifiedMessages.filter((message) => {
			// Filter out checkpoint_saved messages that should be suppressed
			if (message.say === "checkpoint_saved") {
				// Check if this checkpoint has the suppressMessage flag set
				if (
					message.checkpoint &&
					typeof message.checkpoint === "object" &&
					"suppressMessage" in message.checkpoint &&
					message.checkpoint.suppressMessage
				) {
					return false
				}
				// Also filter out checkpoint messages associated with user messages (legacy behavior)
				if (message.text && userMessageCheckpointHashes.has(message.text)) {
					return false
				}
			}

			if (everVisibleMessagesTsRef.current.has(message.ts)) {
				const alwaysHiddenOnceProcessedAsk: ClineAsk[] = [
					"api_req_failed",
					"resume_task",
					"resume_completed_task",
				]
				const alwaysHiddenOnceProcessedSay = [
					"api_req_finished",
					"api_req_retried",
					"api_req_deleted",
					"mcp_server_request_started",
				]
				if (message.ask && alwaysHiddenOnceProcessedAsk.includes(message.ask)) return false
				if (message.say && alwaysHiddenOnceProcessedSay.includes(message.say)) return false
				if (message.say === "text" && (message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
					return false
				}
				return true
			}

			switch (message.ask) {
				case "completion_result":
					if (message.text === "") return false
					break
				case "api_req_failed":
				case "resume_task":
				case "resume_completed_task":
					return false
			}
			switch (message.say) {
				case "api_req_finished":
				case "api_req_retried":
				case "api_req_deleted":
					return false
				case "api_req_retry_delayed":
				case "api_req_rate_limit_wait":
					const last1 = modifiedMessages.at(-1)
					const last2 = modifiedMessages.at(-2)
					if (last1?.ask === "resume_task" && last2 === message) {
						return true
					} else if (message !== last1) {
						return false
					}
					break
				case "text":
					if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) return false
					break
				case "mcp_server_request_started":
					return false
			}
			return true
		})

		const viewportStart = Math.max(0, newVisibleMessages.length - 100)
		newVisibleMessages
			.slice(viewportStart)
			.forEach((msg: ClineMessage) => everVisibleMessagesTsRef.current.set(msg.ts, true))

		return newVisibleMessages
	}, [modifiedMessages])

	useEffect(() => {
		const cleanupInterval = setInterval(() => {
			const cache = everVisibleMessagesTsRef.current
			const currentMessageIds = new Set(modifiedMessages.map((m: ClineMessage) => m.ts))
			const viewportMessages = visibleMessages.slice(Math.max(0, visibleMessages.length - 100))
			const viewportMessageIds = new Set(viewportMessages.map((m: ClineMessage) => m.ts))

			cache.forEach((_value: boolean, key: number) => {
				if (!currentMessageIds.has(key) && !viewportMessageIds.has(key)) {
					cache.delete(key)
				}
			})
		}, 60000)

		return () => clearInterval(cleanupInterval)
	}, [modifiedMessages, visibleMessages])

	useDebounceEffect(
		() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		},
		50,
		[isHidden, sendingDisabled, enableButtons],
	)

	useEffect(() => {
		// This ensures the first message is not read, future user messages are
		// labeled as `user_feedback`.
		if (lastMessage && messages.length > 1) {
			if (
				typeof lastMessage.text === "string" && // has text (must be string for startsWith)
				(lastMessage.say === "text" || lastMessage.say === "completion_result") && // is a text message
				!lastMessage.partial && // not a partial message
				!lastMessage.text.startsWith("{") // not a json object
			) {
				let text = lastMessage?.text || ""

				// Check if this is an AI-to-AI conversation (has agentName)
				// These messages should always be read for TTS (e.g., Architect answering another agent)
				const isAgentMessage = !!(lastMessage as any).agentName

				// Filter out tool-related and technical content for TTS
				// Skip messages that are primarily about tool operations
				// IMPORTANT: Most patterns should match at START of message (^) to avoid false positives
				// NOTE: Agent messages bypass this filter to ensure AI-to-AI conversations are read
				const toolPatterns = [
					// Tool action indicators (at start)
					/^(Let me|I'll|I'm going to|I will|Now I|First,? I|Next,? I).{0,30}(read|write|search|execute|run|check|look|find|create|edit|modify|delete|update|open|close|list|get|fetch|call|use)/i,
					// Progress indicators at start (English)
					/^(Processing|Loading|Searching|Reading|Writing|Executing|Running|Checking|Looking|Finding|Creating|Editing|Modifying|Deleting|Updating|Fetching|Calling|Submitting|Connecting|Disconnecting|Initializing|Starting|Stopping)\b/i,
					// Chinese progress indicators at start
					/^(正在|開始|準備|執行中|讀取中|寫入中|搜尋中|搜索中|檢查中|查找中)/,
					// Status messages at start
					/^(Done|Completed|Finished|Success|Failed|Error|Warning)\b/i,
					// File path mentions at start (likely tool output)
					/^(File|Path|Directory|Folder|Found|Located|Created|Modified|Deleted):/i,
					// Command execution at start
					/^(Running|Executing|Command|Terminal|Output|Result):/i,
					// Emoji-prefixed status/progress messages (common status emojis at START)
					/^[🔍🔄✅❌⚠️📁📄💾🔧⏳✨🎨🚀💡📝🔗🎯📊🔥💫🌟⭐📌🏷️🎉👍👎💪🤖🧠📋📦🔒🔓🛠️⚙️🔌📡🌐💻🖥️📱⚡☑️✔️☐]/,
					// MCP/API related at start
					/^(MCP|API|Tool|Request|Response|Calling|Invoking)\b/i,
					// Agent handoff messages - SPECIFIC patterns only (not just "designer" anywhere)
					/^(Submitting|Transferring|Handing off) .*(context|handoff)/i,
					/handoff context from \w+-\w+/i,
					/switching (to|from) (sentinel|architect|designer|coder) mode/i,
					// Parallel tasks/batch operations - SPECIFIC patterns
					/^(Executing|Processing|Completed) \d+ (MCP|parallel|batch)/i,
					// Figma technical output - SPECIFIC patterns (not just "figma" anywhere)
					/^(Figma|MCP):/i,
					/\d+ MCP calls/i,
					/node (created|deleted|moved) with ID/i,
					// Code-like content
					/^```[\s\S]*```$/,
					/^`[^`]+`$/,
				]

				// Check if the message matches any tool pattern
				// Agent messages (AI-to-AI conversations) bypass this filter
				const isToolMessage = !isAgentMessage && toolPatterns.some((pattern) => pattern.test(text.trim()))
				if (isToolMessage) {
					return // Skip TTS for tool-related messages
				}

				// Additional handoff/system message patterns that should ALSO be filtered for agent messages
				// These are workflow/system notifications that shouldn't be read by TTS
				const handoffPatterns = [
					// Handoff completion messages
					/✅\s*\*?\*?Sentinel Handoff/i,
					/Sentinel Handoff Complete/i,
					// Context reset messages
					/🔄\s*Context Reset/i,
					/Context Reset for/i,
					// Handoff details
					/Handoff Summary/i,
					/Handoff Context/i,
					/\*?\*?From:?\*?\*?\s*(sentinel-|🟦|🎨|🟩|💬|🔒)/i,
					/\*?\*?To:?\*?\*?\s*(sentinel-|🟦|🎨|🟩|💬|🔒)/i,
					// Workflow continuation
					/workflow continues with/i,
					/starts with fresh context/i,
					/context has been saved/i,
					// Plan creation
					/📝\s*\*?\*?Plan created/i,
					/Preview is now open/i,
					// Attempt markers
					/Attempt #\d+/i,
					/\(Attempt #\d+\)/i,
					// Agent emoji indicators in workflow messages
					/🟦\s*(Architect|Builder|Designer)/i,
					/🎨\s*(Architect|Builder|Designer)/i,
					/🟩\s*(Architect|Builder|Designer)/i,
					/💬\s*(Architect|Builder|Designer|Review)/i,
					/🔒\s*(Sentinel|Security)/i,
					// Browser/DOM extraction output
					/🔍\s*\*?\*?DOM STRUCTURE EXTRACTED/i,
					/DOM extraction failed/i,
					/Use this to verify UI layout/i,
					// Architect approval messages
					/🟦\s*\*?\*?Architect 審批通過/i,
					/Architect 自動批准/i,
					/工具請求已被.*批准/i,
					/Tool request.*approved/i,
					// Mode switch messages
					/Auto-approved mode switch/i,
					/sentinel-\w+\s*→\s*sentinel-\w+/i,
					// Auto-approved command messages - multiple patterns for robustness
					/⚡\s*\*{0,2}Auto-approved command/i,
					/Auto-approved command:/i,
					/Auto-approved command/i,
					/⚡.*Auto-approved/i,
					// Auto-Background and background service messages
					/☑️\s*Auto-Background/i,
					/Auto-Background:/i,
					/🚀\s*Auto-approved/i,
					/🚀\s*Starting background service/i,
					/Starting background service:/i,
					/Detected server command/i,
					/running in background/i,
					/on port \d+/i,
					// Sentinel mode interception messages
					/🔄\s*\*?\*?Sentinel Mode/i,
					/Sentinel Mode:.*Intercepting/i,
					/Intercepting completion from/i,
					/Initiating handoff/i,
					// Parallel AI tasks messages
					/🚀\s*Launching.*parallel.*agents?/i,
					/Launching \d+ parallel AI/i,
					/parallel (AI )?agents? for/i,
					/inside frame \d+:\d+/i,
					// Task completion summaries
					/✅\s*All \d+ parallel.*completed/i,
					/parallel.*tasks? completed/i,
					/📊\s*Summary/i,
					/Total duration.*ms/i,
					/nodes? created/i,
					/📋\s*Task Results/i,
					/\[[\w-]+\]\s*[✓✔]\s*-?\s*\d+\s*nodes?/i,
					// Parallel UI drawing tasks
					/🎨\s*Starting \d+ parallel/i,
					/Starting \d+ parallel UI drawing/i,
					/parallel UI drawing tasks/i,
					// UI element creation list items with [component-name] patterns
					/^\d+\.\s*\[[\w-]+\]/m,
					/\[title\].*@\s*\(\d+/i,
					/\[[\w-]+-input\].*@\s*\(\d+/i,
					/\[[\w-]+-btn\].*@\s*\(\d+/i,
					/\[[\w-]+-link\].*@\s*\(\d+/i,
					/\[[\w-]+-text\].*@\s*\(\d+/i,
					// Grid layout messages
					/📍\s*Grid layout/i,
					/Grid layout:\s*\d+\s*columns?/i,
					// Color codes and position info
					/🎨\s*#[A-Fa-f0-9]{6}\s*@\s*\(\d+,\s*\d+\)/,
					/#[A-Fa-f0-9]{6}\s*@\s*\(\d+,\s*\d+\)/,
				]
				const isHandoffMessage = handoffPatterns.some((pattern) => pattern.test(text.trim()))
				if (isHandoffMessage) {
					return // Skip TTS for handoff/system messages
				}

				// Direct string check for common system messages that should ALWAYS be filtered
				// This is a fallback in case regex patterns fail due to encoding issues
				const textLower = text.toLowerCase()
				const alwaysFilterPhrases = [
					"auto-approved command",
					"auto-approved mode",
					"auto-approved:",
					"auto-background",
					"sentinel handoff",
					"context reset",
					"handoff context",
					"intercepting completion",
					"initiating handoff",
					"parallel ai agents",
					"parallel ui tasks",
					"dom structure extracted",
					"starting background service",
					"detected server command",
					"running in background",
					"background service",
					"on port 3000",
					"on port 8080",
					"on port 5000",
				]
				if (alwaysFilterPhrases.some((phrase) => textLower.includes(phrase))) {
					return // Skip TTS for system messages
				}

				// For agent messages, extract just the response content for cleaner TTS
				if (isAgentMessage) {
					// Remove the header (e.g., "🟦 **Architect 回答了 Agent 的問題：**")
					// and quote blocks (the original question)
					text = text.replace(/^.*回答了.*的問題[：:]\s*/i, "")
					text = text.replace(/^>.*$/gm, "") // Remove quote blocks
					text = text.replace(/^\*\*回答[：:]\*\*\s*/im, "") // Remove "回答：" header
					text = text.replace(/^\*\*問題[：:]\*\*\s*.*$/im, "") // Remove "問題：" line
				}

				// Remove code blocks
				text = text.replace(/```[\s\S]*?```/g, "")
				// Remove inline code
				text = text.replace(/`[^`]+`/g, "")
				// Remove mermaid diagrams
				const mermaidRegex = /```mermaid[\s\S]*?```/g
				text = text.replace(mermaidRegex, "")
				// Remove markdown from text
				text = removeMd(text)
				// Remove leading/trailing whitespace
				text = text.trim()

				// Skip if text is too short after filtering (likely just emoji or punctuation)
				if (text.length < 10) {
					return
				}

				// ensure message is not a duplicate of last read message
				if (text !== lastTtsRef.current) {
					try {
						// Pass agent slug for voice selection
						// Agent messages use the agent's voice, other messages use current mode's voice
						const agentSlug = isAgentMessage
							? (lastMessage as any).agentName?.toLowerCase().includes("architect")
								? "sentinel-architect"
								: (lastMessage as any).agentName?.toLowerCase().includes("designer")
									? "sentinel-designer"
									: (lastMessage as any).agentName?.toLowerCase().includes("builder")
										? "sentinel-builder"
										: (lastMessage as any).agentName?.toLowerCase().includes("qa")
											? "sentinel-qa"
											: (lastMessage as any).agentName?.toLowerCase().includes("review")
												? "sentinel-design-review"
												: undefined
							: undefined
						playTts(text, agentSlug)
						lastTtsRef.current = text
					} catch (error) {
						console.error("Failed to execute text-to-speech:", error)
					}
				}
			}
		}

		// Update previous value.
		setWasStreaming(isStreaming)
	}, [isStreaming, lastMessage, wasStreaming, messages.length])

	// Compute current browser session messages for the top banner (not grouped into chat stream)
	// Find the FIRST browser session from the beginning to show ALL sessions
	const browserSessionStartIndex = useMemo(() => {
		for (let i = 0; i < messages.length; i++) {
			if (messages[i].ask === "browser_action_launch") {
				return i
			}
		}
		return -1
	}, [messages])

	const _browserSessionMessages = useMemo<ClineMessage[]>(() => {
		if (browserSessionStartIndex === -1) return []
		return messages.slice(browserSessionStartIndex)
	}, [browserSessionStartIndex, messages])

	// Show globe toggle only when in a task that has a browser session (active or inactive)
	const showBrowserDockToggle = useMemo(
		() => Boolean(task && (browserSessionStartIndex !== -1 || isBrowserSessionActive)),
		[task, browserSessionStartIndex, isBrowserSessionActive],
	)

	const isBrowserSessionMessage = useCallback((message: ClineMessage): boolean => {
		// Only the launch ask should be hidden from chat (it's shown in the drawer header)
		if (message.type === "ask" && message.ask === "browser_action_launch") {
			return true
		}
		// browser_action_result messages are paired with browser_action and should not appear independently
		if (message.type === "say" && message.say === "browser_action_result") {
			return true
		}
		return false
	}, [])

	const groupedMessages = useMemo(() => {
		// Only filter out the launch ask and result messages - browser actions appear in chat
		const filtered: ClineMessage[] = visibleMessages.filter((msg) => !isBrowserSessionMessage(msg))

		// Helper to check if a message is a read_file ask that should be batched
		const isReadFileAsk = (msg: ClineMessage): boolean => {
			if (msg.type !== "ask" || msg.ask !== "tool") return false
			try {
				const tool = JSON.parse(msg.text || "{}")
				return tool.tool === "readFile" && !tool.batchFiles // Don't re-batch already batched
			} catch {
				return false
			}
		}

		// Consolidate consecutive read_file ask messages into batches
		const result: ClineMessage[] = []
		let i = 0
		while (i < filtered.length) {
			const msg = filtered[i]

			// Check if this starts a sequence of read_file asks
			if (isReadFileAsk(msg)) {
				// Collect all consecutive read_file asks
				const batch: ClineMessage[] = [msg]
				let j = i + 1
				while (j < filtered.length && isReadFileAsk(filtered[j])) {
					batch.push(filtered[j])
					j++
				}

				if (batch.length > 1) {
					// Create a synthetic batch message
					const batchFiles = batch.map((batchMsg) => {
						try {
							const tool = JSON.parse(batchMsg.text || "{}")
							return {
								path: tool.path || "",
								lineSnippet: tool.reason || "",
								isOutsideWorkspace: tool.isOutsideWorkspace || false,
								key: `${tool.path}${tool.reason ? ` (${tool.reason})` : ""}`,
								content: tool.content || "",
							}
						} catch {
							return { path: "", lineSnippet: "", key: "", content: "" }
						}
					})

					// Use the first message as the base, but add batchFiles
					const firstTool = JSON.parse(msg.text || "{}")
					const syntheticMessage: ClineMessage = {
						...msg,
						text: JSON.stringify({
							...firstTool,
							batchFiles,
						}),
						// Store original messages for response handling
						_batchedMessages: batch,
					} as ClineMessage & { _batchedMessages: ClineMessage[] }

					result.push(syntheticMessage)
					i = j // Skip past all batched messages
				} else {
					// Single read_file ask, keep as-is
					result.push(msg)
					i++
				}
			} else {
				result.push(msg)
				i++
			}
		}

		if (isCondensing) {
			result.push({
				type: "say",
				say: "condense_context",
				ts: Date.now(),
				partial: true,
			} as any)
		}
		return result
	}, [isCondensing, visibleMessages, isBrowserSessionMessage])

	// scrolling

	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(() => virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "smooth" }), 10, {
				immediate: true,
			}),
		[],
	)

	useEffect(() => {
		return () => {
			if (scrollToBottomSmooth && typeof (scrollToBottomSmooth as any).cancel === "function") {
				;(scrollToBottomSmooth as any).cancel()
			}
		}
	}, [scrollToBottomSmooth])

	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollTo({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto", // Instant causes crash.
		})
	}, [])

	const handleSetExpandedRow = useCallback(
		(ts: number, expand?: boolean) => {
			setExpandedRows((prev: Record<number, boolean>) => ({
				...prev,
				[ts]: expand === undefined ? !prev[ts] : expand,
			}))
		},
		[setExpandedRows], // setExpandedRows is stable
	)

	// Scroll when user toggles certain rows.
	const toggleRowExpansion = useCallback(
		(ts: number) => {
			handleSetExpandedRow(ts)
			// The logic to set disableAutoScrollRef.current = true on expansion
			// is now handled by the useEffect hook that observes expandedRows.
		},
		[handleSetExpandedRow],
	)

	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (isAtBottom) {
				if (isTaller) {
					scrollToBottomSmooth()
				} else {
					setTimeout(() => scrollToBottomAuto(), 0)
				}
			}
		},
		[scrollToBottomSmooth, scrollToBottomAuto, isAtBottom],
	)

	// Disable sticky follow when user scrolls up inside the chat container
	const handleWheel = useCallback((event: Event) => {
		const wheelEvent = event as WheelEvent
		if (wheelEvent.deltaY < 0 && scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
			stickyFollowRef.current = false
		}
	}, [])
	useEvent("wheel", handleWheel, window, { passive: true })

	// Also disable sticky follow when the chat container is scrolled away from bottom
	useEffect(() => {
		const el = scrollContainerRef.current
		if (!el) return
		const onScroll = () => {
			// Consider near-bottom within a small threshold consistent with Virtuoso settings
			const nearBottom = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 10
			if (!nearBottom) {
				stickyFollowRef.current = false
			}
			// Keep UI button state in sync with scroll position
			setShowScrollToBottom(!nearBottom)
		}
		el.addEventListener("scroll", onScroll, { passive: true })
		return () => el.removeEventListener("scroll", onScroll)
	}, [])

	// Effect to clear checkpoint warning when messages appear or task changes
	useEffect(() => {
		if (isHidden || !task) {
			setCheckpointWarning(undefined)
		}
	}, [modifiedMessages.length, isStreaming, isHidden, task])

	const placeholderText = task ? t("chat:typeMessage") : t("chat:typeTask")

	const switchToMode = useCallback(
		(modeSlug: string): void => {
			// Update local state and notify extension to sync mode change.
			setMode(modeSlug)

			// Send the mode switch message.
			vscode.postMessage({ type: "mode", text: modeSlug })
		},
		[setMode],
	)

	const handleSuggestionClickInRow = useCallback(
		(suggestion: SuggestionItem, event?: React.MouseEvent) => {
			// Mark that user has responded if this is a manual click (not auto-approval)
			if (event) {
				userRespondedRef.current = true
			}

			// Mark the current follow-up question as answered when a suggestion is clicked
			if (clineAsk === "followup" && !event?.shiftKey) {
				markFollowUpAsAnswered()
			}

			// Check if we need to switch modes
			if (suggestion.mode) {
				// Only switch modes if it's a manual click (event exists) or auto-approval is allowed
				// BUT skip mode switch if Sentinel workflow is active (feedback goes back to the workflow)
				const isManualClick = !!event
				const isSentinelActive = sentinelAgentState?.enabled === true
				if ((isManualClick || alwaysAllowModeSwitch) && !isSentinelActive) {
					// Switch mode without waiting
					switchToMode(suggestion.mode)
				}
			}

			if (event?.shiftKey) {
				// Always append to existing text, don't overwrite
				setInputValue((currentValue: string) => {
					return currentValue !== "" ? `${currentValue} \n${suggestion.answer}` : suggestion.answer
				})
			} else {
				// Don't clear the input value when sending a follow-up choice
				// The message should be sent but the text area should preserve what the user typed
				const preservedInput = inputValueRef.current
				handleSendMessage(suggestion.answer, [])
				// Restore the input value after sending
				setInputValue(preservedInput)
			}
		},
		[
			handleSendMessage,
			setInputValue,
			switchToMode,
			alwaysAllowModeSwitch,
			clineAsk,
			markFollowUpAsAnswered,
			sentinelAgentState,
		],
	)

	const handleBatchFileResponse = useCallback((response: { [key: string]: boolean }) => {
		// Handle batch file response, e.g., for file uploads
		vscode.postMessage({ type: "askResponse", askResponse: "objectResponse", text: JSON.stringify(response) })
	}, [])

	const itemContent = useCallback(
		(index: number, messageOrGroup: ClineMessage) => {
			const hasCheckpoint = modifiedMessages.some((message) => message.say === "checkpoint_saved")

			// Check if this is a browser action message
			if (messageOrGroup.type === "say" && messageOrGroup.say === "browser_action") {
				// Find the corresponding result message by looking for the next browser_action_result after this action's timestamp
				const nextMessage = modifiedMessages.find(
					(m) => m.ts > messageOrGroup.ts && m.say === "browser_action_result",
				)

				// Calculate action index and total count
				const browserActions = modifiedMessages.filter((m) => m.say === "browser_action")
				const actionIndex = browserActions.findIndex((m) => m.ts === messageOrGroup.ts) + 1
				const totalActions = browserActions.length

				return (
					<BrowserActionRow
						key={messageOrGroup.ts}
						message={messageOrGroup}
						nextMessage={nextMessage}
						actionIndex={actionIndex}
						totalActions={totalActions}
					/>
				)
			}

			// Check if this is a browser session status message
			if (messageOrGroup.type === "say" && messageOrGroup.say === "browser_session_status") {
				return <BrowserSessionStatusRow key={messageOrGroup.ts} message={messageOrGroup} />
			}

			// regular message
			return (
				<ChatRow
					key={messageOrGroup.ts}
					message={messageOrGroup}
					isExpanded={expandedRows[messageOrGroup.ts] || false}
					onToggleExpand={toggleRowExpansion} // This was already stabilized
					lastModifiedMessage={modifiedMessages.at(-1)} // Original direct access
					isLast={index === groupedMessages.length - 1} // Original direct access
					onHeightChange={handleRowHeightChange}
					isStreaming={isStreaming}
					onSuggestionClick={handleSuggestionClickInRow} // This was already stabilized
					onBatchFileResponse={handleBatchFileResponse}
					isFollowUpAnswered={messageOrGroup.isAnswered === true || messageOrGroup.ts === currentFollowUpTs}
					isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
					editable={
						messageOrGroup.type === "ask" &&
						messageOrGroup.ask === "tool" &&
						(() => {
							let tool: any = {}
							try {
								tool = JSON.parse(messageOrGroup.text || "{}")
							} catch (_) {
								if (messageOrGroup.text?.includes("updateTodoList")) {
									tool = { tool: "updateTodoList" }
								}
							}
							return tool.tool === "updateTodoList" && enableButtons && !!primaryButtonText
						})()
					}
					hasCheckpoint={hasCheckpoint}
				/>
			)
		},
		[
			expandedRows,
			toggleRowExpansion,
			modifiedMessages,
			groupedMessages.length,
			handleRowHeightChange,
			isStreaming,
			handleSuggestionClickInRow,
			handleBatchFileResponse,
			currentFollowUpTs,
			isFollowUpAutoApprovalPaused,
			enableButtons,
			primaryButtonText,
		],
	)

	// Function to handle mode switching
	const switchToNextMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const nextModeIndex = (currentModeIndex + 1) % allModes.length
		// Update local state and notify extension to sync mode change
		switchToMode(allModes[nextModeIndex].slug)
	}, [mode, customModes, switchToMode])

	// Function to handle switching to previous mode
	const switchToPreviousMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const previousModeIndex = (currentModeIndex - 1 + allModes.length) % allModes.length
		// Update local state and notify extension to sync mode change
		switchToMode(allModes[previousModeIndex].slug)
	}, [mode, customModes, switchToMode])

	// Add keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			// Check for Command/Ctrl + Period (with or without Shift)
			// Using event.key to respect keyboard layouts (e.g., Dvorak)
			if ((event.metaKey || event.ctrlKey) && event.key === ".") {
				event.preventDefault() // Prevent default browser behavior

				if (event.shiftKey) {
					// Shift + Period = Previous mode
					switchToPreviousMode()
				} else {
					// Just Period = Next mode
					switchToNextMode()
				}
			}
		},
		[switchToNextMode, switchToPreviousMode],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)

		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])

	useImperativeHandle(ref, () => ({
		acceptInput: () => {
			if (enableButtons && primaryButtonText) {
				handlePrimaryButtonClick(inputValue, selectedImages)
			} else if (!sendingDisabled && !isProfileDisabled && (inputValue.trim() || selectedImages.length > 0)) {
				handleSendMessage(inputValue, selectedImages)
			}
		},
	}))

	const handleCondenseContext = (taskId: string) => {
		if (isCondensing || sendingDisabled) {
			return
		}
		setIsCondensing(true)
		setSendingDisabled(true)
		vscode.postMessage({ type: "condenseTaskContextRequest", text: taskId })
	}

	const areButtonsVisible = showScrollToBottom || primaryButtonText || secondaryButtonText

	return (
		<div
			data-testid="chat-view"
			className={isHidden ? "hidden" : "fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden"}>
			{telemetrySetting === "unset" && <TelemetryBanner />}
			{(showAnnouncement || showAnnouncementModal) && (
				<Announcement
					hideAnnouncement={() => {
						if (showAnnouncementModal) {
							setShowAnnouncementModal(false)
						}
						if (showAnnouncement) {
							hideAnnouncement()
						}
					}}
				/>
			)}
			{task ? (
				<>
					<TaskHeader
						task={task}
						tokensIn={apiMetrics.totalTokensIn}
						tokensOut={apiMetrics.totalTokensOut}
						cacheWrites={apiMetrics.totalCacheWrites}
						cacheReads={apiMetrics.totalCacheReads}
						totalCost={apiMetrics.totalCost}
						aggregatedCost={
							currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
								? aggregatedCostsMap.get(currentTaskItem.id)!.totalCost
								: undefined
						}
						hasSubtasks={
							!!(
								currentTaskItem?.id &&
								aggregatedCostsMap.has(currentTaskItem.id) &&
								aggregatedCostsMap.get(currentTaskItem.id)!.childrenCost > 0
							)
						}
						parentTaskId={currentTaskItem?.parentTaskId}
						costBreakdown={
							currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
								? getCostBreakdownIfNeeded(aggregatedCostsMap.get(currentTaskItem.id)!, {
										own: t("common:costs.own"),
										subtasks: t("common:costs.subtasks"),
									})
								: undefined
						}
						contextTokens={apiMetrics.contextTokens}
						buttonsDisabled={sendingDisabled}
						handleCondenseContext={handleCondenseContext}
						todos={latestTodos}
					/>

					{hasSystemPromptOverride && (
						<div className="px-3">
							<SystemPromptWarning />
						</div>
					)}

					{checkpointWarning && (
						<div className="px-3">
							<CheckpointWarning warning={checkpointWarning} />
						</div>
					)}
				</>
			) : (
				<div className="flex flex-col h-full min-h-0 relative">
					{/* Spec Mode Toggle - Fixed at top */}
					<div className="flex-shrink-0 p-4 border-b border-[var(--vscode-panel-border)]">
						<SpecModeToggle isSpecMode={mode === "spec"} onToggle={(isSpec) => setMode(isSpec ? "spec" : "code")} />
						{mode === "spec" && <SpecModeInfo />}
					</div>
					{/* Scrollable content area */}
					<div className="flex-1 overflow-y-auto p-6">
						<div className="flex flex-col items-start gap-4 min-[400px]:px-6">
							<VersionIndicator
								onClick={() => setShowAnnouncementModal(true)}
								className="absolute top-2 right-3 z-10"
							/>
							<RooHero />
							{/* Show RooTips when authenticated or when user is new */}
							{taskHistory.length < 6 && <RooTips />}
							{/* Everyone should see their task history if any */}
							{taskHistory.length > 0 && <HistoryPreview />}
						</div>

						{/* Logged out users should see a one-time upsell, but not for brand new users */}
						{!cloudIsAuthenticated && taskHistory.length >= 6 && (
							<DismissibleUpsell
								upsellId="taskList2"
								icon={<Cloud className="size-5 shrink-0" />}
								onClick={() => openUpsell()}
								dismissOnClick={false}
								className="bg-none mt-6 border-border rounded-xl p-3 !text-base">
								<Trans
									i18nKey="cloud:upsell.taskList"
									components={{
										learnMoreLink: <VSCodeLink href="#" />,
									}}
								/>
							</DismissibleUpsell>
						)}
					</div>
				</div>
			)}

			{!task && showWorktreesInHomeScreen && <WorktreeSelector />}

			{task && (
				<>
					{/* UI Design Canvas Preview - shows when Designer is active */}
					<UIDesignCanvasPreview
							collapsed={isCanvasPreviewCollapsed}
							onToggleCollapse={() => setIsCanvasPreviewCollapsed(!isCanvasPreviewCollapsed)}
						/>

					{/* Sentinel Agent Status Indicator */}
					<div className="px-4 pt-2">
						<SentinelAgentIndicator variant="full" />
					</div>

					{/* Spec Mode Workflow Bar - shows progress: Requirements → Design → Tasks */}
					{mode === "spec" && (
						<div className="px-4 py-2">
							<SpecWorkflowBar />
						</div>
					)}
					<div className="grow flex" ref={scrollContainerRef}>
						<Virtuoso
							ref={virtuosoRef}
							key={task.ts}
							className="scrollable grow overflow-y-scroll mb-1"
							increaseViewportBy={{ top: 3_000, bottom: 1000 }}
							data={groupedMessages}
							itemContent={itemContent}
							followOutput={(isAtBottom: boolean) => isAtBottom || stickyFollowRef.current}
							atBottomStateChange={(isAtBottom: boolean) => {
								setIsAtBottom(isAtBottom)
								// Only show the scroll-to-bottom button if not at bottom
								setShowScrollToBottom(!isAtBottom)
							}}
							atBottomThreshold={10}
							initialTopMostItemIndex={groupedMessages.length - 1}
						/>
					</div>
					{areButtonsVisible && (
						<div
							className={`flex h-9 items-center mb-1 px-[15px] ${
								showScrollToBottom ? "opacity-100" : enableButtons ? "opacity-100" : "opacity-50"
							}`}>
							{showScrollToBottom ? (
								<StandardTooltip content={t("chat:scrollToBottom")}>
									<Button
										variant="secondary"
										className="flex-[2]"
										onClick={() => {
											// Engage sticky follow until user scrolls up
											stickyFollowRef.current = true
											// Pin immediately to avoid lag during fast streaming
											scrollToBottomAuto()
											// Hide button immediately to prevent flash
											setShowScrollToBottom(false)
										}}>
										<span className="codicon codicon-chevron-down"></span>
									</Button>
								</StandardTooltip>
							) : (
								<>
									{primaryButtonText && (
										<StandardTooltip
											content={
												primaryButtonText === t("chat:retry.title")
													? t("chat:retry.tooltip")
													: primaryButtonText === t("chat:save.title")
														? t("chat:save.tooltip")
														: primaryButtonText === t("chat:approve.title")
															? t("chat:approve.tooltip")
															: primaryButtonText === t("chat:runCommand.title")
																? t("chat:runCommand.tooltip")
																: primaryButtonText === t("chat:startNewTask.title")
																	? t("chat:startNewTask.tooltip")
																	: primaryButtonText === t("chat:resumeTask.title")
																		? t("chat:resumeTask.tooltip")
																		: primaryButtonText ===
																			  t("chat:proceedAnyways.title")
																			? t("chat:proceedAnyways.tooltip")
																			: primaryButtonText ===
																				  t("chat:proceedWhileRunning.title")
																				? t("chat:proceedWhileRunning.tooltip")
																				: undefined
											}>
											<Button
												variant="primary"
												disabled={!enableButtons}
												className={secondaryButtonText ? "flex-1 mr-[6px]" : "flex-[2] mr-0"}
												onClick={() => handlePrimaryButtonClick(inputValue, selectedImages)}>
												{primaryButtonText}
											</Button>
										</StandardTooltip>
									)}
									{secondaryButtonText && (
										<StandardTooltip
											content={
												secondaryButtonText === t("chat:startNewTask.title")
													? t("chat:startNewTask.tooltip")
													: secondaryButtonText === t("chat:reject.title")
														? t("chat:reject.tooltip")
														: secondaryButtonText === t("chat:terminate.title")
															? t("chat:terminate.tooltip")
															: secondaryButtonText === t("chat:killCommand.title")
																? t("chat:killCommand.tooltip")
																: undefined
											}>
											<Button
												variant="secondary"
												disabled={!enableButtons}
												className="flex-1 ml-[6px]"
												onClick={() => handleSecondaryButtonClick(inputValue, selectedImages)}>
												{secondaryButtonText}
											</Button>
										</StandardTooltip>
									)}
								</>
							)}
						</div>
					)}
				</>
			)}

			<QueuedMessages
				queue={messageQueue}
				onRemove={(index) => {
					if (messageQueue[index]) {
						vscode.postMessage({ type: "removeQueuedMessage", text: messageQueue[index].id })
					}
				}}
				onUpdate={(index, newText) => {
					if (messageQueue[index]) {
						vscode.postMessage({
							type: "editQueuedMessage",
							payload: { id: messageQueue[index].id, text: newText, images: messageQueue[index].images },
						})
					}
				}}
			/>
			<ChatTextArea
				ref={textAreaRef}
				inputValue={inputValue}
				setInputValue={setInputValue}
				sendingDisabled={sendingDisabled || isProfileDisabled}
				selectApiConfigDisabled={sendingDisabled && clineAsk !== "api_req_failed"}
				placeholderText={placeholderText}
				selectedImages={selectedImages}
				setSelectedImages={setSelectedImages}
				onSend={() => handleSendMessage(inputValue, selectedImages)}
				onSelectImages={selectImages}
				shouldDisableImages={shouldDisableImages}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				mode={mode}
				setMode={setMode}
				modeShortcutText={modeShortcutText}
				isBrowserSessionActive={!!isBrowserSessionActive}
				showBrowserDockToggle={showBrowserDockToggle}
				isStreaming={isStreaming}
				onStop={handleStopTask}
				onEnqueueMessage={handleEnqueueCurrentMessage}
			/>

			{isProfileDisabled && (
				<div className="px-3">
					<ProfileViolationWarning />
				</div>
			)}

			<div id="roo-portal" />
			<CloudUpsellDialog open={isUpsellOpen} onOpenChange={closeUpsell} onConnect={handleConnect} />
		</div>
	)
}

const ChatView = forwardRef(ChatViewComponent)

export default ChatView
