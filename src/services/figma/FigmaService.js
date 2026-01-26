/**
 * Figma MCP Server - Provides tools for reading Figma designs
 *
 * Tools:
 * - figma_get_file: Get complete file structure
 * - figma_get_nodes: Get specific nodes by ID
 * - figma_get_image: Export nodes as images
 */
import axios from "axios";
/**
 * Extract file key from a Figma URL
 * Examples:
 * - https://www.figma.com/file/ABC123/My-Design
 * - https://www.figma.com/design/ABC123/My-Design
 */
export function extractFileKey(figmaUrl) {
    const patterns = [
        /figma\.com\/file\/([a-zA-Z0-9]+)/,
        /figma\.com\/design\/([a-zA-Z0-9]+)/,
        /figma\.com\/proto\/([a-zA-Z0-9]+)/,
    ];
    for (const pattern of patterns) {
        const match = figmaUrl.match(pattern);
        if (match) {
            return match[1];
        }
    }
    // Maybe it's already a file key
    if (/^[a-zA-Z0-9]+$/.test(figmaUrl)) {
        return figmaUrl;
    }
    return null;
}
/**
 * Extract node IDs from a Figma URL
 * Example: ?node-id=1:2,3:4 → ["1:2", "3:4"]
 */
export function extractNodeIds(figmaUrl) {
    const match = figmaUrl.match(/node-id=([^&]+)/);
    if (match) {
        return match[1].split(",").map((id) => decodeURIComponent(id));
    }
    return [];
}
export class FigmaService {
    client;
    apiToken;
    constructor(apiToken) {
        this.apiToken = apiToken;
        this.client = axios.create({
            baseURL: "https://api.figma.com",
            headers: {
                "X-Figma-Token": apiToken,
            },
        });
    }
    /**
     * Get the complete JSON representation of a Figma file
     */
    async getFile(fileKey, options) {
        const params = {};
        if (options?.depth) {
            params.depth = options.depth;
        }
        const response = await this.client.get(`/v1/files/${fileKey}`, { params });
        return response.data;
    }
    /**
     * Get specific nodes from a Figma file
     */
    async getNodes(fileKey, nodeIds) {
        const response = await this.client.get(`/v1/files/${fileKey}/nodes`, {
            params: {
                ids: nodeIds.join(","),
            },
        });
        return response.data;
    }
    /**
     * Export nodes as images
     */
    async getImages(fileKey, nodeIds, options) {
        const response = await this.client.get(`/v1/images/${fileKey}`, {
            params: {
                ids: nodeIds.join(","),
                format: options?.format || "png",
                scale: options?.scale || 2,
            },
        });
        return response.data;
    }
    /**
     * Get a simplified tree structure for AI consumption with detailed styling
     */
    async getSimplifiedStructure(fileKey, options) {
        const file = await this.getFile(fileKey, { depth: options?.maxDepth || 4 });
        // Collect design tokens while traversing
        const colorSet = new Set();
        const fontSet = new Set();
        const simplify = (node, depth) => {
            const simplified = {
                id: node.id,
                name: node.name,
                type: node.type,
            };
            // Extract bounding box
            if (node.absoluteBoundingBox) {
                simplified.bounds = {
                    x: Math.round(node.absoluteBoundingBox.x),
                    y: Math.round(node.absoluteBoundingBox.y),
                    width: Math.round(node.absoluteBoundingBox.width),
                    height: Math.round(node.absoluteBoundingBox.height),
                };
            }
            // Extract corner radius
            if (node.cornerRadius !== undefined) {
                simplified.borderRadius = node.cornerRadius;
            }
            // Extract fills (background colors)
            if (node.fills && Array.isArray(node.fills)) {
                simplified.fills = node.fills
                    .filter((fill) => fill.visible !== false && fill.type === "SOLID")
                    .map((fill) => {
                    const hex = rgbaToHex(fill.color);
                    colorSet.add(hex);
                    return {
                        type: fill.type,
                        color: hex,
                        opacity: fill.opacity ?? 1,
                    };
                });
            }
            // Extract strokes (borders)
            if (node.strokes && Array.isArray(node.strokes)) {
                simplified.strokes = node.strokes
                    .filter((stroke) => stroke.visible !== false && stroke.type === "SOLID")
                    .map((stroke) => {
                    const hex = rgbaToHex(stroke.color);
                    colorSet.add(hex);
                    return {
                        type: stroke.type,
                        color: hex,
                        opacity: stroke.opacity ?? 1,
                    };
                });
            }
            // Extract effects (shadows, blur)
            if (node.effects && Array.isArray(node.effects)) {
                simplified.effects = node.effects
                    .filter((effect) => effect.visible !== false)
                    .map((effect) => ({
                    type: effect.type,
                    color: effect.color ? rgbaToHex(effect.color) : undefined,
                    offset: effect.offset,
                    radius: effect.radius,
                }));
            }
            // Extract text content and style
            if (node.characters) {
                simplified.text = node.characters;
            }
            // Extract text style
            if (node.style) {
                const style = node.style;
                simplified.textStyle = {
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    fontWeight: style.fontWeight,
                    letterSpacing: style.letterSpacing,
                    lineHeight: style.lineHeightPx,
                    textAlign: style.textAlignHorizontal,
                };
                if (style.fontFamily) {
                    fontSet.add(style.fontFamily);
                }
            }
            // Recurse into children
            if (node.children && depth > 0) {
                simplified.children = node.children.map((child) => simplify(child, depth - 1));
            }
            return simplified;
        };
        const structure = file.document.children?.map((page) => simplify(page, options?.maxDepth || 4)) || [];
        return {
            name: file.name,
            structure,
            designTokens: {
                colors: Array.from(colorSet),
                fonts: Array.from(fontSet),
            },
        };
    }
    /**
     * Validate the API token
     */
    async validateToken() {
        try {
            await this.client.get("/v1/me");
            return true;
        }
        catch {
            return false;
        }
    }
}
// Helper: Convert RGBA to hex
function rgbaToHex(color) {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
/**
 * Format a Figma design structure for LLM consumption with styling details
 */
export function formatForLLM(structure, indent = 0) {
    const lines = [];
    const prefix = "  ".repeat(indent);
    for (const node of structure) {
        let line = `${prefix}- ${node.name} (${node.type})`;
        if (node.bounds) {
            line += ` [${node.bounds.width}×${node.bounds.height}]`;
        }
        if (node.borderRadius) {
            line += ` border-radius:${node.borderRadius}px`;
        }
        if (node.fills && node.fills.length > 0) {
            line += ` bg:${node.fills.map((f) => f.color).join(",")}`;
        }
        if (node.text) {
            line += `: "${node.text.substring(0, 30)}${node.text.length > 30 ? "..." : ""}"`;
        }
        if (node.textStyle?.fontFamily) {
            line += ` font:${node.textStyle.fontFamily} ${node.textStyle.fontSize}px`;
        }
        lines.push(line);
        if (node.children) {
            lines.push(formatForLLM(node.children, indent + 1));
        }
    }
    return lines.join("\n");
}
//# sourceMappingURL=FigmaService.js.map