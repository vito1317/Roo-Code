/**
 * SpecModeToggle - Spec/Vibe Mode Toggle
 *
 * Two side-by-side toggle buttons for switching between:
 * - Vibe Mode: "Chat first, then build" - Explore ideas and iterate as you discover needs
 * - Spec Mode: "Plan first, then build" - Create requirements and design before coding starts
 */

import React, { useCallback } from "react"
import { vscode } from "../../utils/vscode"

interface SpecModeToggleProps {
	isSpecMode: boolean
	onToggle?: (isSpec: boolean) => void
}

export const SpecModeToggle: React.FC<SpecModeToggleProps> = ({ isSpecMode, onToggle }) => {
	const handleVibeClick = useCallback(() => {
		// Update local state
		if (onToggle) {
			onToggle(false)
		}
		// Sync with extension - use 'text' field to match webviewMessageHandler
		vscode.postMessage({ type: "mode", text: "code" })
	}, [onToggle])

	const handleSpecClick = useCallback(() => {
		// Update local state
		if (onToggle) {
			onToggle(true)
		}
		// Sync with extension - use 'text' field to match webviewMessageHandler
		vscode.postMessage({ type: "mode", text: "spec" })
	}, [onToggle])

	return (
		<div className="spec-mode-toggle">
			<style>{`
				.spec-mode-toggle {
					display: flex;
					gap: 12px;
					margin: 16px 0;
				}

				.mode-toggle-card {
					flex: 1;
					padding: 12px 16px;
					border-radius: 8px;
					border: 2px solid transparent;
					cursor: pointer;
					transition: all 0.2s ease;
					background: var(--vscode-editor-background);
				}

				.mode-toggle-card:hover {
					border-color: var(--vscode-focusBorder);
				}

				.mode-toggle-card.active {
					border-color: var(--vscode-button-background);
					background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
				}

				.mode-toggle-card.vibe.active {
					border-color: #6366f1;
					background: color-mix(in srgb, #6366f1 10%, transparent);
				}

				.mode-toggle-card.spec.active {
					border-color: #8b5cf6;
					background: color-mix(in srgb, #8b5cf6 10%, transparent);
				}

				.mode-toggle-header {
					display: flex;
					align-items: center;
					gap: 8px;
					margin-bottom: 6px;
				}

				.mode-toggle-radio {
					width: 16px;
					height: 16px;
					border-radius: 50%;
					border: 2px solid var(--vscode-checkbox-border);
					display: flex;
					align-items: center;
					justify-content: center;
					flex-shrink: 0;
				}

				.mode-toggle-card.active .mode-toggle-radio {
					border-color: var(--vscode-button-background);
				}

				.mode-toggle-card.vibe.active .mode-toggle-radio {
					border-color: #6366f1;
				}

				.mode-toggle-card.spec.active .mode-toggle-radio {
					border-color: #8b5cf6;
				}

				.mode-toggle-radio-inner {
					width: 8px;
					height: 8px;
					border-radius: 50%;
					background: transparent;
				}

				.mode-toggle-card.active .mode-toggle-radio-inner {
					background: var(--vscode-button-background);
				}

				.mode-toggle-card.vibe.active .mode-toggle-radio-inner {
					background: #6366f1;
				}

				.mode-toggle-card.spec.active .mode-toggle-radio-inner {
					background: #8b5cf6;
				}

				.mode-toggle-name {
					font-weight: 600;
					font-size: 14px;
					color: var(--vscode-foreground);
				}

				.mode-toggle-tagline {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-bottom: 8px;
				}

				.mode-toggle-description {
					font-size: 11px;
					color: var(--vscode-descriptionForeground);
					opacity: 0.8;
					line-height: 1.4;
				}

				.mode-toggle-icon {
					font-size: 16px;
				}
			`}</style>

			{/* Vibe Mode Card */}
			<div
				className={`mode-toggle-card vibe ${!isSpecMode ? "active" : ""}`}
				onClick={handleVibeClick}
				role="button"
				tabIndex={0}
				onKeyPress={(e) => e.key === "Enter" && handleVibeClick()}
			>
				<div className="mode-toggle-header">
					<div className="mode-toggle-radio">
						<div className="mode-toggle-radio-inner" />
					</div>
					<span className="mode-toggle-name">Vibe</span>
				</div>
				<div className="mode-toggle-tagline">Chat first, then build.</div>
				<div className="mode-toggle-description">
					Explore ideas and iterate as you discover needs.
				</div>
			</div>

			{/* Spec Mode Card */}
			<div
				className={`mode-toggle-card spec ${isSpecMode ? "active" : ""}`}
				onClick={handleSpecClick}
				role="button"
				tabIndex={0}
				onKeyPress={(e) => e.key === "Enter" && handleSpecClick()}
			>
				<div className="mode-toggle-header">
					<div className="mode-toggle-radio">
						<div className="mode-toggle-radio-inner" />
					</div>
					<span className="mode-toggle-name">Spec</span>
				</div>
				<div className="mode-toggle-tagline">Plan first, then build.</div>
				<div className="mode-toggle-description">
					Create requirements and design before coding starts.
				</div>
			</div>
		</div>
	)
}

/**
 * SpecModeInfo - Additional info shown when Spec mode is active
 */
export const SpecModeInfo: React.FC = () => {
	const handleOpenWorkflowPanel = () => {
		vscode.postMessage({ type: "openSpecWorkflowPanel" })
	}

	return (
		<div className="spec-mode-info">
			<style>{`
				.spec-mode-info {
					padding: 12px;
					background: var(--vscode-textBlockQuote-background);
					border-radius: 6px;
					margin-top: 8px;
				}

				.spec-mode-info-title {
					font-weight: 600;
					font-size: 12px;
					color: var(--vscode-foreground);
					margin-bottom: 8px;
				}

				.spec-mode-info-list {
					list-style: none;
					padding: 0;
					margin: 0;
				}

				.spec-mode-info-item {
					font-size: 11px;
					color: var(--vscode-descriptionForeground);
					padding: 2px 0;
					display: flex;
					align-items: flex-start;
					gap: 6px;
				}

				.spec-mode-info-bullet {
					color: var(--vscode-textLink-foreground);
					font-weight: bold;
				}

				.spec-mode-open-panel-btn {
					margin-top: 12px;
					padding: 6px 12px;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					border-radius: 4px;
					cursor: pointer;
					font-size: 12px;
					display: flex;
					align-items: center;
					gap: 6px;
					width: 100%;
					justify-content: center;
				}

				.spec-mode-open-panel-btn:hover {
					background: var(--vscode-button-hoverBackground);
				}
			`}</style>

			<div className="spec-mode-info-title">Great for:</div>
			<ul className="spec-mode-info-list">
				<li className="spec-mode-info-item">
					<span className="spec-mode-info-bullet">•</span>
					Thinking through features in-depth
				</li>
				<li className="spec-mode-info-item">
					<span className="spec-mode-info-bullet">•</span>
					Projects needing upfront planning
				</li>
				<li className="spec-mode-info-item">
					<span className="spec-mode-info-bullet">•</span>
					Building features in a structured way
				</li>
			</ul>
			<button className="spec-mode-open-panel-btn" onClick={handleOpenWorkflowPanel}>
				📋 Open Workflow Panel
			</button>
		</div>
	)
}

export default SpecModeToggle
