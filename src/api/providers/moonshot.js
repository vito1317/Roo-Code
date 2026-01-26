import { moonshotModels, moonshotDefaultModelId } from "@roo-code/types";
import { getModelParams } from "../transform/model-params";
import { OpenAiHandler } from "./openai";
export class MoonshotHandler extends OpenAiHandler {
    constructor(options) {
        super({
            ...options,
            openAiApiKey: options.moonshotApiKey ?? "not-provided",
            openAiModelId: options.apiModelId ?? moonshotDefaultModelId,
            openAiBaseUrl: options.moonshotBaseUrl ?? "https://api.moonshot.ai/v1",
            openAiStreamingEnabled: true,
            includeMaxTokens: true,
        });
    }
    getModel() {
        const id = this.options.apiModelId ?? moonshotDefaultModelId;
        const info = moonshotModels[id] || moonshotModels[moonshotDefaultModelId];
        const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options });
        return { id, info, ...params };
    }
    // Override to handle Moonshot's usage metrics, including caching.
    processUsageMetrics(usage) {
        return {
            type: "usage",
            inputTokens: usage?.prompt_tokens || 0,
            outputTokens: usage?.completion_tokens || 0,
            cacheWriteTokens: 0,
            cacheReadTokens: usage?.cached_tokens,
        };
    }
    // Override to always include max_tokens for Moonshot (not max_completion_tokens)
    addMaxTokensIfNeeded(requestOptions, modelInfo) {
        // Moonshot uses max_tokens instead of max_completion_tokens
        requestOptions.max_tokens = this.options.modelMaxTokens || modelInfo.maxTokens;
    }
}
//# sourceMappingURL=moonshot.js.map