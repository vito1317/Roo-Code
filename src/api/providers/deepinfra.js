import { deepInfraDefaultModelId, deepInfraDefaultModelInfo } from "@roo-code/types";
import { calculateApiCostOpenAI } from "../../shared/cost";
import { convertToOpenAiMessages } from "../transform/openai-format";
import { RouterProvider } from "./router-provider";
import { getModelParams } from "../transform/model-params";
import { getModels } from "./fetchers/modelCache";
export class DeepInfraHandler extends RouterProvider {
    constructor(options) {
        super({
            options: {
                ...options,
                openAiHeaders: {
                    "X-Deepinfra-Source": "roo-code",
                    "X-Deepinfra-Version": `2025-08-25`,
                },
            },
            name: "deepinfra",
            baseURL: `${options.deepInfraBaseUrl || "https://api.deepinfra.com/v1/openai"}`,
            apiKey: options.deepInfraApiKey || "not-provided",
            modelId: options.deepInfraModelId,
            defaultModelId: deepInfraDefaultModelId,
            defaultModelInfo: deepInfraDefaultModelInfo,
        });
    }
    async fetchModel() {
        this.models = await getModels({ provider: this.name, apiKey: this.client.apiKey, baseUrl: this.client.baseURL });
        return this.getModel();
    }
    getModel() {
        const id = this.options.deepInfraModelId ?? deepInfraDefaultModelId;
        const info = this.models[id] ?? deepInfraDefaultModelInfo;
        const params = getModelParams({
            format: "openai",
            modelId: id,
            model: info,
            settings: this.options,
        });
        return { id, info, ...params };
    }
    async *createMessage(systemPrompt, messages, _metadata) {
        // Ensure we have up-to-date model metadata
        await this.fetchModel();
        const { id: modelId, info, reasoningEffort: reasoning_effort } = await this.fetchModel();
        let prompt_cache_key = undefined;
        if (info.supportsPromptCache && _metadata?.taskId) {
            prompt_cache_key = _metadata.taskId;
        }
        const requestOptions = {
            model: modelId,
            messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
            stream: true,
            stream_options: { include_usage: true },
            reasoning_effort,
            prompt_cache_key,
            tools: this.convertToolsForOpenAI(_metadata?.tools),
            tool_choice: _metadata?.tool_choice,
            parallel_tool_calls: _metadata?.parallelToolCalls ?? false,
        };
        if (this.supportsTemperature(modelId)) {
            requestOptions.temperature = this.options.modelTemperature ?? 0;
        }
        if (this.options.includeMaxTokens === true && info.maxTokens) {
            ;
            requestOptions.max_completion_tokens = this.options.modelMaxTokens || info.maxTokens;
        }
        const { data: stream } = await this.client.chat.completions.create(requestOptions).withResponse();
        let lastUsage;
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
                yield { type: "text", text: delta.content };
            }
            if (delta && "reasoning_content" in delta && delta.reasoning_content) {
                yield { type: "reasoning", text: delta.reasoning_content || "" };
            }
            // Handle tool calls in stream - emit partial chunks for NativeToolCallParser
            if (delta?.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                    yield {
                        type: "tool_call_partial",
                        index: toolCall.index,
                        id: toolCall.id,
                        name: toolCall.function?.name,
                        arguments: toolCall.function?.arguments,
                    };
                }
            }
            if (chunk.usage) {
                lastUsage = chunk.usage;
            }
        }
        if (lastUsage) {
            yield this.processUsageMetrics(lastUsage, info);
        }
    }
    async completePrompt(prompt) {
        await this.fetchModel();
        const { id: modelId, info } = this.getModel();
        const requestOptions = {
            model: modelId,
            messages: [{ role: "user", content: prompt }],
        };
        if (this.supportsTemperature(modelId)) {
            requestOptions.temperature = this.options.modelTemperature ?? 0;
        }
        if (this.options.includeMaxTokens === true && info.maxTokens) {
            ;
            requestOptions.max_completion_tokens = this.options.modelMaxTokens || info.maxTokens;
        }
        const resp = await this.client.chat.completions.create(requestOptions);
        return resp.choices[0]?.message?.content || "";
    }
    processUsageMetrics(usage, modelInfo) {
        const inputTokens = usage?.prompt_tokens || 0;
        const outputTokens = usage?.completion_tokens || 0;
        const cacheWriteTokens = usage?.prompt_tokens_details?.cache_write_tokens || 0;
        const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0;
        const { totalCost } = modelInfo
            ? calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
            : { totalCost: 0 };
        return {
            type: "usage",
            inputTokens,
            outputTokens,
            cacheWriteTokens: cacheWriteTokens || undefined,
            cacheReadTokens: cacheReadTokens || undefined,
            totalCost,
        };
    }
}
//# sourceMappingURL=deepinfra.js.map