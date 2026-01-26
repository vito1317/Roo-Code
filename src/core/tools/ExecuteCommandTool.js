import fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import delay from "delay";
import { DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT } from "@roo-code/types";
import { TelemetryService } from "@roo-code/telemetry";
import { formatResponse } from "../prompts/responses";
import { unescapeHtmlEntities } from "../../utils/text-normalization";
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry";
import { Terminal } from "../../integrations/terminal/Terminal";
import { Package } from "../../shared/package";
import { t } from "../../i18n";
import { BaseTool } from "./BaseTool";
class ShellIntegrationError extends Error {
}
export class ExecuteCommandTool extends BaseTool {
    name = "execute_command";
    async execute(params, task, callbacks) {
        const { command, cwd: customCwd } = params;
        const { handleError, pushToolResult, askApproval } = callbacks;
        try {
            if (!command) {
                task.consecutiveMistakeCount++;
                task.recordToolError("execute_command");
                pushToolResult(await task.sayAndCreateMissingParamError("execute_command", "command"));
                return;
            }
            const ignoredFileAttemptedToAccess = task.rooIgnoreController?.validateCommand(command);
            if (ignoredFileAttemptedToAccess) {
                await task.say("rooignore_error", ignoredFileAttemptedToAccess);
                pushToolResult(formatResponse.rooIgnoreError(ignoredFileAttemptedToAccess));
                return;
            }
            task.consecutiveMistakeCount = 0;
            const unescapedCommand = unescapeHtmlEntities(command);
            // Auto-approve commands in Sentinel workflow mode
            const currentMode = (await task.providerRef.deref()?.getState())?.mode ?? "";
            const isSentinelMode = currentMode.startsWith("sentinel-");
            let didApprove;
            if (isSentinelMode) {
                await task.say("text", `⚡ **Auto-approved command:** \`${unescapedCommand.substring(0, 50)}${unescapedCommand.length > 50 ? "..." : ""}\``);
                didApprove = true;
            }
            else {
                didApprove = await askApproval("command", unescapedCommand);
            }
            if (!didApprove) {
                return;
            }
            // Auto-detect server commands and run them in background
            if (this.isServerCommand(unescapedCommand)) {
                const port = this.extractPortFromCommand(unescapedCommand);
                const backgroundServiceTool = await import("./StartBackgroundServiceTool");
                await task.say("text", `🔄 **Auto-Background**: Detected server command, running in background.\n` +
                    `Command: \`${unescapedCommand}\`${port ? ` | Port: ${port}` : ""}`);
                try {
                    await backgroundServiceTool.startBackgroundServiceTool.execute({ command: unescapedCommand, port: port ?? 0 }, task, callbacks);
                    return;
                }
                catch (error) {
                    console.error("[ExecuteCommand] Background service failed:", error);
                }
            }
            const executionId = task.lastMessageTs?.toString() ?? Date.now().toString();
            const provider = await task.providerRef.deref();
            const providerState = await provider?.getState();
            const { terminalOutputLineLimit = 500, terminalOutputCharacterLimit = DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT, terminalShellIntegrationDisabled = true, } = providerState ?? {};
            // Get command execution timeout from VSCode configuration (in seconds)
            const commandExecutionTimeoutSeconds = vscode.workspace
                .getConfiguration(Package.name)
                .get("commandExecutionTimeout", 0);
            // Get command timeout allowlist from VSCode configuration
            const commandTimeoutAllowlist = vscode.workspace
                .getConfiguration(Package.name)
                .get("commandTimeoutAllowlist", []);
            // Check if command matches any prefix in the allowlist
            const isCommandAllowlisted = commandTimeoutAllowlist.some((prefix) => unescapedCommand.startsWith(prefix.trim()));
            // Convert seconds to milliseconds for internal use, but skip timeout if command is allowlisted
            const commandExecutionTimeout = isCommandAllowlisted ? 0 : commandExecutionTimeoutSeconds * 1000;
            const options = {
                executionId,
                command: unescapedCommand,
                customCwd,
                terminalShellIntegrationDisabled,
                terminalOutputLineLimit,
                terminalOutputCharacterLimit,
                commandExecutionTimeout,
            };
            try {
                const [rejected, result] = await executeCommandInTerminal(task, options);
                if (rejected) {
                    task.didRejectTool = true;
                }
                pushToolResult(result);
            }
            catch (error) {
                const status = { executionId, status: "fallback" };
                provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) });
                await task.say("shell_integration_warning");
                // Invalidate pending ask from first execution to prevent race condition
                task.supersedePendingAsk();
                if (error instanceof ShellIntegrationError) {
                    const [rejected, result] = await executeCommandInTerminal(task, {
                        ...options,
                        terminalShellIntegrationDisabled: true,
                    });
                    if (rejected) {
                        task.didRejectTool = true;
                    }
                    pushToolResult(result);
                }
                else {
                    pushToolResult(`Command failed to execute in terminal due to a shell integration error.`);
                }
            }
            return;
        }
        catch (error) {
            await handleError("executing command", error);
            return;
        }
    }
    async handlePartial(task, block) {
        const command = block.params.command;
        await task.ask("command", command ?? "", block.partial).catch(() => { });
    }
    /**
     * Detect if a command is likely a server/dev command that should run in background
     */
    isServerCommand(command) {
        const serverPatterns = [
            /npm\s+(run\s+)?(dev|start|serve)/i,
            /yarn\s+(run\s+)?(dev|start|serve)/i,
            /pnpm\s+(run\s+)?(dev|start|serve)/i,
            /bun\s+(run\s+)?(dev|start|serve)/i,
            /vite(\s|$)/i,
            /next(\s+dev|\s+start)/i,
            /node\s+.*server/i,
            /python\s+-m\s+http\.server/i,
            /flask\s+run/i,
            /uvicorn/i,
            /nodemon/i,
        ];
        return serverPatterns.some((pattern) => pattern.test(command));
    }
    /**
     * Extract port number from a command
     */
    extractPortFromCommand(command) {
        // Match common port patterns: -p 3000, --port 3000, PORT=3000, :3000
        const portMatch = command.match(/(?:-p|--port|PORT=)\s*(\d+)/) || command.match(/:(\d{4,5})(?:\s|$)/);
        if (portMatch) {
            return parseInt(portMatch[1], 10);
        }
        // Default ports for common tools
        if (/vite/i.test(command))
            return 5173;
        if (/next/i.test(command))
            return 3000;
        return null;
    }
}
export async function executeCommandInTerminal(task, { executionId, command, customCwd, terminalShellIntegrationDisabled = true, terminalOutputLineLimit = 500, terminalOutputCharacterLimit = DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT, commandExecutionTimeout = 0, }) {
    // Convert milliseconds back to seconds for display purposes.
    const commandExecutionTimeoutSeconds = commandExecutionTimeout / 1000;
    let workingDir;
    if (!customCwd) {
        workingDir = task.cwd;
    }
    else if (path.isAbsolute(customCwd)) {
        workingDir = customCwd;
    }
    else {
        workingDir = path.resolve(task.cwd, customCwd);
    }
    try {
        await fs.access(workingDir);
    }
    catch (error) {
        return [false, `Working directory '${workingDir}' does not exist.`];
    }
    let message;
    let runInBackground = false;
    let completed = false;
    let result = "";
    let exitDetails;
    let shellIntegrationError;
    let hasAskedForCommandOutput = false;
    const terminalProvider = terminalShellIntegrationDisabled ? "execa" : "vscode";
    const provider = await task.providerRef.deref();
    let accumulatedOutput = "";
    const callbacks = {
        onLine: async (lines, process) => {
            accumulatedOutput += lines;
            const compressedOutput = Terminal.compressTerminalOutput(accumulatedOutput, terminalOutputLineLimit, terminalOutputCharacterLimit);
            const status = { executionId, status: "output", output: compressedOutput };
            provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) });
            if (runInBackground || hasAskedForCommandOutput) {
                return;
            }
            // Mark that we've asked to prevent multiple concurrent asks
            hasAskedForCommandOutput = true;
            try {
                const { response, text, images } = await task.ask("command_output", "");
                runInBackground = true;
                if (response === "messageResponse") {
                    message = { text, images };
                    process.continue();
                }
            }
            catch (_error) {
                // Silently handle ask errors (e.g., "Current ask promise was ignored")
            }
        },
        onCompleted: (output) => {
            result = Terminal.compressTerminalOutput(output ?? "", terminalOutputLineLimit, terminalOutputCharacterLimit);
            task.say("command_output", result);
            completed = true;
        },
        onShellExecutionStarted: (pid) => {
            const status = { executionId, status: "started", pid, command };
            provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) });
        },
        onShellExecutionComplete: (details) => {
            const status = { executionId, status: "exited", exitCode: details.exitCode };
            provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) });
            exitDetails = details;
        },
    };
    if (terminalProvider === "vscode") {
        callbacks.onNoShellIntegration = async (error) => {
            TelemetryService.instance.captureShellIntegrationError(task.taskId);
            shellIntegrationError = error;
        };
    }
    const terminal = await TerminalRegistry.getOrCreateTerminal(workingDir, task.taskId, terminalProvider);
    if (terminal instanceof Terminal) {
        terminal.terminal.show(true);
        // Update the working directory in case the terminal we asked for has
        // a different working directory so that the model will know where the
        // command actually executed.
        workingDir = terminal.getCurrentWorkingDirectory();
    }
    const process = terminal.runCommand(command, callbacks);
    task.terminalProcess = process;
    // Implement command execution timeout (skip if timeout is 0).
    if (commandExecutionTimeout > 0) {
        let timeoutId;
        let isTimedOut = false;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                isTimedOut = true;
                task.terminalProcess?.abort();
                reject(new Error(`Command execution timed out after ${commandExecutionTimeout}ms`));
            }, commandExecutionTimeout);
        });
        try {
            await Promise.race([process, timeoutPromise]);
        }
        catch (error) {
            if (isTimedOut) {
                const status = { executionId, status: "timeout" };
                provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) });
                await task.say("error", t("common:errors:command_timeout", { seconds: commandExecutionTimeoutSeconds }));
                task.didToolFailInCurrentTurn = true;
                task.terminalProcess = undefined;
                return [
                    false,
                    `The command was terminated after exceeding a user-configured ${commandExecutionTimeoutSeconds}s timeout. Do not try to re-run the command.`,
                ];
            }
            throw error;
        }
        finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            task.terminalProcess = undefined;
        }
    }
    else {
        // No timeout - just wait for the process to complete.
        try {
            await process;
        }
        finally {
            task.terminalProcess = undefined;
        }
    }
    if (shellIntegrationError) {
        throw new ShellIntegrationError(shellIntegrationError);
    }
    // Wait for a short delay to ensure all messages are sent to the webview.
    // This delay allows time for non-awaited promises to be created and
    // for their associated messages to be sent to the webview, maintaining
    // the correct order of messages (although the webview is smart about
    // grouping command_output messages despite any gaps anyways).
    await delay(50);
    if (message) {
        const { text, images } = message;
        await task.say("user_feedback", text, images);
        return [
            true,
            formatResponse.toolResult([
                `Command is still running in terminal from '${terminal.getCurrentWorkingDirectory().toPosix()}'.`,
                result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
                `<user_message>\n${text}\n</user_message>`,
            ].join("\n"), images),
        ];
    }
    else if (completed || exitDetails) {
        let exitStatus = "";
        if (exitDetails !== undefined) {
            if (exitDetails.signalName) {
                exitStatus = `Process terminated by signal ${exitDetails.signalName}`;
                if (exitDetails.coreDumpPossible) {
                    exitStatus += " - core dump possible";
                }
            }
            else if (exitDetails.exitCode === undefined) {
                result += "<VSCE exit code is undefined: terminal output and command execution status is unknown.>";
                exitStatus = `Exit code: <undefined, notify user>`;
            }
            else {
                if (exitDetails.exitCode !== 0) {
                    exitStatus += "Command execution was not successful, inspect the cause and adjust as needed.\n";
                }
                exitStatus += `Exit code: ${exitDetails.exitCode}`;
            }
        }
        else {
            result += "<VSCE exitDetails == undefined: terminal output and command execution status is unknown.>";
            exitStatus = `Exit code: <undefined, notify user>`;
        }
        let workingDirInfo = ` within working directory '${terminal.getCurrentWorkingDirectory().toPosix()}'`;
        return [false, `Command executed in terminal ${workingDirInfo}. ${exitStatus}\nOutput:\n${result}`];
    }
    else {
        return [
            false,
            [
                `Command is still running in terminal ${workingDir ? ` from '${workingDir.toPosix()}'` : ""}.`,
                result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
                "You will be updated on the terminal status and new output in the future.",
            ].join("\n"),
        ];
    }
}
export const executeCommandTool = new ExecuteCommandTool();
//# sourceMappingURL=ExecuteCommandTool.js.map