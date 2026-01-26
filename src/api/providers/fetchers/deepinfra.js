import axios from "axios";
import { z } from "zod";
import { DEFAULT_HEADERS } from "../constants";
// DeepInfra models endpoint follows OpenAI /models shape with an added metadata object.
const DeepInfraModelSchema = z.object({
    id: z.string(),
    object: z.literal("model").optional(),
    owned_by: z.string().optional(),
    created: z.number().optional(),
    root: z.string().optional(),
    metadata: z
        .object({
        description: z.string().optional(),
        context_length: z.number().optional(),
        max_tokens: z.number().optional(),
        tags: z.array(z.string()).optional(), // e.g., ["vision", "prompt_cache"]
        pricing: z
            .object({
            input_tokens: z.number().optional(),
            output_tokens: z.number().optional(),
            cache_read_tokens: z.number().optional(),
        })
            .optional(),
    })
        .optional(),
});
const DeepInfraModelsResponseSchema = z.object({ data: z.array(DeepInfraModelSchema) });
export async function getDeepInfraModels(apiKey, baseUrl = "https://api.deepinfra.com/v1/openai") {
    const headers = { ...DEFAULT_HEADERS };
    if (apiKey)
        headers["Authorization"] = `Bearer ${apiKey}`;
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    const models = {};
    const response = await axios.get(url, { headers });
    const parsed = DeepInfraModelsResponseSchema.safeParse(response.data);
    const data = parsed.success ? parsed.data.data : response.data?.data || [];
    for (const m of data) {
        const meta = m.metadata || {};
        const tags = meta.tags || [];
        const contextWindow = typeof meta.context_length === "number" ? meta.context_length : 8192;
        const maxTokens = typeof meta.max_tokens === "number" ? meta.max_tokens : Math.ceil(contextWindow * 0.2);
        const info = {
            maxTokens,
            contextWindow,
            supportsImages: tags.includes("vision"),
            supportsPromptCache: tags.includes("prompt_cache"),
            inputPrice: meta.pricing?.input_tokens,
            outputPrice: meta.pricing?.output_tokens,
            cacheReadsPrice: meta.pricing?.cache_read_tokens,
            description: meta.description,
        };
        models[m.id] = info;
    }
    return models;
}
//# sourceMappingURL=deepinfra.js.map