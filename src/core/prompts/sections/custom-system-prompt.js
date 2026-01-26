import fs from "fs/promises";
import path from "path";
import { fileExistsAtPath } from "../../../utils/fs";
function interpolatePromptContent(content, variables) {
    let interpolatedContent = content;
    for (const key in variables) {
        if (Object.prototype.hasOwnProperty.call(variables, key) &&
            variables[key] !== undefined) {
            const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, "g");
            interpolatedContent = interpolatedContent.replace(placeholder, variables[key]);
        }
    }
    return interpolatedContent;
}
/**
 * Safely reads a file, returning an empty string if the file doesn't exist
 */
async function safeReadFile(filePath) {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        // When reading with "utf-8" encoding, content should be a string
        return content.trim();
    }
    catch (err) {
        const errorCode = err.code;
        if (!errorCode || !["ENOENT", "EISDIR"].includes(errorCode)) {
            throw err;
        }
        return "";
    }
}
/**
 * Get the path to a system prompt file for a specific mode
 */
export function getSystemPromptFilePath(cwd, mode) {
    return path.join(cwd, ".roo", `system-prompt-${mode}`);
}
/**
 * Loads custom system prompt from a file at .roo/system-prompt-[mode slug]
 * If the file doesn't exist, returns an empty string
 */
export async function loadSystemPromptFile(cwd, mode, variables) {
    const filePath = getSystemPromptFilePath(cwd, mode);
    const rawContent = await safeReadFile(filePath);
    if (!rawContent) {
        return "";
    }
    const interpolatedContent = interpolatePromptContent(rawContent, variables);
    return interpolatedContent;
}
/**
 * Ensures the .roo directory exists, creating it if necessary
 */
export async function ensureRooDirectory(cwd) {
    const rooDir = path.join(cwd, ".roo");
    // Check if directory already exists
    if (await fileExistsAtPath(rooDir)) {
        return;
    }
    // Create the directory
    try {
        await fs.mkdir(rooDir, { recursive: true });
    }
    catch (err) {
        // If directory already exists (race condition), ignore the error
        const errorCode = err.code;
        if (errorCode !== "EEXIST") {
            throw err;
        }
    }
}
//# sourceMappingURL=custom-system-prompt.js.map