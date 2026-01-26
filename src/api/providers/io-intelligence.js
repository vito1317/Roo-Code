import { ioIntelligenceDefaultModelId, ioIntelligenceModels } from "@roo-code/types";
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider";
export class IOIntelligenceHandler extends BaseOpenAiCompatibleProvider {
    constructor(options) {
        if (!options.ioIntelligenceApiKey) {
            throw new Error("IO Intelligence API key is required");
        }
        super({
            ...options,
            providerName: "IO Intelligence",
            baseURL: "https://api.intelligence.io.solutions/api/v1",
            defaultProviderModelId: ioIntelligenceDefaultModelId,
            providerModels: ioIntelligenceModels,
            defaultTemperature: 0.7,
            apiKey: options.ioIntelligenceApiKey,
        });
    }
    getModel() {
        const modelId = this.options.ioIntelligenceModelId || ioIntelligenceDefaultModelId;
        const modelInfo = this.providerModels[modelId] ?? this.providerModels[ioIntelligenceDefaultModelId];
        if (modelInfo) {
            return { id: modelId, info: modelInfo };
        }
        // Return the requested model ID even if not found, with fallback info.
        return {
            id: modelId,
            info: {
                maxTokens: 8192,
                contextWindow: 128000,
                supportsImages: false,
                supportsPromptCache: false,
            },
        };
    }
}
//# sourceMappingURL=io-intelligence.js.map