import removeMd from "remove-markdown"

/**
 * Tool patterns that indicate a message should be skipped for TTS
 * These are primarily tool/progress/status messages that aren't conversational
 */
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

/**
 * Handoff/system message patterns that should be filtered even for agent messages
 */
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

export interface TtsCheckResult {
	willSpeak: boolean
	processedText: string
	skipReason?: string
}

/**
 * Check if a message will be read by TTS and get the processed text
 * @param text The original message text
 * @param isAgentMessage Whether this is an AI-to-AI message (has agentName)
 * @returns Object containing whether TTS will speak and the processed text
 */
export function checkTtsStatus(text: string | undefined, isAgentMessage: boolean = false): TtsCheckResult {
	if (!text) {
		return { willSpeak: false, processedText: "", skipReason: "Empty text" }
	}

	const trimmedText = text.trim()

	// Check tool patterns (agent messages bypass this)
	if (!isAgentMessage) {
		const isToolMessage = toolPatterns.some((pattern) => pattern.test(trimmedText))
		if (isToolMessage) {
			return { willSpeak: false, processedText: "", skipReason: "Tool/progress message" }
		}
	}

	// Check handoff patterns (applies to all messages)
	const isHandoffMessage = handoffPatterns.some((pattern) => pattern.test(trimmedText))
	if (isHandoffMessage) {
		return { willSpeak: false, processedText: "", skipReason: "Handoff/system message" }
	}

	// Direct string check for common system messages that should ALWAYS be filtered
	// This is a fallback in case regex patterns fail due to encoding issues
	const textLower = trimmedText.toLowerCase()
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
		return { willSpeak: false, processedText: "", skipReason: "System message (direct match)" }
	}

	// Process text for TTS
	let processedText = text

	// For agent messages, clean up the format
	if (isAgentMessage) {
		processedText = processedText.replace(/^.*回答了.*的問題[：:]\s*/i, "")
		processedText = processedText.replace(/^>.*$/gm, "") // Remove quote blocks
		processedText = processedText.replace(/^\*\*回答[：:]\*\*\s*/im, "") // Remove "回答：" header
		processedText = processedText.replace(/^\*\*問題[：:]\*\*\s*.*$/im, "") // Remove "問題：" line
	}

	// Remove code blocks
	processedText = processedText.replace(/```[\s\S]*?```/g, "")
	// Remove inline code
	processedText = processedText.replace(/`[^`]+`/g, "")
	// Remove mermaid diagrams
	processedText = processedText.replace(/```mermaid[\s\S]*?```/g, "")
	// Remove markdown
	processedText = removeMd(processedText)
	// Trim whitespace
	processedText = processedText.trim()

	// Check if text is too short after filtering
	if (processedText.length < 10) {
		return { willSpeak: false, processedText, skipReason: "Text too short after processing" }
	}

	return { willSpeak: true, processedText }
}

/**
 * Get a short preview of the TTS text (for tooltips)
 * @param processedText The processed TTS text
 * @param maxLength Maximum length of preview
 * @returns Truncated preview text
 */
export function getTtsPreview(processedText: string, maxLength: number = 100): string {
	if (processedText.length <= maxLength) {
		return processedText
	}
	return processedText.substring(0, maxLength) + "..."
}
