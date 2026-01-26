import { OpenAiHandler } from "./openai";
import { DOUBAO_API_BASE_URL, doubaoDefaultModelId, doubaoModels } from "@roo-code/types";
import { getModelParams } from "../transform/model-params";
export class DoubaoHandler extends OpenAiHandler {
    constructor(options) {
        super({
            ...options,
            openAiApiKey: options.doubaoApiKey ?? "not-provided",
            openAiModelId: options.apiModelId ?? doubaoDefaultModelId,
            openAiBaseUrl: options.doubaoBaseUrl ?? DOUBAO_API_BASE_URL,
            openAiStreamingEnabled: true,
            includeMaxTokens: true,
        });
    }
    getModel() {
        const id = this.options.apiModelId ?? doubaoDefaultModelId;
        const info = doubaoModels[id] || doubaoModels[doubaoDefaultModelId];
        const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options });
        return { id, info, ...params };
    }
    // Override to handle Doubao's usage metrics, including caching.
    processUsageMetrics(usage) {
        return {
            type: "usage",
            inputTokens: usage?.prompt_tokens || 0,
            outputTokens: usage?.completion_tokens || 0,
            cacheWriteTokens: usage?.prompt_tokens_details?.cache_miss_tokens,
            cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens,
        };
    }
}
//# sourceMappingURL=doubao.js.map