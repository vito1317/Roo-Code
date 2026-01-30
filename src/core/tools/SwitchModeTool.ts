import delay from "delay"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { defaultModeSlug, getModeBySlug } from "../../shared/modes"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getAgentPersona, isSentinelAgent } from "../sentinel/personas"

interface SwitchModeParams {
	mode_slug: string
	reason: string
}

export class SwitchModeTool extends BaseTool<"switch_mode"> {
	readonly name = "switch_mode" as const

	async execute(params: SwitchModeParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { mode_slug, reason } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!mode_slug) {
				task.consecutiveMistakeCount++
				task.recordToolError("switch_mode")
				pushToolResult(await task.sayAndCreateMissingParamError("switch_mode", "mode_slug"))
				return
			}

			task.consecutiveMistakeCount = 0

			// Verify the mode exists
			const targetMode = getModeBySlug(mode_slug, (await task.providerRef.deref()?.getState())?.customModes)

			if (!targetMode) {
				task.recordToolError("switch_mode")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(`Invalid mode: ${mode_slug}`))
				return
			}

			// Check if already in requested mode
			const currentMode = (await task.providerRef.deref()?.getState())?.mode ?? defaultModeSlug

			if (currentMode === mode_slug) {
				task.recordToolError("switch_mode")
				task.didToolFailInCurrentTurn = true
				pushToolResult(`Already in ${targetMode.name} mode.`)
				return
			}

			// === WORKFLOW ENFORCEMENT ===
			// Sentinel agents can ONLY switch to modes in their canHandoffTo list
			// This prevents Architect from skipping Designer and going directly to "code"
			if (isSentinelAgent(currentMode)) {
				const currentPersona = getAgentPersona(currentMode)
				if (currentPersona) {
					const allowedTargets = currentPersona.canHandoffTo || []
					const isAllowedTarget = allowedTargets.includes(mode_slug)

					if (!isAllowedTarget) {
						// Block the mode switch with a helpful error message
						const errorMsg =
							`❌ **Workflow Violation!**\n\n` +
							`**${currentPersona.name}** (${currentMode}) cannot switch directly to "${mode_slug}".\n\n` +
							`**Allowed targets:** ${allowedTargets.length > 0 ? allowedTargets.join(", ") : "(none)"}\n\n` +
							`You must follow the proper workflow sequence. Use \`handoff_context\` to hand off to one of the allowed targets.`

						console.log(
							`[SwitchModeTool] BLOCKED: ${currentMode} -> ${mode_slug}. Allowed: [${allowedTargets.join(", ")}]`,
						)
						task.recordToolError("switch_mode")
						task.didToolFailInCurrentTurn = true
						pushToolResult(formatResponse.toolError(errorMsg))
						return
					}
				}
			}

			const completeMessage = JSON.stringify({ tool: "switchMode", mode: mode_slug, reason })

			// Auto-approve mode switches between Sentinel agents (for autonomous workflow)
			const isSentinelSource = currentMode.startsWith("sentinel-")
			const isSentinelTarget = mode_slug.startsWith("sentinel-")
			const shouldAutoApprove = isSentinelSource && isSentinelTarget

			let didApprove: boolean
			if (shouldAutoApprove) {
				// Auto-approve and notify user
				await task.say("text", `🔄 **Auto-approved mode switch:** ${currentMode} → ${mode_slug}`)
				didApprove = true
			} else {
				didApprove = await askApproval("tool", completeMessage)
			}

			if (!didApprove) {
				return
			}

			// Switch the mode using shared handler
			await task.providerRef.deref()?.handleModeSwitch(mode_slug)

			pushToolResult(
				`Successfully switched from ${getModeBySlug(currentMode)?.name ?? currentMode} mode to ${
					targetMode.name
				} mode${reason ? ` because: ${reason}` : ""}.`,
			)

			await delay(500) // Delay to allow mode change to take effect before next tool is executed
		} catch (error) {
			await handleError("switching mode", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"switch_mode">): Promise<void> {
		const mode_slug: string | undefined = block.params.mode_slug
		const reason: string | undefined = block.params.reason

		const partialMessage = JSON.stringify({
			tool: "switchMode",
			mode: mode_slug ?? "",
			reason: reason ?? "",
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const switchModeTool = new SwitchModeTool()
