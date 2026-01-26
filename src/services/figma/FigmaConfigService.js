/**
 * Figma Configuration Service
 *
 * Manages Figma API token storage and provides singleton access to FigmaService
 */
import { FigmaService } from "./FigmaService";
const FIGMA_TOKEN_KEY = "roo.figmaApiToken";
export class FigmaConfigService {
    static instance = null;
    figmaService = null;
    context;
    constructor(context) {
        this.context = context;
    }
    static initialize(context) {
        if (!FigmaConfigService.instance) {
            FigmaConfigService.instance = new FigmaConfigService(context);
        }
        return FigmaConfigService.instance;
    }
    static getInstance() {
        return FigmaConfigService.instance;
    }
    /**
     * Get the stored Figma API token
     */
    async getApiToken() {
        return this.context.secrets.get(FIGMA_TOKEN_KEY);
    }
    /**
     * Set the Figma API token
     */
    async setApiToken(token) {
        await this.context.secrets.store(FIGMA_TOKEN_KEY, token);
        // Invalidate cached service
        this.figmaService = null;
    }
    /**
     * Clear the Figma API token
     */
    async clearApiToken() {
        await this.context.secrets.delete(FIGMA_TOKEN_KEY);
        this.figmaService = null;
    }
    /**
     * Check if a Figma API token is configured
     */
    async isConfigured() {
        const token = await this.getApiToken();
        return !!token;
    }
    /**
     * Get or create a FigmaService instance
     */
    async getFigmaService() {
        const token = await this.getApiToken();
        if (!token) {
            return null;
        }
        if (!this.figmaService) {
            this.figmaService = new FigmaService(token);
        }
        return this.figmaService;
    }
    /**
     * Validate the current token
     */
    async validateCurrentToken() {
        const service = await this.getFigmaService();
        if (!service) {
            return false;
        }
        return service.validateToken();
    }
}
/**
 * Get Figma service (convenience function for tools)
 */
export async function getFigmaService() {
    const configService = FigmaConfigService.getInstance();
    if (!configService) {
        return null;
    }
    return configService.getFigmaService();
}
//# sourceMappingURL=FigmaConfigService.js.map