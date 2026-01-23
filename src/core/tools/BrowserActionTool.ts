import { Anthropic } from "@anthropic-ai/sdk"

import { BrowserAction, BrowserActionResult, browserActions, ClineSayBrowserAction } from "@roo-code/types"

import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"

import { scaleCoordinate } from "../../shared/browserUtils"

export async function browserActionTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
) {
	const action: BrowserAction | undefined = block.params.action as BrowserAction
	const url: string | undefined = block.params.url
	const coordinate: string | undefined = block.params.coordinate
	const text: string | undefined = block.params.text
	const size: string | undefined = block.params.size
	const filePath: string | undefined = block.params.path

	if (!action || !browserActions.includes(action)) {
		// checking for action to ensure it is complete and valid
		if (!block.partial) {
			// if the block is complete and we don't have a valid action cline is a mistake
			cline.consecutiveMistakeCount++
			cline.recordToolError("browser_action")
			cline.didToolFailInCurrentTurn = true
			pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "action"))
			// Do not close the browser on parameter validation errors
		}

		return
	}

	try {
		if (block.partial) {
			if (action === "launch") {
				await cline.ask("browser_action_launch", url ?? "", block.partial).catch(() => {})
			} else {
				await cline.say(
					"browser_action",
					JSON.stringify({
						action: action as BrowserAction,
						coordinate: coordinate ?? "",
						text: text ?? "",
						size: size ?? "",
					} satisfies ClineSayBrowserAction),
					undefined,
					block.partial,
				)
			}
			return
		} else {
			// Initialize with empty object to avoid "used before assigned" errors
			let browserActionResult: BrowserActionResult = {}

			if (action === "launch") {
				if (!url) {
					cline.consecutiveMistakeCount++
					cline.recordToolError("browser_action")
					cline.didToolFailInCurrentTurn = true
					pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "url"))
					// Do not close the browser on parameter validation errors
					return
				}

				cline.consecutiveMistakeCount = 0
				const didApprove = await askApproval("browser_action_launch", url)

				if (!didApprove) {
					return
				}

				// NOTE: It's okay that we call cline message since the partial inspect_site is finished streaming.
				// The only scenario we have to avoid is sending messages WHILE a partial message exists at the end of the messages array.
				// For example the api_req_finished message would interfere with the partial message, so we needed to remove that.

				// Launch browser first (this triggers "Browser session opened" status message)
				await cline.browserSession.launchBrowser()

				// Create browser_action say message AFTER launching so status appears first
				await cline.say(
					"browser_action",
					JSON.stringify({
						action: "launch" as BrowserAction,
						text: url,
					} satisfies ClineSayBrowserAction),
					undefined,
					false,
				)

				browserActionResult = await cline.browserSession.navigateToUrl(url)

				// Auto-extract DOM structure for UI verification (always include)
				try {
					console.log("[DOM Extract] Attempting DOM extraction...")
					const domResult = await cline.browserSession.extractDOMStructure()
					browserActionResult.domStructure = domResult.domStructure
					console.log("[DOM Extract] Success, got structure:", domResult.domStructure?.substring(0, 100))

					// EXPLICITLY show DOM structure in chat UI
					await cline.say("text", `🔍 **DOM STRUCTURE EXTRACTED:**\n\n${domResult.domStructure}\n\n⚠️ Use this to verify UI layout!`)
				} catch (e) {
					console.error("[DOM Extract] Failed:", e)
					browserActionResult.domStructure = `[DOM EXTRACTION ERROR: ${e}]`
					await cline.say("text", `⚠️ DOM extraction failed: ${e}`)
				}
			} else {
				// Variables to hold validated and processed parameters
				let processedCoordinate = coordinate

				if (action === "click" || action === "hover") {
					if (!coordinate) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "coordinate"))
						// Do not close the browser on parameter validation errors
						return // can't be within an inner switch
					}

					// Get viewport dimensions from the browser session
					const viewportSize = cline.browserSession.getViewportSize()
					const viewportWidth = viewportSize.width || 900 // default to 900 if not available
					const viewportHeight = viewportSize.height || 600 // default to 600 if not available

					// Scale coordinate from image dimensions to viewport dimensions
					try {
						processedCoordinate = scaleCoordinate(coordinate, viewportWidth, viewportHeight)
					} catch (error) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(
							await cline.sayAndCreateMissingParamError(
								"browser_action",
								"coordinate",
								error instanceof Error ? error.message : String(error),
							),
						)
						return
					}
				}

				if (action === "type" || action === "press") {
					if (!text) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "text"))
						// Do not close the browser on parameter validation errors
						return
					}
				}

				if (action === "resize") {
					if (!size) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "size"))
						// Do not close the browser on parameter validation errors
						return
					}
				}

				if (action === "screenshot") {
					if (!filePath) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("browser_action")
						cline.didToolFailInCurrentTurn = true
						pushToolResult(await cline.sayAndCreateMissingParamError("browser_action", "path"))
						// Do not close the browser on parameter validation errors
						return
					}
				}

				cline.consecutiveMistakeCount = 0

				// Prepare say payload; include executedCoordinate for pointer actions
				const sayPayload: ClineSayBrowserAction & { executedCoordinate?: string } = {
					action: action as BrowserAction,
					coordinate,
					text,
					size,
				}
				if ((action === "click" || action === "hover") && processedCoordinate) {
					sayPayload.executedCoordinate = processedCoordinate
				}
				await cline.say("browser_action", JSON.stringify(sayPayload), undefined, false)

				switch (action) {
					case "click":
						browserActionResult = await cline.browserSession.click(processedCoordinate!)
						break
					case "hover":
						browserActionResult = await cline.browserSession.hover(processedCoordinate!)
						break
					case "type":
						browserActionResult = await cline.browserSession.type(text!)
						break
					case "press":
						browserActionResult = await cline.browserSession.press(text!)
						break
					case "scroll_down":
						browserActionResult = await cline.browserSession.scrollDown()
						break
					case "scroll_up":
						browserActionResult = await cline.browserSession.scrollUp()
						break
					case "resize":
						browserActionResult = await cline.browserSession.resize(size!)
						break
					case "screenshot":
						browserActionResult = await cline.browserSession.saveScreenshot(filePath!, cline.cwd)
						break
					case "dom_extract":
						browserActionResult = await cline.browserSession.extractDOMStructure()
						break
					case "close":
						browserActionResult = await cline.browserSession.closeBrowser()
						break
				}

				// Auto-extract DOM after UI-changing actions (click, type, press)
				if (["click", "type", "press"].includes(action)) {
					try {
						const domResult = await cline.browserSession.extractDOMStructure()
						browserActionResult.domStructure = domResult.domStructure
					} catch (e) {
						console.log("[DOM Extract] Failed after action:", e)
					}
					
					// Auto-save screenshot for test evidence
					try {
						const timestamp = Date.now()
						const screenshotName = `test_screenshot_${timestamp}.png`
						const screenshotPath = `${cline.cwd}/${screenshotName}`
						await cline.browserSession.saveScreenshot(screenshotPath, cline.cwd)
						console.log(`[Auto Screenshot] Saved: ${screenshotName}`)
					} catch (e) {
						console.log("[Auto Screenshot] Failed:", e)
					}
				}
			}

			switch (action) {
				case "launch":
				case "click":
				case "hover":
				case "type":
				case "press":
				case "scroll_down":
				case "scroll_up":
				case "resize":
				case "screenshot": {
					await cline.say("browser_action_result", JSON.stringify(browserActionResult))

					const images = browserActionResult?.screenshot ? [browserActionResult.screenshot] : []

					let messageText =
						action === "screenshot"
							? `Screenshot saved to: ${filePath}`
							: `The browser action has been executed.`

					messageText += `\n\n**CRITICAL**: When providing click/hover coordinates:`
					messageText += `\n1. Screenshot dimensions != Browser viewport dimensions`
					messageText += `\n2. Measure x,y on the screenshot image you see below`
					messageText += `\n3. Use format: <coordinate>x,y@WIDTHxHEIGHT</coordinate> where WIDTHxHEIGHT is the EXACT pixel size of the screenshot image`
					messageText += `\n4. Never use the browser viewport size for WIDTHxHEIGHT - it is only for reference and is often larger than the screenshot`
					messageText += `\n5. Screenshots are often downscaled - always use the dimensions you see in the image`
					messageText += `\nExample: Viewport 1280x800, screenshot 1000x625, click (500,300) -> <coordinate>500,300@1000x625</coordinate>`

					// Include browser viewport dimensions (for reference only)
					if (browserActionResult?.viewportWidth && browserActionResult?.viewportHeight) {
						messageText += `\n\nBrowser viewport: ${browserActionResult.viewportWidth}x${browserActionResult.viewportHeight}`
					}

					// Include cursor position if available
					if (browserActionResult?.currentMousePosition) {
						messageText += `\nCursor position: ${browserActionResult.currentMousePosition}`
					}

					// Console logs section - prominently displayed for AI debugging
					const logs = browserActionResult?.logs || ""
					const hasErrors = logs.includes("[error]") || logs.includes("[Page Error]") || 
						logs.includes("Error") || logs.includes("CORS") || logs.includes("Failed")
					
					if (hasErrors) {
						messageText += `\n\n🚨 **CONSOLE ERRORS DETECTED - ACTION REQUIRED:**\n`
						messageText += `\`\`\`\n${logs}\n\`\`\`\n`
						messageText += `⚠️ **You MUST fix these errors before proceeding!**\n`
					} else if (logs.trim()) {
						messageText += `\n\n📋 **Console Logs:**\n\`\`\`\n${logs}\n\`\`\`\n`
					} else {
						messageText += `\n\n📋 Console logs: (No new logs)\n`
					}

					// Include DOM structure for UI verification (auto-extracted on launch)
					if (browserActionResult?.domStructure) {
						messageText += `\n\n🔍 **AUTO-EXTRACTED DOM STRUCTURE (Use this for UI verification):**\n`
						messageText += browserActionResult.domStructure
						messageText += `\n⚠️ **VERIFY**: Compare the rows above to expected layout. REJECT if any button is in wrong row!`
					} else if (action === "launch") {
						messageText += `\n\n⚠️ **DOM EXTRACTION UNAVAILABLE** - Unable to extract DOM structure. Use dom_extract action manually.`
					}

					if (images.length > 0) {
						const blocks = [
							...formatResponse.imageBlocks(images),
							{ type: "text", text: messageText } as Anthropic.TextBlockParam,
						]
						pushToolResult(blocks)
					} else {
						pushToolResult(messageText)
					}

					break
				}
				case "dom_extract": {
					await cline.say("browser_action_result", JSON.stringify(browserActionResult))

					let messageText = `DOM Structure extracted for UI verification (no vision required).\n\n`
					messageText += browserActionResult?.domStructure || "(No elements found)"
					messageText += `\n\nURL: ${browserActionResult?.currentUrl || "unknown"}`

					if (browserActionResult?.viewportWidth && browserActionResult?.viewportHeight) {
						messageText += `\nViewport: ${browserActionResult.viewportWidth}x${browserActionResult.viewportHeight}`
					}

					pushToolResult(messageText)
					break
				}
				case "close":
					pushToolResult(
						formatResponse.toolResult(
							`The browser has been closed. You may now proceed to using other tools.`,
						),
					)

					break
			}

			return
		}
	} catch (error) {
		// Keep the browser session alive on errors; report the error without terminating the session
		await handleError("executing browser action", error)
		return
	}
}
