import fs from "fs/promises";
import path from "path";
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types";
import { getReadablePath } from "../../utils/path";
import { isPathOutsideWorkspace } from "../../utils/pathUtils";
import { formatResponse } from "../prompts/responses";
import { fileExistsAtPath } from "../../utils/fs";
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments";
import { sanitizeUnifiedDiff, computeDiffStats } from "../diff/stats";
import { BaseTool } from "./BaseTool";
export class SearchAndReplaceTool extends BaseTool {
    name = "search_and_replace";
    async execute(params, task, callbacks) {
        const { path: relPath, operations } = params;
        const { askApproval, handleError, pushToolResult } = callbacks;
        try {
            // Validate required parameters
            if (!relPath) {
                task.consecutiveMistakeCount++;
                task.recordToolError("search_and_replace");
                pushToolResult(await task.sayAndCreateMissingParamError("search_and_replace", "path"));
                return;
            }
            if (!operations || !Array.isArray(operations) || operations.length === 0) {
                task.consecutiveMistakeCount++;
                task.recordToolError("search_and_replace");
                pushToolResult(formatResponse.toolError("Missing or empty 'operations' parameter. At least one search/replace operation is required."));
                return;
            }
            // Validate each operation has search and replace fields
            for (let i = 0; i < operations.length; i++) {
                const op = operations[i];
                if (!op.search) {
                    task.consecutiveMistakeCount++;
                    task.recordToolError("search_and_replace");
                    pushToolResult(formatResponse.toolError(`Operation ${i + 1} is missing the 'search' field.`));
                    return;
                }
                if (op.replace === undefined) {
                    task.consecutiveMistakeCount++;
                    task.recordToolError("search_and_replace");
                    pushToolResult(formatResponse.toolError(`Operation ${i + 1} is missing the 'replace' field.`));
                    return;
                }
            }
            const accessAllowed = task.rooIgnoreController?.validateAccess(relPath);
            if (!accessAllowed) {
                await task.say("rooignore_error", relPath);
                pushToolResult(formatResponse.rooIgnoreError(relPath));
                return;
            }
            // Check if file is write-protected
            const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false;
            const absolutePath = path.resolve(task.cwd, relPath);
            const fileExists = await fileExistsAtPath(absolutePath);
            if (!fileExists) {
                task.consecutiveMistakeCount++;
                task.recordToolError("search_and_replace");
                const errorMessage = `File not found: ${relPath}. Cannot perform search and replace on a non-existent file.`;
                await task.say("error", errorMessage);
                pushToolResult(formatResponse.toolError(errorMessage));
                return;
            }
            let fileContent;
            try {
                fileContent = await fs.readFile(absolutePath, "utf8");
                // Normalize line endings to LF for consistent matching
                fileContent = fileContent.replace(/\r\n/g, "\n");
            }
            catch (error) {
                task.consecutiveMistakeCount++;
                task.recordToolError("search_and_replace");
                const errorMessage = `Failed to read file '${relPath}'. Please verify file permissions and try again.`;
                await task.say("error", errorMessage);
                pushToolResult(formatResponse.toolError(errorMessage));
                return;
            }
            // Apply all operations sequentially
            let newContent = fileContent;
            const errors = [];
            for (let i = 0; i < operations.length; i++) {
                // Normalize line endings in search/replace strings to match file content
                const search = operations[i].search.replace(/\r\n/g, "\n");
                const replace = operations[i].replace.replace(/\r\n/g, "\n");
                const searchPattern = new RegExp(escapeRegExp(search), "g");
                const matchCount = newContent.match(searchPattern)?.length ?? 0;
                if (matchCount === 0) {
                    errors.push(`Operation ${i + 1}: No match found for search text.`);
                    continue;
                }
                if (matchCount > 1) {
                    errors.push(`Operation ${i + 1}: Found ${matchCount} matches. Please provide more context to make a unique match.`);
                    continue;
                }
                // Apply the replacement
                newContent = newContent.replace(searchPattern, replace);
            }
            // If all operations failed, return error
            if (errors.length === operations.length) {
                task.consecutiveMistakeCount++;
                task.recordToolError("search_and_replace", "no_match");
                pushToolResult(formatResponse.toolError(`All operations failed:\n${errors.join("\n")}`));
                return;
            }
            // Check if any changes were made
            if (newContent === fileContent) {
                pushToolResult(`No changes needed for '${relPath}'`);
                return;
            }
            task.consecutiveMistakeCount = 0;
            // Initialize diff view
            task.diffViewProvider.editType = "modify";
            task.diffViewProvider.originalContent = fileContent;
            // Generate and validate diff
            const diff = formatResponse.createPrettyPatch(relPath, fileContent, newContent);
            if (!diff) {
                pushToolResult(`No changes needed for '${relPath}'`);
                await task.diffViewProvider.reset();
                return;
            }
            // Check if preventFocusDisruption experiment is enabled
            const provider = task.providerRef.deref();
            const state = await provider?.getState();
            const diagnosticsEnabled = state?.diagnosticsEnabled ?? true;
            const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS;
            const isPreventFocusDisruptionEnabled = experiments.isEnabled(state?.experiments ?? {}, EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION);
            const sanitizedDiff = sanitizeUnifiedDiff(diff);
            const diffStats = computeDiffStats(sanitizedDiff) || undefined;
            const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath);
            const sharedMessageProps = {
                tool: "appliedDiff",
                path: getReadablePath(task.cwd, relPath),
                diff: sanitizedDiff,
                isOutsideWorkspace,
            };
            // Include any partial errors in the message
            let resultMessage = "";
            if (errors.length > 0) {
                resultMessage = `Some operations failed:\n${errors.join("\n")}\n\n`;
            }
            const completeMessage = JSON.stringify({
                ...sharedMessageProps,
                content: sanitizedDiff,
                isProtected: isWriteProtected,
                diffStats,
            });
            // Show diff view if focus disruption prevention is disabled
            if (!isPreventFocusDisruptionEnabled) {
                await task.diffViewProvider.open(relPath);
                await task.diffViewProvider.update(newContent, true);
                task.diffViewProvider.scrollToFirstDiff();
            }
            const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected);
            if (!didApprove) {
                // Revert changes if diff view was shown
                if (!isPreventFocusDisruptionEnabled) {
                    await task.diffViewProvider.revertChanges();
                }
                pushToolResult("Changes were rejected by the user.");
                await task.diffViewProvider.reset();
                return;
            }
            // Save the changes
            if (isPreventFocusDisruptionEnabled) {
                // Direct file write without diff view or opening the file
                await task.diffViewProvider.saveDirectly(relPath, newContent, false, diagnosticsEnabled, writeDelayMs);
            }
            else {
                // Call saveChanges to update the DiffViewProvider properties
                await task.diffViewProvider.saveChanges(diagnosticsEnabled, writeDelayMs);
            }
            // Track file edit operation
            if (relPath) {
                await task.fileContextTracker.trackFileContext(relPath, "roo_edited");
            }
            task.didEditFile = true;
            // Get the formatted response message
            const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, false);
            // Add error info if some operations failed
            if (errors.length > 0) {
                pushToolResult(`${resultMessage}${message}`);
            }
            else {
                pushToolResult(message);
            }
            // Record successful tool usage and cleanup
            task.recordToolUsage("search_and_replace");
            await task.diffViewProvider.reset();
            this.resetPartialState();
            // Process any queued messages after file edit completes
            task.processQueuedMessages();
        }
        catch (error) {
            await handleError("search and replace", error);
            await task.diffViewProvider.reset();
            this.resetPartialState();
        }
    }
    async handlePartial(task, block) {
        const relPath = block.params.path;
        // Wait for path to stabilize before showing UI (prevents truncated paths)
        if (!this.hasPathStabilized(relPath)) {
            return;
        }
        const operationsStr = block.params.operations;
        let operationsPreview;
        if (operationsStr) {
            try {
                const ops = JSON.parse(operationsStr);
                if (Array.isArray(ops) && ops.length > 0) {
                    operationsPreview = `${ops.length} operation(s)`;
                }
            }
            catch {
                operationsPreview = "parsing...";
            }
        }
        // relPath is guaranteed non-null after hasPathStabilized
        const absolutePath = path.resolve(task.cwd, relPath);
        const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath);
        const sharedMessageProps = {
            tool: "appliedDiff",
            path: getReadablePath(task.cwd, relPath),
            diff: operationsPreview,
            isOutsideWorkspace,
        };
        await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => { });
    }
}
/**
 * Escapes special regex characters in a string
 * @param input String to escape regex characters in
 * @returns Escaped string safe for regex pattern matching
 */
function escapeRegExp(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export const searchAndReplaceTool = new SearchAndReplaceTool();
//# sourceMappingURL=SearchAndReplaceTool.js.map