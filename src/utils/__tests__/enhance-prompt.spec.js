// npx vitest run src/utils/__tests__/enhance-prompt.spec.ts
import { singleCompletionHandler } from "../single-completion-handler";
import { buildApiHandler } from "../../api";
import { supportPrompt } from "../../shared/support-prompt";
// Mock the API handler
vi.mock("../../api", () => ({
    buildApiHandler: vi.fn(),
}));
describe("enhancePrompt", () => {
    const mockApiConfig = {
        apiProvider: "openai",
        openAiApiKey: "test-key",
        openAiBaseUrl: "https://api.openai.com/v1",
        enableReasoningEffort: false,
    };
    beforeEach(() => {
        vi.clearAllMocks();
        buildApiHandler.mockReturnValue({
            completePrompt: vi.fn().mockResolvedValue("Enhanced prompt"),
            createMessage: vi.fn(),
            getModel: vi.fn().mockReturnValue({
                id: "test-model",
                info: {
                    maxTokens: 4096,
                    contextWindow: 8192,
                    supportsPromptCache: false,
                },
            }),
        });
    });
    it("enhances prompt using default enhancement prompt when no custom prompt provided", async () => {
        const result = await singleCompletionHandler(mockApiConfig, "Test prompt");
        expect(result).toBe("Enhanced prompt");
        const handler = buildApiHandler(mockApiConfig);
        expect(handler.completePrompt).toHaveBeenCalledWith(`Test prompt`);
    });
    it("enhances prompt using custom enhancement prompt when provided", async () => {
        const customEnhancePrompt = "You are a custom prompt enhancer";
        const customEnhancePromptWithTemplate = customEnhancePrompt + "\n\n${userInput}";
        const result = await singleCompletionHandler(mockApiConfig, supportPrompt.create("ENHANCE", {
            userInput: "Test prompt",
        }, {
            ENHANCE: customEnhancePromptWithTemplate,
        }));
        expect(result).toBe("Enhanced prompt");
        const handler = buildApiHandler(mockApiConfig);
        expect(handler.completePrompt).toHaveBeenCalledWith(`${customEnhancePrompt}\n\nTest prompt`);
    });
    it("throws error for empty prompt input", async () => {
        await expect(singleCompletionHandler(mockApiConfig, "")).rejects.toThrow("No prompt text provided");
    });
    it("throws error for missing API configuration", async () => {
        await expect(singleCompletionHandler({}, "Test prompt")).rejects.toThrow("No valid API configuration provided");
    });
    it("throws error for API provider that does not support prompt enhancement", async () => {
        ;
        buildApiHandler.mockReturnValue({
            // No completePrompt method
            createMessage: vi.fn(),
            getModel: vi.fn().mockReturnValue({
                id: "test-model",
                info: {
                    maxTokens: 4096,
                    contextWindow: 8192,
                    supportsPromptCache: false,
                },
            }),
        });
        await expect(singleCompletionHandler(mockApiConfig, "Test prompt")).rejects.toThrow("The selected API provider does not support prompt enhancement");
    });
    it("uses appropriate model based on provider", async () => {
        const openRouterConfig = {
            apiProvider: "openrouter",
            openRouterApiKey: "test-key",
            openRouterModelId: "test-model",
            enableReasoningEffort: false,
        };
        buildApiHandler.mockReturnValue({
            completePrompt: vi.fn().mockResolvedValue("Enhanced prompt"),
            createMessage: vi.fn(),
            getModel: vi.fn().mockReturnValue({
                id: "test-model",
                info: {
                    maxTokens: 4096,
                    contextWindow: 8192,
                    supportsPromptCache: false,
                },
            }),
        });
        const result = await singleCompletionHandler(openRouterConfig, "Test prompt");
        expect(buildApiHandler).toHaveBeenCalledWith(openRouterConfig);
        expect(result).toBe("Enhanced prompt");
    });
    it("propagates API errors", async () => {
        ;
        buildApiHandler.mockReturnValue({
            completePrompt: vi.fn().mockRejectedValue(new Error("API Error")),
            createMessage: vi.fn(),
            getModel: vi.fn().mockReturnValue({
                id: "test-model",
                info: {
                    maxTokens: 4096,
                    contextWindow: 8192,
                    supportsPromptCache: false,
                },
            }),
        });
        await expect(singleCompletionHandler(mockApiConfig, "Test prompt")).rejects.toThrow("API Error");
    });
});
//# sourceMappingURL=enhance-prompt.spec.js.map