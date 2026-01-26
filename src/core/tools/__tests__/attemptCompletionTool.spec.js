// Mock the formatResponse module before importing the tool
vi.mock("../../prompts/responses", () => ({
    formatResponse: {
        toolError: vi.fn((msg) => `Error: ${msg}`),
    },
}));
// Mock vscode module
vi.mock("vscode", () => ({
    workspace: {
        getConfiguration: vi.fn(() => ({
            get: vi.fn(),
        })),
    },
}));
// Mock Package module
vi.mock("../../../shared/package", () => ({
    Package: {
        name: "roo-cline",
    },
}));
import { attemptCompletionTool } from "../AttemptCompletionTool";
import * as vscode from "vscode";
describe("attemptCompletionTool", () => {
    let mockTask;
    let mockPushToolResult;
    let mockAskApproval;
    let mockHandleError;
    let mockToolDescription;
    let mockAskFinishSubTaskApproval;
    let mockGetConfiguration;
    beforeEach(() => {
        mockPushToolResult = vi.fn();
        mockAskApproval = vi.fn();
        mockHandleError = vi.fn();
        mockToolDescription = vi.fn();
        mockAskFinishSubTaskApproval = vi.fn();
        mockGetConfiguration = vi.fn(() => ({
            get: vi.fn((key, defaultValue) => {
                if (key === "preventCompletionWithOpenTodos") {
                    return defaultValue; // Default to false unless overridden in test
                }
                return defaultValue;
            }),
        }));
        // Setup vscode mock
        vi.mocked(vscode.workspace.getConfiguration).mockImplementation(mockGetConfiguration);
        mockTask = {
            consecutiveMistakeCount: 0,
            recordToolError: vi.fn(),
            todoList: undefined,
            say: vi.fn().mockResolvedValue(undefined),
            ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
            emitFinalTokenUsageUpdate: vi.fn(),
            emit: vi.fn(),
            getTokenUsage: vi.fn().mockReturnValue({}),
            toolUsage: {},
            taskId: "task_1",
            apiConfiguration: { apiProvider: "test" },
            api: { getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }) },
        };
    });
    describe("todo list validation", () => {
        it("should allow completion when there is no todo list", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            mockTask.todoList = undefined;
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            // Should not call pushToolResult with an error for empty todo list
            expect(mockTask.consecutiveMistakeCount).toBe(0);
            expect(mockTask.recordToolError).not.toHaveBeenCalled();
        });
        it("should allow completion when todo list is empty", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            mockTask.todoList = [];
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            expect(mockTask.consecutiveMistakeCount).toBe(0);
            expect(mockTask.recordToolError).not.toHaveBeenCalled();
        });
        it("should allow completion when all todos are completed", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            const completedTodos = [
                { id: "1", content: "First task", status: "completed" },
                { id: "2", content: "Second task", status: "completed" },
            ];
            mockTask.todoList = completedTodos;
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            expect(mockTask.consecutiveMistakeCount).toBe(0);
            expect(mockTask.recordToolError).not.toHaveBeenCalled();
        });
        it("should prevent completion when there are pending todos", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            const todosWithPending = [
                { id: "1", content: "First task", status: "completed" },
                { id: "2", content: "Second task", status: "pending" },
            ];
            mockTask.todoList = todosWithPending;
            // Enable the setting to prevent completion with open todos
            mockGetConfiguration.mockReturnValue({
                get: vi.fn((key, defaultValue) => {
                    if (key === "preventCompletionWithOpenTodos") {
                        return true; // Setting is enabled
                    }
                    return defaultValue;
                }),
            });
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            expect(mockTask.consecutiveMistakeCount).toBe(1);
            expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion");
            expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Cannot complete task while there are incomplete todos"));
        });
        it("should prevent completion when there are in-progress todos", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            const todosWithInProgress = [
                { id: "1", content: "First task", status: "completed" },
                { id: "2", content: "Second task", status: "in_progress" },
            ];
            mockTask.todoList = todosWithInProgress;
            // Enable the setting to prevent completion with open todos
            mockGetConfiguration.mockReturnValue({
                get: vi.fn((key, defaultValue) => {
                    if (key === "preventCompletionWithOpenTodos") {
                        return true; // Setting is enabled
                    }
                    return defaultValue;
                }),
            });
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            expect(mockTask.consecutiveMistakeCount).toBe(1);
            expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion");
            expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Cannot complete task while there are incomplete todos"));
        });
        it("should prevent completion when there are mixed incomplete todos", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            const mixedTodos = [
                { id: "1", content: "First task", status: "completed" },
                { id: "2", content: "Second task", status: "pending" },
                { id: "3", content: "Third task", status: "in_progress" },
            ];
            mockTask.todoList = mixedTodos;
            // Enable the setting to prevent completion with open todos
            mockGetConfiguration.mockReturnValue({
                get: vi.fn((key, defaultValue) => {
                    if (key === "preventCompletionWithOpenTodos") {
                        return true; // Setting is enabled
                    }
                    return defaultValue;
                }),
            });
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            expect(mockTask.consecutiveMistakeCount).toBe(1);
            expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion");
            expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Cannot complete task while there are incomplete todos"));
        });
        it("should allow completion when setting is disabled even with incomplete todos", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            const todosWithPending = [
                { id: "1", content: "First task", status: "completed" },
                { id: "2", content: "Second task", status: "pending" },
            ];
            mockTask.todoList = todosWithPending;
            // Ensure the setting is disabled (default behavior)
            mockGetConfiguration.mockReturnValue({
                get: vi.fn((key, defaultValue) => {
                    if (key === "preventCompletionWithOpenTodos") {
                        return false; // Setting is disabled
                    }
                    return defaultValue;
                }),
            });
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            // Should not prevent completion when setting is disabled
            expect(mockTask.consecutiveMistakeCount).toBe(0);
            expect(mockTask.recordToolError).not.toHaveBeenCalled();
            expect(mockPushToolResult).not.toHaveBeenCalledWith(expect.stringContaining("Cannot complete task while there are incomplete todos"));
        });
        it("should prevent completion when setting is enabled with incomplete todos", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            const todosWithPending = [
                { id: "1", content: "First task", status: "completed" },
                { id: "2", content: "Second task", status: "pending" },
            ];
            mockTask.todoList = todosWithPending;
            // Enable the setting
            mockGetConfiguration.mockReturnValue({
                get: vi.fn((key, defaultValue) => {
                    if (key === "preventCompletionWithOpenTodos") {
                        return true; // Setting is enabled
                    }
                    return defaultValue;
                }),
            });
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            // Should prevent completion when setting is enabled and there are incomplete todos
            expect(mockTask.consecutiveMistakeCount).toBe(1);
            expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion");
            expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Cannot complete task while there are incomplete todos"));
        });
        it("should allow completion when setting is enabled but all todos are completed", async () => {
            const block = {
                type: "tool_use",
                name: "attempt_completion",
                params: { result: "Task completed successfully" },
                nativeArgs: { result: "Task completed successfully" },
                partial: false,
            };
            const completedTodos = [
                { id: "1", content: "First task", status: "completed" },
                { id: "2", content: "Second task", status: "completed" },
            ];
            mockTask.todoList = completedTodos;
            // Enable the setting
            mockGetConfiguration.mockReturnValue({
                get: vi.fn((key, defaultValue) => {
                    if (key === "preventCompletionWithOpenTodos") {
                        return true; // Setting is enabled
                    }
                    return defaultValue;
                }),
            });
            const callbacks = {
                askApproval: mockAskApproval,
                handleError: mockHandleError,
                pushToolResult: mockPushToolResult,
                askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                toolDescription: mockToolDescription,
            };
            await attemptCompletionTool.handle(mockTask, block, callbacks);
            // Should allow completion when setting is enabled but all todos are completed
            expect(mockTask.consecutiveMistakeCount).toBe(0);
            expect(mockTask.recordToolError).not.toHaveBeenCalled();
            expect(mockPushToolResult).not.toHaveBeenCalledWith(expect.stringContaining("Cannot complete task while there are incomplete todos"));
        });
        describe("tool failure guardrail", () => {
            it("should prevent completion when a previous tool failed in the current turn", async () => {
                const block = {
                    type: "tool_use",
                    name: "attempt_completion",
                    params: { result: "Task completed successfully" },
                    nativeArgs: { result: "Task completed successfully" },
                    partial: false,
                };
                mockTask.todoList = undefined;
                mockTask.didToolFailInCurrentTurn = true;
                const callbacks = {
                    askApproval: mockAskApproval,
                    handleError: mockHandleError,
                    pushToolResult: mockPushToolResult,
                    askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                    toolDescription: mockToolDescription,
                };
                const mockSay = vi.fn();
                mockTask.say = mockSay;
                await attemptCompletionTool.handle(mockTask, block, callbacks);
                expect(mockSay).toHaveBeenCalledWith("error", expect.stringContaining("errors.attempt_completion_tool_failed"));
                expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("errors.attempt_completion_tool_failed"));
            });
            it("should allow completion when no tools failed", async () => {
                const block = {
                    type: "tool_use",
                    name: "attempt_completion",
                    params: { result: "Task completed successfully" },
                    nativeArgs: { result: "Task completed successfully" },
                    partial: false,
                };
                mockTask.todoList = undefined;
                mockTask.didToolFailInCurrentTurn = false;
                const callbacks = {
                    askApproval: mockAskApproval,
                    handleError: mockHandleError,
                    pushToolResult: mockPushToolResult,
                    askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
                    toolDescription: mockToolDescription,
                };
                await attemptCompletionTool.handle(mockTask, block, callbacks);
                expect(mockTask.consecutiveMistakeCount).toBe(0);
                expect(mockTask.recordToolError).not.toHaveBeenCalled();
            });
        });
    });
});
//# sourceMappingURL=attemptCompletionTool.spec.js.map