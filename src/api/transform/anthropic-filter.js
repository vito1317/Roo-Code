/**
 * Set of content block types that are valid for Anthropic API.
 * Only these types will be passed through to the API.
 * See: https://docs.anthropic.com/en/api/messages
 */
export const VALID_ANTHROPIC_BLOCK_TYPES = new Set([
    "text",
    "image",
    "tool_use",
    "tool_result",
    "thinking",
    "redacted_thinking",
    "document",
]);
/**
 * Filters out non-Anthropic content blocks from messages before sending to Anthropic/Vertex API.
 * Uses an allowlist approach - only blocks with types in VALID_ANTHROPIC_BLOCK_TYPES are kept.
 * This automatically filters out:
 * - Internal "reasoning" blocks (Roo Code's internal representation)
 * - Gemini's "thoughtSignature" blocks (encrypted reasoning continuity tokens)
 * - Any other unknown block types
 */
export function filterNonAnthropicBlocks(messages) {
    const result = [];
    for (const message of messages) {
        // Extract ONLY the standard Anthropic message fields (role, content)
        // This strips out any extra fields like `reasoning_details` that other providers
        // may have added to the messages (e.g., OpenRouter adds reasoning_details for Gemini/o-series)
        const { role, content } = message;
        if (typeof content === "string") {
            // Return a clean message with only role and content
            result.push({ role, content });
            continue;
        }
        const filteredContent = content.filter((block) => {
            const blockType = block.type;
            // Only keep block types that Anthropic recognizes
            return VALID_ANTHROPIC_BLOCK_TYPES.has(blockType);
        });
        // If all content was filtered out, skip this message
        if (filteredContent.length === 0) {
            continue;
        }
        // Return a clean message with only role and content (no extra fields like reasoning_details)
        result.push({
            role,
            content: filteredContent,
        });
    }
    return result;
}
//# sourceMappingURL=anthropic-filter.js.map