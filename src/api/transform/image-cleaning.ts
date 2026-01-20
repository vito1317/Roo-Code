import { ApiMessage } from "../../core/task-persistence/apiMessages"

import { ApiHandler } from "../index"

/* Removes image blocks from messages if they are not supported by the Api Handler */
export function maybeRemoveImageBlocks(messages: ApiMessage[], apiHandler: ApiHandler): ApiMessage[] {
	// Check model capability ONCE instead of for every message
	const supportsImages = apiHandler.getModel().info.supportsImages
	const modelId = apiHandler.getModel().id

	return messages.map((message) => {
		// Handle array content (could contain image blocks).
		let { content } = message
		if (Array.isArray(content)) {
			if (!supportsImages) {
				// Convert image blocks to text descriptions.
				content = content.map((block) => {
					if (block.type === "image") {
						// Provide actionable warning when vision is not supported
						return {
							type: "text",
							text: `⚠️ **VISION NOT SUPPORTED**

An image/screenshot was provided but your current model (${modelId}) does not support vision.

**You cannot see this image.** To properly review UI screenshots, the user must:
1. Switch to a vision-capable model (Claude 3, GPT-4o, Gemini Pro Vision, etc.)
2. Or configure a vision model for browser/QA tasks

**For now:** You should inform the user that you cannot verify the UI visually and request they describe what they see, or switch to a vision-capable model to proceed with proper UI verification.`,
						}
					}
					return block
				})
			}
		}
		return { ...message, content }
	})
}
