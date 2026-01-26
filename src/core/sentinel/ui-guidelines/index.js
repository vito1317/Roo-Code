/**
 * UI Guidelines Retrieval System
 *
 * RAG-based system for retrieving UI design guidelines based on detected UI type.
 * Guidelines are stored as markdown files and injected into Architect Review context.
 */
import * as fs from "fs";
import * as path from "path";
// Keywords for detecting UI types from user requests
const UI_TYPE_KEYWORDS = {
    calculator: ["calculator", "calc", "計算機", "計算器", "numpad", "arithmetic"],
    form: ["form", "input", "表單", "registration", "login", "signup", "contact form"],
    navigation: ["navbar", "navigation", "menu", "sidebar", "導航", "選單"],
    table: ["table", "grid", "datagrid", "表格", "列表", "spreadsheet"],
    modal: ["modal", "dialog", "popup", "彈窗", "對話框", "alert"],
    general: [] // Fallback, no keywords
};
/**
 * Detect the UI type from user request or plan content
 */
export function detectUIType(text) {
    const lowerText = text.toLowerCase();
    for (const [uiType, keywords] of Object.entries(UI_TYPE_KEYWORDS)) {
        if (uiType === "general")
            continue; // Skip fallback
        for (const keyword of keywords) {
            if (lowerText.includes(keyword.toLowerCase())) {
                return uiType;
            }
        }
    }
    return "general"; // Default fallback
}
/**
 * Get the file path for a UI type's guidelines
 */
function getGuidelinesPath(uiType) {
    return path.join(__dirname, `${uiType}.md`);
}
/**
 * Retrieve UI guidelines for a specific type
 */
export function getUIGuidelines(uiType) {
    const guidelinesPath = getGuidelinesPath(uiType);
    try {
        if (fs.existsSync(guidelinesPath)) {
            return fs.readFileSync(guidelinesPath, "utf-8");
        }
    }
    catch (error) {
        console.error(`[UIGuidelines] Error reading ${uiType} guidelines:`, error);
    }
    // Fallback to general guidelines
    try {
        const generalPath = getGuidelinesPath("general");
        return fs.readFileSync(generalPath, "utf-8");
    }
    catch (error) {
        console.error("[UIGuidelines] Error reading general guidelines:", error);
        return "";
    }
}
/**
 * Get UI guidelines based on text content (auto-detect type)
 */
export function getUIGuidelinesFromText(text) {
    const uiType = detectUIType(text);
    const guidelines = getUIGuidelines(uiType);
    return { uiType, guidelines };
}
/**
 * Format guidelines for injection into handoff context
 */
export function formatGuidelinesForHandoff(uiType, guidelines) {
    return `
## UI Guidelines for ${uiType.toUpperCase()}

${guidelines}

---
**IMPORTANT**: Follow the verification checklist above. REJECT if any item fails.
`;
}
/**
 * Get formatted guidelines ready for handoff injection
 */
export function getFormattedUIGuidelines(userRequest) {
    const { uiType, guidelines } = getUIGuidelinesFromText(userRequest);
    if (!guidelines) {
        return "";
    }
    return formatGuidelinesForHandoff(uiType, guidelines);
}
//# sourceMappingURL=index.js.map