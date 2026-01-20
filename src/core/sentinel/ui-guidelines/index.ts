/**
 * UI Guidelines Retrieval System
 * 
 * RAG-based system for retrieving UI design guidelines based on detected UI type.
 * Guidelines are stored as markdown files and injected into Architect Review context.
 */

import * as fs from "fs"
import * as path from "path"

// UI Types that have specific guidelines
export type UIType = 
	| "calculator"
	| "form" 
	| "navigation"
	| "table"
	| "modal"
	| "general"

// Keywords for detecting UI types from user requests
const UI_TYPE_KEYWORDS: Record<UIType, string[]> = {
	calculator: ["calculator", "calc", "計算機", "計算器", "numpad", "arithmetic"],
	form: ["form", "input", "表單", "registration", "login", "signup", "contact form"],
	navigation: ["navbar", "navigation", "menu", "sidebar", "導航", "選單"],
	table: ["table", "grid", "datagrid", "表格", "列表", "spreadsheet"],
	modal: ["modal", "dialog", "popup", "彈窗", "對話框", "alert"],
	general: [] // Fallback, no keywords
}

/**
 * Detect the UI type from user request or plan content
 */
export function detectUIType(text: string): UIType {
	const lowerText = text.toLowerCase()
	
	for (const [uiType, keywords] of Object.entries(UI_TYPE_KEYWORDS)) {
		if (uiType === "general") continue // Skip fallback
		
		for (const keyword of keywords) {
			if (lowerText.includes(keyword.toLowerCase())) {
				return uiType as UIType
			}
		}
	}
	
	return "general" // Default fallback
}

/**
 * Get the file path for a UI type's guidelines
 */
function getGuidelinesPath(uiType: UIType): string {
	return path.join(__dirname, `${uiType}.md`)
}

/**
 * Retrieve UI guidelines for a specific type
 */
export function getUIGuidelines(uiType: UIType): string {
	const guidelinesPath = getGuidelinesPath(uiType)
	
	try {
		if (fs.existsSync(guidelinesPath)) {
			return fs.readFileSync(guidelinesPath, "utf-8")
		}
	} catch (error) {
		console.error(`[UIGuidelines] Error reading ${uiType} guidelines:`, error)
	}
	
	// Fallback to general guidelines
	try {
		const generalPath = getGuidelinesPath("general")
		return fs.readFileSync(generalPath, "utf-8")
	} catch (error) {
		console.error("[UIGuidelines] Error reading general guidelines:", error)
		return ""
	}
}

/**
 * Get UI guidelines based on text content (auto-detect type)
 */
export function getUIGuidelinesFromText(text: string): { uiType: UIType; guidelines: string } {
	const uiType = detectUIType(text)
	const guidelines = getUIGuidelines(uiType)
	return { uiType, guidelines }
}

/**
 * Format guidelines for injection into handoff context
 */
export function formatGuidelinesForHandoff(uiType: UIType, guidelines: string): string {
	return `
## UI Guidelines for ${uiType.toUpperCase()}

${guidelines}

---
**IMPORTANT**: Follow the verification checklist above. REJECT if any item fails.
`
}

/**
 * Get formatted guidelines ready for handoff injection
 */
export function getFormattedUIGuidelines(userRequest: string): string {
	const { uiType, guidelines } = getUIGuidelinesFromText(userRequest)
	
	if (!guidelines) {
		return ""
	}
	
	return formatGuidelinesForHandoff(uiType, guidelines)
}
