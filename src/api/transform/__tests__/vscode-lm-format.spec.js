// npx vitest run src/api/transform/__tests__/vscode-lm-format.spec.ts
import * as vscode from "vscode";
import { convertToVsCodeLmMessages, convertToAnthropicRole, extractTextCountFromMessage } from "../vscode-lm-format";
// Mock crypto using Vitest
vitest.stubGlobal("crypto", {
    randomUUID: () => "test-uuid",
});
// Mock vscode namespace
vitest.mock("vscode", () => {
    const LanguageModelChatMessageRole = {
        Assistant: "assistant",
        User: "user",
    };
    class MockLanguageModelTextPart {
        value;
        type = "text";
        constructor(value) {
            this.value = value;
        }
    }
    class MockLanguageModelToolCallPart {
        callId;
        name;
        input;
        type = "tool_call";
        constructor(callId, name, input) {
            this.callId = callId;
            this.name = name;
            this.input = input;
        }
    }
    class MockLanguageModelToolResultPart {
        callId;
        content;
        type = "tool_result";
        constructor(callId, content) {
            this.callId = callId;
            this.content = content;
        }
    }
    return {
        LanguageModelChatMessage: {
            Assistant: vitest.fn((content) => ({
                role: LanguageModelChatMessageRole.Assistant,
                name: "assistant",
                content: Array.isArray(content) ? content : [new MockLanguageModelTextPart(content)],
            })),
            User: vitest.fn((content) => ({
                role: LanguageModelChatMessageRole.User,
                name: "user",
                content: Array.isArray(content) ? content : [new MockLanguageModelTextPart(content)],
            })),
        },
        LanguageModelChatMessageRole,
        LanguageModelTextPart: MockLanguageModelTextPart,
        LanguageModelToolCallPart: MockLanguageModelToolCallPart,
        LanguageModelToolResultPart: MockLanguageModelToolResultPart,
    };
});
describe("convertToVsCodeLmMessages", () => {
    it("should convert simple string messages", () => {
        const messages = [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there" },
        ];
        const result = convertToVsCodeLmMessages(messages);
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe("user");
        expect(result[0].content[0].value).toBe("Hello");
        expect(result[1].role).toBe("assistant");
        expect(result[1].content[0].value).toBe("Hi there");
    });
    it("should handle complex user messages with tool results", () => {
        const messages = [
            {
                role: "user",
                content: [
                    { type: "text", text: "Here is the result:" },
                    {
                        type: "tool_result",
                        tool_use_id: "tool-1",
                        content: "Tool output",
                    },
                ],
            },
        ];
        const result = convertToVsCodeLmMessages(messages);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe("user");
        expect(result[0].content).toHaveLength(2);
        const [toolResult, textContent] = result[0].content;
        expect(toolResult.type).toBe("tool_result");
        expect(textContent.type).toBe("text");
    });
    it("should handle complex assistant messages with tool calls", () => {
        const messages = [
            {
                role: "assistant",
                content: [
                    { type: "text", text: "Let me help you with that." },
                    {
                        type: "tool_use",
                        id: "tool-1",
                        name: "calculator",
                        input: { operation: "add", numbers: [2, 2] },
                    },
                ],
            },
        ];
        const result = convertToVsCodeLmMessages(messages);
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe("assistant");
        expect(result[0].content).toHaveLength(2);
        // Text must come before tool calls so that tool calls are at the end,
        // properly followed by user message with tool results
        const [textContent, toolCall] = result[0].content;
        expect(textContent.type).toBe("text");
        expect(toolCall.type).toBe("tool_call");
    });
    it("should handle image blocks with appropriate placeholders", () => {
        const messages = [
            {
                role: "user",
                content: [
                    { type: "text", text: "Look at this:" },
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: "image/png",
                            data: "base64data",
                        },
                    },
                ],
            },
        ];
        const result = convertToVsCodeLmMessages(messages);
        expect(result).toHaveLength(1);
        const imagePlaceholder = result[0].content[1];
        expect(imagePlaceholder.value).toContain("[Image (base64): image/png not supported by VSCode LM API]");
    });
});
describe("convertToAnthropicRole", () => {
    it("should convert assistant role correctly", () => {
        const result = convertToAnthropicRole("assistant");
        expect(result).toBe("assistant");
    });
    it("should convert user role correctly", () => {
        const result = convertToAnthropicRole("user");
        expect(result).toBe("user");
    });
    it("should return null for unknown roles", () => {
        const result = convertToAnthropicRole("unknown");
        expect(result).toBeNull();
    });
});
describe("extractTextCountFromMessage", () => {
    it("should extract text from simple string content", () => {
        const message = {
            role: "user",
            content: "Hello world",
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("Hello world");
    });
    it("should extract text from LanguageModelTextPart", () => {
        const mockTextPart = new (vitest.mocked(vscode).LanguageModelTextPart)("Text content");
        const message = {
            role: "user",
            content: [mockTextPart],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("Text content");
    });
    it("should extract text from multiple LanguageModelTextParts", () => {
        const mockTextPart1 = new (vitest.mocked(vscode).LanguageModelTextPart)("First part");
        const mockTextPart2 = new (vitest.mocked(vscode).LanguageModelTextPart)("Second part");
        const message = {
            role: "user",
            content: [mockTextPart1, mockTextPart2],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("First partSecond part");
    });
    it("should extract text from LanguageModelToolResultPart", () => {
        const mockTextPart = new (vitest.mocked(vscode).LanguageModelTextPart)("Tool result content");
        const mockToolResultPart = new (vitest.mocked(vscode).LanguageModelToolResultPart)("tool-result-id", [
            mockTextPart,
        ]);
        const message = {
            role: "user",
            content: [mockToolResultPart],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("tool-result-idTool result content");
    });
    it("should extract text from LanguageModelToolCallPart without input", () => {
        const mockToolCallPart = new (vitest.mocked(vscode).LanguageModelToolCallPart)("call-id", "tool-name", {});
        const message = {
            role: "assistant",
            content: [mockToolCallPart],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("tool-namecall-id");
    });
    it("should extract text from LanguageModelToolCallPart with input", () => {
        const mockInput = { operation: "add", numbers: [1, 2, 3] };
        const mockToolCallPart = new (vitest.mocked(vscode).LanguageModelToolCallPart)("call-id", "calculator", mockInput);
        const message = {
            role: "assistant",
            content: [mockToolCallPart],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe(`calculatorcall-id${JSON.stringify(mockInput)}`);
    });
    it("should extract text from LanguageModelToolCallPart with empty input", () => {
        const mockToolCallPart = new (vitest.mocked(vscode).LanguageModelToolCallPart)("call-id", "tool-name", {});
        const message = {
            role: "assistant",
            content: [mockToolCallPart],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("tool-namecall-id");
    });
    it("should extract text from mixed content types", () => {
        const mockTextPart = new (vitest.mocked(vscode).LanguageModelTextPart)("Text content");
        const mockToolResultTextPart = new (vitest.mocked(vscode).LanguageModelTextPart)("Tool result");
        const mockToolResultPart = new (vitest.mocked(vscode).LanguageModelToolResultPart)("result-id", [
            mockToolResultTextPart,
        ]);
        const mockInput = { param: "value" };
        const mockToolCallPart = new (vitest.mocked(vscode).LanguageModelToolCallPart)("call-id", "tool", mockInput);
        const message = {
            role: "assistant",
            content: [mockTextPart, mockToolResultPart, mockToolCallPart],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe(`Text contentresult-idTool resulttoolcall-id${JSON.stringify(mockInput)}`);
    });
    it("should handle empty array content", () => {
        const message = {
            role: "user",
            content: [],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("");
    });
    it("should handle undefined content", () => {
        const message = {
            role: "user",
            content: undefined,
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("");
    });
    it("should handle ToolResultPart with multiple text parts", () => {
        const mockTextPart1 = new (vitest.mocked(vscode).LanguageModelTextPart)("Part 1");
        const mockTextPart2 = new (vitest.mocked(vscode).LanguageModelTextPart)("Part 2");
        const mockToolResultPart = new (vitest.mocked(vscode).LanguageModelToolResultPart)("result-id", [
            mockTextPart1,
            mockTextPart2,
        ]);
        const message = {
            role: "user",
            content: [mockToolResultPart],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("result-idPart 1Part 2");
    });
    it("should handle ToolResultPart with empty parts array", () => {
        const mockToolResultPart = new (vitest.mocked(vscode).LanguageModelToolResultPart)("result-id", []);
        const message = {
            role: "user",
            content: [mockToolResultPart],
        };
        const result = extractTextCountFromMessage(message);
        expect(result).toBe("result-id");
    });
});
//# sourceMappingURL=vscode-lm-format.spec.js.map