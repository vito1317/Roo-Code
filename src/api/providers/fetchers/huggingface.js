import axios from "axios";
import { z } from "zod";
import { HUGGINGFACE_API_URL, HUGGINGFACE_CACHE_DURATION, HUGGINGFACE_DEFAULT_MAX_TOKENS, HUGGINGFACE_DEFAULT_CONTEXT_WINDOW, } from "@roo-code/types";
const huggingFaceProviderSchema = z.object({
    provider: z.string(),
    status: z.enum(["live", "staging", "error"]),
    supports_tools: z.boolean().optional(),
    supports_structured_output: z.boolean().optional(),
    context_length: z.number().optional(),
    pricing: z
        .object({
        input: z.number(),
        output: z.number(),
    })
        .optional(),
});
const huggingFaceModelSchema = z.object({
    id: z.string(),
    object: z.literal("model"),
    created: z.number(),
    owned_by: z.string(),
    providers: z.array(huggingFaceProviderSchema),
});
const huggingFaceApiResponseSchema = z.object({
    object: z.string(),
    data: z.array(huggingFaceModelSchema),
});
let cache = null;
/**
 * Parse a HuggingFace model into ModelInfo format.
 *
 * @param model - The HuggingFace model to parse
 * @param provider - Optional specific provider to use for capabilities
 * @returns ModelInfo object compatible with the application's model system
 */
function parseHuggingFaceModel(model, provider) {
    // Use provider-specific values if available, otherwise find first provider with values.
    const contextLength = provider?.context_length ||
        model.providers.find((p) => p.context_length)?.context_length ||
        HUGGINGFACE_DEFAULT_CONTEXT_WINDOW;
    const pricing = provider?.pricing || model.providers.find((p) => p.pricing)?.pricing;
    // Include provider name in description if specific provider is given.
    const description = provider ? `${model.id} via ${provider.provider}` : `${model.id} via HuggingFace`;
    return {
        maxTokens: Math.min(contextLength, HUGGINGFACE_DEFAULT_MAX_TOKENS),
        contextWindow: contextLength,
        supportsImages: false, // HuggingFace API doesn't provide this info yet.
        supportsPromptCache: false,
        inputPrice: pricing?.input,
        outputPrice: pricing?.output,
        description,
    };
}
/**
 * Fetches available models from HuggingFace
 *
 * @returns A promise that resolves to a record of model IDs to model info
 * @throws Will throw an error if the request fails
 */
export async function getHuggingFaceModels() {
    const now = Date.now();
    if (cache && now - cache.timestamp < HUGGINGFACE_CACHE_DURATION) {
        return cache.data;
    }
    const models = {};
    try {
        const response = await axios.get(HUGGINGFACE_API_URL, {
            headers: {
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                Priority: "u=0, i",
                Pragma: "no-cache",
                "Cache-Control": "no-cache",
            },
            timeout: 10000,
        });
        const result = huggingFaceApiResponseSchema.safeParse(response.data);
        if (!result.success) {
            console.error("HuggingFace models response validation failed:", result.error.format());
            throw new Error("Invalid response format from HuggingFace API");
        }
        const validModels = result.data.data.filter((model) => model.providers.length > 0);
        for (const model of validModels) {
            // Add the base model.
            models[model.id] = parseHuggingFaceModel(model);
            // Add provider-specific variants for all live providers.
            for (const provider of model.providers) {
                if (provider.status === "live") {
                    const providerKey = `${model.id}:${provider.provider}`;
                    const providerModel = parseHuggingFaceModel(model, provider);
                    // Always add provider variants to show all available providers.
                    models[providerKey] = providerModel;
                }
            }
        }
        cache = { data: models, rawModels: validModels, timestamp: now };
        return models;
    }
    catch (error) {
        console.error("Error fetching HuggingFace models:", error);
        if (cache) {
            return cache.data;
        }
        if (axios.isAxiosError(error)) {
            if (error.response) {
                throw new Error(`Failed to fetch HuggingFace models: ${error.response.status} ${error.response.statusText}`);
            }
            else if (error.request) {
                throw new Error("Failed to fetch HuggingFace models: No response from server. Check your internet connection.");
            }
        }
        throw new Error(`Failed to fetch HuggingFace models: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}
/**
 * Get cached models without making an API request.
 */
export function getCachedHuggingFaceModels() {
    return cache?.data || null;
}
/**
 * Get cached raw models for UI display.
 */
export function getCachedRawHuggingFaceModels() {
    return cache?.rawModels || null;
}
export function clearHuggingFaceCache() {
    cache = null;
}
export async function getHuggingFaceModelsWithMetadata() {
    try {
        // First, trigger the fetch to populate cache.
        await getHuggingFaceModels();
        // Get the raw models from cache.
        const cachedRawModels = getCachedRawHuggingFaceModels();
        if (cachedRawModels) {
            return {
                models: cachedRawModels,
                cached: true,
                timestamp: Date.now(),
            };
        }
        // If no cached raw models, fetch directly from API.
        const response = await axios.get(HUGGINGFACE_API_URL, {
            headers: {
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                Priority: "u=0, i",
                Pragma: "no-cache",
                "Cache-Control": "no-cache",
            },
            timeout: 10000,
        });
        const models = response.data?.data || [];
        return {
            models,
            cached: false,
            timestamp: Date.now(),
        };
    }
    catch (error) {
        console.error("Failed to get HuggingFace models:", error);
        return { models: [], cached: false, timestamp: Date.now() };
    }
}
//# sourceMappingURL=huggingface.js.map