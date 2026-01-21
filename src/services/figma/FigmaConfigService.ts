/**
 * Figma Configuration Service
 *
 * Manages Figma API token storage and provides singleton access to FigmaService
 */

import * as vscode from "vscode"
import { FigmaService } from "./FigmaService"

const FIGMA_TOKEN_KEY = "roo.figmaApiToken"

export class FigmaConfigService {
	private static instance: FigmaConfigService | null = null
	private figmaService: FigmaService | null = null
	private context: vscode.ExtensionContext

	private constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	static initialize(context: vscode.ExtensionContext): FigmaConfigService {
		if (!FigmaConfigService.instance) {
			FigmaConfigService.instance = new FigmaConfigService(context)
		}
		return FigmaConfigService.instance
	}

	static getInstance(): FigmaConfigService | null {
		return FigmaConfigService.instance
	}

	/**
	 * Get the stored Figma API token
	 */
	async getApiToken(): Promise<string | undefined> {
		return this.context.secrets.get(FIGMA_TOKEN_KEY)
	}

	/**
	 * Set the Figma API token
	 */
	async setApiToken(token: string): Promise<void> {
		await this.context.secrets.store(FIGMA_TOKEN_KEY, token)
		// Invalidate cached service
		this.figmaService = null
	}

	/**
	 * Clear the Figma API token
	 */
	async clearApiToken(): Promise<void> {
		await this.context.secrets.delete(FIGMA_TOKEN_KEY)
		this.figmaService = null
	}

	/**
	 * Check if a Figma API token is configured
	 */
	async isConfigured(): Promise<boolean> {
		const token = await this.getApiToken()
		return !!token
	}

	/**
	 * Get or create a FigmaService instance
	 */
	async getFigmaService(): Promise<FigmaService | null> {
		const token = await this.getApiToken()
		if (!token) {
			return null
		}

		if (!this.figmaService) {
			this.figmaService = new FigmaService(token)
		}

		return this.figmaService
	}

	/**
	 * Validate the current token
	 */
	async validateCurrentToken(): Promise<boolean> {
		const service = await this.getFigmaService()
		if (!service) {
			return false
		}

		return service.validateToken()
	}
}

/**
 * Get Figma service (convenience function for tools)
 */
export async function getFigmaService(): Promise<FigmaService | null> {
	const configService = FigmaConfigService.getInstance()
	if (!configService) {
		return null
	}
	return configService.getFigmaService()
}
