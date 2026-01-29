import { APIError } from "openai"

export function checkContextWindowExceededError(error: unknown): boolean {
	const isOpenAI = checkIsOpenAIContextWindowError(error)
	const isOpenRouter = checkIsOpenRouterContextWindowError(error)
	const isAnthropic = checkIsAnthropicContextWindowError(error)
	const isCerebras = checkIsCerebrasContextWindowError(error)

	const result = isOpenAI || isOpenRouter || isAnthropic || isCerebras

	// Debug logging for context window error detection
	if (error && typeof error === "object") {
		const err = error as Record<string, any>
		console.log("[ContextErrorHandling] Checking error:", {
			message: err.message?.substring?.(0, 200),
			status: err.status,
			code: err.code,
			name: err.name,
			isOpenAI,
			isOpenRouter,
			isAnthropic,
			isCerebras,
			detected: result,
		})
	}

	return result
}

function checkIsOpenRouterContextWindowError(error: unknown): boolean {
	try {
		if (!error || typeof error !== "object") {
			return false
		}

		// Use Record<string, any> for proper type narrowing
		const err = error as Record<string, any>
		const status = err.status ?? err.code ?? err.error?.status ?? err.response?.status
		const message: string = String(err.message || err.error?.message || "")

		// Known OpenAI/OpenRouter-style signal (code 400 and message includes "context length")
		const CONTEXT_ERROR_PATTERNS = [
			/\bcontext\s*(?:length|window)\b/i,
			/\bmaximum\s*context\b/i,
			/\b(?:input\s*)?tokens?\s*exceed/i,
			/\btoo\s*many\s*tokens?\b/i,
			/\bmax_tokens\s*must\s*be\s*at\s*least\b/i, // "max_tokens must be at least 1, got -5499"
			/\bmax_tokens\b.*\bgot\s*-?\d+/i, // Negative max_tokens calculation
		] as const

		return String(status) === "400" && CONTEXT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
	} catch {
		return false
	}
}

// Docs: https://platform.openai.com/docs/guides/error-codes/api-errors
function checkIsOpenAIContextWindowError(error: unknown): boolean {
	try {
		// Check for LengthFinishReasonError
		if (error && typeof error === "object" && "name" in error && error.name === "LengthFinishReasonError") {
			return true
		}

		const KNOWN_CONTEXT_ERROR_SUBSTRINGS = [
			"token",
			"context length",
			"max_tokens must be at least", // "max_tokens must be at least 1, got -5499"
		] as const

		// Check if it's an OpenAI APIError
		if (error instanceof APIError) {
			// APIError uses `status` for HTTP status code, not `code`
			// `code` is for error type like "invalid_request_error"
			const isStatus400 = error.status === 400
			const hasContextErrorMessage = KNOWN_CONTEXT_ERROR_SUBSTRINGS.some((substring) =>
				error.message.includes(substring)
			)
			return isStatus400 && hasContextErrorMessage
		}

		// Also check for generic error objects (from proxy servers, etc.)
		if (error && typeof error === "object") {
			const err = error as Record<string, any>
			// Try multiple ways to get status
			const status = err.status ?? err.statusCode ?? err.response?.status
			const message: string = String(err.message || "")

			if (String(status) === "400") {
				return KNOWN_CONTEXT_ERROR_SUBSTRINGS.some((substring) => message.includes(substring))
			}
		}

		return false
	} catch {
		return false
	}
}

function checkIsAnthropicContextWindowError(response: unknown): boolean {
	try {
		// Type guard to safely access properties
		if (!response || typeof response !== "object") {
			return false
		}

		// Use type assertions with proper checks
		const res = response as Record<string, any>

		// Check for Anthropic-specific error structure with more specific validation
		if (res.error?.error?.type === "invalid_request_error") {
			const message: string = String(res.error?.error?.message || "")

			// More specific patterns for context window errors
			const contextWindowPatterns = [
				/prompt is too long/i,
				/maximum.*tokens/i,
				/context.*too.*long/i,
				/exceeds.*context/i,
				/token.*limit/i,
				/context_length_exceeded/i,
				/max_tokens_to_sample/i,
			]

			// Additional check for Anthropic-specific error codes
			const errorCode = res.error?.error?.code
			if (errorCode === "context_length_exceeded" || errorCode === "invalid_request_error") {
				return contextWindowPatterns.some((pattern) => pattern.test(message))
			}

			return contextWindowPatterns.some((pattern) => pattern.test(message))
		}

		return false
	} catch {
		return false
	}
}

function checkIsCerebrasContextWindowError(response: unknown): boolean {
	try {
		// Type guard to safely access properties
		if (!response || typeof response !== "object") {
			return false
		}

		// Use type assertions with proper checks
		const res = response as Record<string, any>
		const status = res.status ?? res.code ?? res.error?.status ?? res.response?.status
		const message: string = String(res.message || res.error?.message || "")

		return String(status) === "400" && message.includes("Please reduce the length of the messages or completion")
	} catch {
		return false
	}
}
