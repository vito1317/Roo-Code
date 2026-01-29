/**
 * Penpot Preview Panel
 *
 * Creates a webview panel that embeds Penpot's web view for real-time preview.
 * Shows Penpot designs in VS Code.
 */

import * as vscode from "vscode"

export class PenpotPreviewPanel {
	private static instance: PenpotPreviewPanel | null = null
	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []
	private currentPenpotUrl: string = ""
	private extensionUri: vscode.Uri

	private constructor(extensionUri: vscode.Uri) {
		this.extensionUri = extensionUri
	}

	static initialize(extensionUri: vscode.Uri): PenpotPreviewPanel {
		if (!PenpotPreviewPanel.instance) {
			PenpotPreviewPanel.instance = new PenpotPreviewPanel(extensionUri)
		}
		return PenpotPreviewPanel.instance
	}

	static getInstance(): PenpotPreviewPanel | null {
		return PenpotPreviewPanel.instance
	}

	/**
	 * Validate Penpot URL format
	 * Supports formats:
	 * - https://design.penpot.app/#/workspace/xxx
	 * - https://design.penpot.app/#/view/xxx
	 * - Self-hosted: https://your-penpot.com/#/workspace/xxx
	 */
	private isValidPenpotUrl(url: string): boolean {
		// Accept any URL that looks like a Penpot workspace or view
		return /penpot.*#\/(workspace|view|frame)/.test(url) || url.includes("penpot")
	}

	/**
	 * Show the Penpot preview panel with the specified URL
	 */
	async show(penpotUrl?: string): Promise<void> {
		if (penpotUrl) {
			this.currentPenpotUrl = penpotUrl
		}

		if (!this.currentPenpotUrl) {
			vscode.window.showWarningMessage("Please set a Penpot file URL in settings first.")
			return
		}

		// Basic validation
		if (!this.isValidPenpotUrl(this.currentPenpotUrl)) {
			vscode.window.showWarningMessage("The URL doesn't look like a Penpot URL. Opening anyway...")
		}

		await this.createOrShowPanel()
	}

	/**
	 * Update the Penpot URL and refresh the panel
	 */
	async updateUrl(penpotUrl: string): Promise<void> {
		this.currentPenpotUrl = penpotUrl
		if (this.panel) {
			await this.updatePanelContent()
		}
	}

	private async createOrShowPanel(): Promise<void> {
		if (this.panel) {
			// Use ViewColumn.One for fullscreen display
			this.panel.reveal(vscode.ViewColumn.One)
			await this.updatePanelContent()
			return
		}

		// Use ViewColumn.One for fullscreen display
		this.panel = vscode.window.createWebviewPanel(
			"roo.penpotPreview",
			"🎨 Penpot Preview",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		)

		await this.updatePanelContent()

		// Handle messages from webview
		this.panel.webview.onDidReceiveMessage(
			async (message) => {
				if (message.type === "openExternal" && message.url) {
					vscode.env.openExternal(vscode.Uri.parse(message.url))
				}
			},
			null,
			this.disposables
		)

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
		this.panel.webview.html = this.getHtmlContent(this.currentPenpotUrl)
	}

	private getHtmlContent(penpotUrl: string): string {
		// Extract the base domain for CSP
		let penpotDomain = "https://design.penpot.app"
		try {
			const url = new URL(penpotUrl)
			penpotDomain = `${url.protocol}//${url.host}`
		} catch {
			// Use default if URL parsing fails
		}

		// Check if URL is a view/embed URL that might support iframe
		const isViewUrl = penpotUrl.includes('/view') || penpotUrl.includes('/frame')
		const isWorkspaceUrl = penpotUrl.includes('/workspace')

		return `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${penpotDomain} https://*.penpot.app https://*.penpot.dev http://localhost:* ws://localhost:*; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
					<title>Penpot Preview</title>
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
						.btn-group {
							display: flex;
							gap: 8px;
						}
						.reload-btn, .open-btn {
							background: #0e639c;
							color: white;
							border: none;
							padding: 4px 12px;
							border-radius: 3px;
							cursor: pointer;
							font-size: 12px;
						}
						.reload-btn:hover, .open-btn:hover {
							background: #1177bb;
						}
						.open-btn {
							background: #388e3c;
						}
						.open-btn:hover {
							background: #4caf50;
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
						.notice {
							position: absolute;
							top: 50%;
							left: 50%;
							transform: translate(-50%, -50%);
							color: #ccc;
							font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
							text-align: center;
							z-index: 20;
							background: #2d2d2d;
							padding: 40px;
							border-radius: 12px;
							max-width: 500px;
							box-shadow: 0 4px 20px rgba(0,0,0,0.5);
						}
						.notice h2 {
							margin-top: 0;
							color: #fff;
						}
						.notice p {
							color: #aaa;
							line-height: 1.6;
						}
						.notice .btn {
							display: inline-block;
							background: #388e3c;
							color: white;
							border: none;
							padding: 10px 24px;
							border-radius: 6px;
							cursor: pointer;
							font-size: 14px;
							margin-top: 16px;
							text-decoration: none;
						}
						.notice .btn:hover {
							background: #4caf50;
						}
						.notice .tip {
							font-size: 12px;
							color: #888;
							margin-top: 20px;
							border-top: 1px solid #444;
							padding-top: 16px;
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
						.hidden {
							display: none;
						}
					</style>
				</head>
				<body>
					<div class="container">
						<div class="header">
							<div class="header-title">
								<span>🎨</span>
								<span>Penpot Preview</span>
								<span class="header-url" title="${this.currentPenpotUrl}">${this.currentPenpotUrl}</span>
							</div>
							<div class="btn-group">
								<button class="open-btn" onclick="openInBrowser()">
									↗ Open in Browser
								</button>
								<button class="reload-btn" onclick="reloadFrame()">
									↻ Reload
								</button>
							</div>
						</div>
						<div class="iframe-container">
							${isWorkspaceUrl ? `
							<div class="notice" id="notice">
								<h2>⚠️ Workspace 無法嵌入</h2>
								<p>Penpot 的 workspace URL 因安全限制無法在 iframe 中顯示。</p>
								<p>請使用 <strong>分享連結</strong> (Share → Get public link) 來取得可嵌入的 URL。</p>
								<button class="btn" onclick="openInBrowser()">↗ 在瀏覽器中開啟</button>
								<div class="tip">
									💡 <strong>提示：</strong>在 Penpot 中點擊 Share → Get public link，然後複製 View 連結貼到設定中。
								</div>
							</div>
							` : `
							<div class="loading" id="loading">Loading Penpot...</div>
							`}
							<iframe
								id="penpot-frame"
								src="${isWorkspaceUrl ? '' : penpotUrl}"
								allowfullscreen
								sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
								${isWorkspaceUrl ? 'class="hidden"' : ''}>
							</iframe>
						</div>
					</div>
					<script>
						var loadingEl = document.getElementById('loading');
						var iframe = document.getElementById('penpot-frame');
						var penpotUrl = "${penpotUrl}";
						var isWorkspaceUrl = ${isWorkspaceUrl};

						if (!isWorkspaceUrl && loadingEl) {
							// Hide loading after iframe loads
							iframe.onload = function() {
								loadingEl.classList.add('hidden');
							};

							// Also hide loading after a timeout
							setTimeout(function() {
								loadingEl.classList.add('hidden');
							}, 5000);
						}

						function reloadFrame() {
							if (isWorkspaceUrl) {
								openInBrowser();
								return;
							}
							if (loadingEl) loadingEl.classList.remove('hidden');
							iframe.src = iframe.src;
							setTimeout(function() {
								if (loadingEl) loadingEl.classList.add('hidden');
							}, 5000);
						}

						function openInBrowser() {
							// Send message to VS Code to open in external browser
							const vscode = acquireVsCodeApi();
							vscode.postMessage({ type: 'openExternal', url: penpotUrl });
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
	async toggle(penpotUrl?: string): Promise<void> {
		if (this.panel) {
			this.dispose()
		} else {
			await this.show(penpotUrl)
		}
	}

	/**
	 * Get the current Penpot URL
	 */
	getCurrentUrl(): string {
		return this.currentPenpotUrl
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

export function getPenpotPreviewPanel(): PenpotPreviewPanel | null {
	return PenpotPreviewPanel.getInstance()
}
