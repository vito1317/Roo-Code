/**
 * Figma Preview Panel
 *
 * Creates a webview panel that embeds Figma's web view for real-time preview.
 * Uses Figma's embed API to show designs in VS Code.
 */

import * as vscode from "vscode"

export class FigmaPreviewPanel {
	private static instance: FigmaPreviewPanel | null = null
	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []
	private currentFigmaUrl: string = ""
	private extensionUri: vscode.Uri

	private constructor(extensionUri: vscode.Uri) {
		this.extensionUri = extensionUri
	}

	static initialize(extensionUri: vscode.Uri): FigmaPreviewPanel {
		if (!FigmaPreviewPanel.instance) {
			FigmaPreviewPanel.instance = new FigmaPreviewPanel(extensionUri)
		}
		return FigmaPreviewPanel.instance
	}

	static getInstance(): FigmaPreviewPanel | null {
		return FigmaPreviewPanel.instance
	}

	/**
	 * Extract file key from Figma URL
	 * Supports formats:
	 * - https://www.figma.com/file/xxx/...
	 * - https://www.figma.com/design/xxx/...
	 * - https://www.figma.com/proto/xxx/...
	 */
	private extractFileKey(figmaUrl: string): string | null {
		const patterns = [
			/figma\.com\/file\/([a-zA-Z0-9]+)/,
			/figma\.com\/design\/([a-zA-Z0-9]+)/,
			/figma\.com\/proto\/([a-zA-Z0-9]+)/,
		]

		for (const pattern of patterns) {
			const match = figmaUrl.match(pattern)
			if (match) {
				return match[1]
			}
		}

		return null
	}

	/**
	 * Build the Figma embed URL
	 */
	private buildEmbedUrl(figmaUrl: string): string {
		// Figma embed URL format
		const encodedUrl = encodeURIComponent(figmaUrl)
		return `https://www.figma.com/embed?embed_host=share&url=${encodedUrl}`
	}

	/**
	 * Show the Figma preview panel with the specified URL
	 */
	async show(figmaUrl?: string): Promise<void> {
		if (figmaUrl) {
			this.currentFigmaUrl = figmaUrl
		}

		if (!this.currentFigmaUrl) {
			vscode.window.showWarningMessage("Please set a Figma file URL in settings first.")
			return
		}

		// Validate URL format
		const fileKey = this.extractFileKey(this.currentFigmaUrl)
		if (!fileKey) {
			vscode.window.showErrorMessage("Invalid Figma URL. Please use a valid Figma file URL.")
			return
		}

		await this.createOrShowPanel()
	}

	/**
	 * Update the Figma URL and refresh the panel
	 */
	async updateUrl(figmaUrl: string): Promise<void> {
		this.currentFigmaUrl = figmaUrl
		if (this.panel) {
			await this.updatePanelContent()
		}
	}

	private async createOrShowPanel(): Promise<void> {
		if (this.panel) {
			// Use ViewColumn.One for fullscreen display (not split view)
			this.panel.reveal(vscode.ViewColumn.One)
			await this.updatePanelContent()
			return
		}

		// Use ViewColumn.One for fullscreen display (not split view)
		this.panel = vscode.window.createWebviewPanel(
			"roo.figmaPreview",
			"🎨 Figma Preview",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		)

		await this.updatePanelContent()

		this.panel.onDidDispose(
			() => {
				this.panel = undefined
				this.dispose()
			},
			null,
			this.disposables
		)
	}

	private async updatePanelContent(): Promise<void> {
		if (!this.panel) return

		const embedUrl = this.buildEmbedUrl(this.currentFigmaUrl)
		this.panel.webview.html = this.getHtmlContent(embedUrl)
	}

	private getHtmlContent(embedUrl: string): string {
		return `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://www.figma.com https://*.figma.com; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
					<title>Figma Preview</title>
					<style>
						body {
							margin: 0;
							padding: 0;
							overflow: hidden;
							background: #1e1e1e;
						}
						.container {
							width: 100vw;
							height: 100vh;
							display: flex;
							flex-direction: column;
						}
						.header {
							background: #2d2d2d;
							padding: 8px 16px;
							display: flex;
							align-items: center;
							justify-content: space-between;
							border-bottom: 1px solid #404040;
						}
						.header-title {
							color: #cccccc;
							font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
							font-size: 13px;
							display: flex;
							align-items: center;
							gap: 8px;
						}
						.header-url {
							color: #888888;
							font-family: monospace;
							font-size: 11px;
							max-width: 400px;
							overflow: hidden;
							text-overflow: ellipsis;
							white-space: nowrap;
						}
						.reload-btn {
							background: #0e639c;
							color: white;
							border: none;
							padding: 4px 12px;
							border-radius: 3px;
							cursor: pointer;
							font-size: 12px;
						}
						.reload-btn:hover {
							background: #1177bb;
						}
						.iframe-container {
							flex: 1;
							position: relative;
						}
						iframe {
							position: absolute;
							top: 0;
							left: 0;
							width: 100%;
							height: 100%;
							border: none;
						}
						.loading {
							position: absolute;
							top: 50%;
							left: 50%;
							transform: translate(-50%, -50%);
							color: #888;
							font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
							z-index: 10;
							background: #1e1e1e;
							padding: 20px 40px;
							border-radius: 8px;
						}
						.loading.hidden {
							display: none;
						}
					</style>
				</head>
				<body>
					<div class="container">
						<div class="header">
							<div class="header-title">
								<span>🎨</span>
								<span>Figma Preview</span>
								<span class="header-url" title="${this.currentFigmaUrl}">${this.currentFigmaUrl}</span>
							</div>
							<button class="reload-btn" onclick="reloadFrame()">
								↻ Reload
							</button>
						</div>
						<div class="iframe-container">
							<div class="loading" id="loading">Loading Figma...</div>
							<iframe
								id="figma-frame"
								src="${embedUrl}"
								allowfullscreen>
							</iframe>
						</div>
					</div>
					<script>
						var loadingEl = document.getElementById('loading');
						var iframe = document.getElementById('figma-frame');

						// Hide loading after iframe loads
						iframe.onload = function() {
							loadingEl.classList.add('hidden');
						};

						// Also hide loading after a timeout (Figma embed can be slow)
						setTimeout(function() {
							loadingEl.classList.add('hidden');
						}, 3000);

						function reloadFrame() {
							loadingEl.classList.remove('hidden');
							iframe.src = iframe.src;
							setTimeout(function() {
								loadingEl.classList.add('hidden');
							}, 3000);
						}
					</script>
				</body>
			</html>
		`
	}

	/**
	 * Check if the panel is currently open
	 */
	isOpen(): boolean {
		return !!this.panel
	}

	/**
	 * Toggle the panel visibility
	 */
	async toggle(figmaUrl?: string): Promise<void> {
		if (this.panel) {
			this.dispose()
		} else {
			await this.show(figmaUrl)
		}
	}

	/**
	 * Get the current Figma URL
	 */
	getCurrentUrl(): string {
		return this.currentFigmaUrl
	}

	dispose(): void {
		const panelToDispose = this.panel
		this.panel = undefined

		while (this.disposables.length) {
			const disposable = this.disposables.pop()
			if (disposable) {
				disposable.dispose()
			}
		}
		try {
			panelToDispose?.dispose()
		} catch {}
	}
}

export function getFigmaPreviewPanel(): FigmaPreviewPanel | null {
	return FigmaPreviewPanel.getInstance()
}
