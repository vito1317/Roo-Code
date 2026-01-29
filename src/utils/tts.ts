interface Say {
	speak: (text: string, voice?: string, speed?: number, callback?: (err?: string) => void) => void
	stop: () => void
}

type PlayTtsOptions = {
	onStart?: () => void
	onStop?: () => void
	voice?: string // Voice name for TTS (e.g., "Alex", "Samantha", "Daniel")
}

type QueueItem = {
	message: string
	options: PlayTtsOptions
}

let isTtsEnabled = false

export const setTtsEnabled = (enabled: boolean) => (isTtsEnabled = enabled)

let speed = 1.0

export const setTtsSpeed = (newSpeed: number) => (speed = newSpeed)

// Current voice setting - can be changed per-agent
let currentVoice: string | undefined = undefined

export const setTtsVoice = (voice: string | undefined) => (currentVoice = voice)

// Chinese voice for macOS (Ting-Ting is Mandarin Chinese)
const CHINESE_VOICE = "Ting-Ting"

/**
 * Detect if text contains Chinese characters
 * Returns true if there are ANY Chinese characters in the text
 * This is more permissive to ensure Chinese content gets read with Chinese voice
 */
function containsChinese(text: string): boolean {
	// Chinese character ranges: CJK Unified Ideographs, CJK Extension A, common punctuation
	const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/
	return chineseRegex.test(text)
}

/**
 * Get the appropriate voice for the text based on language detection
 * Priority: Chinese voice if text contains Chinese, otherwise use preferred voice
 */
function getVoiceForText(text: string, preferredVoice?: string): string | undefined {
	// If text contains ANY Chinese characters, use Chinese voice
	// This ensures mixed Chinese/English text is read with Chinese voice
	if (containsChinese(text)) {
		return CHINESE_VOICE
	}
	// Otherwise use the preferred voice or current voice setting
	return preferredVoice || currentVoice || undefined
}

let sayInstance: Say | undefined = undefined
let queue: QueueItem[] = []

export const playTts = async (message: string, options: PlayTtsOptions = {}) => {
	if (!isTtsEnabled) {
		return
	}

	try {
		queue.push({ message, options })
		await processQueue()
	} catch (error) {}
}

export const stopTts = () => {
	sayInstance?.stop()
	sayInstance = undefined
	queue = []
}

const processQueue = async (): Promise<void> => {
	if (!isTtsEnabled || sayInstance) {
		return
	}

	const item = queue.shift()

	if (!item) {
		return
	}

	try {
		const { message: nextUtterance, options } = item

		await new Promise<void>((resolve, reject) => {
			const say: Say = require("say")
			sayInstance = say
			options.onStart?.()

			// Use language-aware voice selection
			// If text contains Chinese, use Chinese voice regardless of agent preference
			const voice = getVoiceForText(nextUtterance, options.voice)

			say.speak(nextUtterance, voice, speed, (err) => {
				options.onStop?.()

				if (err) {
					reject(new Error(err))
				} else {
					resolve()
				}

				sayInstance = undefined
			})
		})

		await processQueue()
	} catch (error: any) {
		sayInstance = undefined
		await processQueue()
	}
}
