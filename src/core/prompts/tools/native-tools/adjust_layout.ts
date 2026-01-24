import type OpenAI from "openai"

const ADJUST_LAYOUT_DESCRIPTION = `Automatically arrange Figma nodes in a specified layout (grid, row, or column).

Supports two modes:
1. AI mode (default): Parallel AI agents intelligently adjust each element's position, layer order, and optionally colors
2. Algorithm mode (useAI=false): Mathematical position calculations, fast and deterministic

Use this after creating UI elements with parallel_ui_tasks to arrange them in a proper grid or list layout.`

export default {
	type: "function",
	function: {
		name: "adjust_layout",
		description: ADJUST_LAYOUT_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				layout: {
					type: "string",
					description:
						'Layout type: "grid" (arrange in rows and columns), "row" (single horizontal row), or "column" (single vertical column)',
					enum: ["grid", "row", "column"],
				},
				columns: {
					type: "string",
					description: "Number of columns for grid layout (default: 4). Ignored for row/column layouts.",
				},
				gap: {
					type: "string",
					description:
						"Gap between elements in pixels (default: 10). Used for both horizontal and vertical spacing.",
				},
				gapX: {
					type: "string",
					description: "Horizontal gap between elements (overrides gap). Optional.",
				},
				gapY: {
					type: "string",
					description: "Vertical gap between elements (overrides gap). Optional.",
				},
				startX: {
					type: "string",
					description: "Starting X position in pixels (default: 20)",
				},
				startY: {
					type: "string",
					description: "Starting Y position in pixels (default: 80, leaving room for header/title)",
				},
				within: {
					type: "string",
					description:
						"Container node ID to search within. If provided, arranges all child nodes of this container.",
				},
				nodeIds: {
					type: "string",
					description:
						"JSON array of specific node IDs to arrange. If not provided, finds all nodes within the container or on the current page.",
				},
				excludeTypes: {
					type: "string",
					description:
						'Comma-separated node types to exclude (e.g., "FRAME,GROUP"). Default excludes FRAME when searching entire page.',
				},
				sortBy: {
					type: "string",
					description:
						'How to sort nodes before arranging: "name" (alphabetical/numeric), "x" (by x position), "y" (by y position), "created" (creation order). Default: "name"',
					enum: ["name", "x", "y", "created"],
				},
				useAI: {
					type: "string",
					description:
						'Set to "true" to use parallel AI agents for intelligent adjustment. Each element is adjusted by a separate AI. Default: "false" (algorithm mode)',
					enum: ["true", "false"],
				},
				adjustColors: {
					type: "string",
					description:
						'AI mode only: Set to "true" to let AI adjust element colors for better visual harmony. Default: "false"',
					enum: ["true", "false"],
				},
				adjustLayers: {
					type: "string",
					description:
						'AI mode only: Set to "true" to let AI adjust layer order (z-index) so text appears above rectangles. Default: "false"',
					enum: ["true", "false"],
				},
			},
			required: ["layout"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
