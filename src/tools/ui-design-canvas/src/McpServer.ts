/**
 * UI Design Canvas - MCP Server
 * Provides tools for AI to create and manipulate UI designs
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { createServer } from "http";
import { DesignStore } from './DesignStore.js';
import type { DesignElement, ElementType, SemanticType } from './types.js';

// Configuration
const SSE_PORT = process.env.UI_CANVAS_PORT || 4420;
const HOST = "127.0.0.1";

// Design store instance
const store = new DesignStore();

// Screenshot callback (will be set by VS Code extension)
let screenshotCallback: (() => Promise<string>) | null = null;

export function setScreenshotCallback(callback: () => Promise<string>) {
  screenshotCallback = callback;
}

// Design update callback (will be set by VS Code extension)
let designUpdateCallback: ((design: any) => void) | null = null;

export function setDesignUpdateCallback(callback: (design: any) => void) {
  designUpdateCallback = callback;
  store.subscribe((design) => {
    if (designUpdateCallback) {
      designUpdateCallback(design);
    }
  });
}

// ========== Tool Definitions ==========
const TOOLS = [
  // ===== Document Operations =====
  {
    name: "get_design",
    description: "Get the full design document in AI-readable JSON format. Use this to understand the current design structure, elements, and styling.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["full", "summary", "tree"],
          description: "Output format: 'full' for complete JSON, 'summary' for AI summary, 'tree' for hierarchy only"
        }
      }
    }
  },
  {
    name: "new_design",
    description: "Create a new empty design canvas.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Design name" },
        width: { type: "number", description: "Canvas width (default 390)" },
        height: { type: "number", description: "Canvas height (default 844)" },
        device: { type: "string", description: "Device preset: 'iPhone 14 Pro', 'iPhone SE', 'iPad', 'Desktop'" }
      }
    }
  },
  {
    name: "set_canvas",
    description: "Update canvas settings.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
        backgroundColor: { type: "string", description: "Background color (hex)" }
      }
    }
  },

  // ===== Element Creation =====
  {
    name: "create_frame",
    description: "Create a frame/container that can hold other elements. Use for screens, cards, sections, etc.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Frame name (e.g., 'App Screen', 'Header', 'Card')" },
        semantic: { type: "string", description: "Semantic type: screen, header, footer, card, section, nav, etc." },
        description: { type: "string", description: "Description of this frame's purpose" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        fill: { type: "string", description: "Fill color (hex or token like $colors.primary)" },
        radius: { type: "number", description: "Border radius" },
        parentId: { type: "string", description: "Parent element ID to nest inside" },
        layout: {
          type: "object",
          description: "Layout settings for children",
          properties: {
            type: { type: "string", enum: ["flex", "grid"] },
            direction: { type: "string", enum: ["row", "column"] },
            gap: { type: "number" },
            padding: { type: "number" },
            alignItems: { type: "string" },
            justifyContent: { type: "string" }
          }
        }
      },
      required: ["width", "height"]
    }
  },
  {
    name: "create_rectangle",
    description: "Create a rectangle shape. Use for buttons, backgrounds, dividers, etc.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        semantic: { type: "string", description: "button, divider, badge, chip, etc." },
        description: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        fill: { type: "string", description: "Fill color" },
        stroke: { type: "string", description: "Stroke color" },
        strokeWidth: { type: "number" },
        radius: { type: "number", description: "Corner radius" },
        parentId: { type: "string" }
      },
      required: ["width", "height"]
    }
  },
  {
    name: "create_text",
    description: "Create a text element. Use for labels, headings, paragraphs, buttons text, etc.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The text content" },
        name: { type: "string" },
        semantic: { type: "string", description: "heading, paragraph, label, caption, etc." },
        description: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", description: "Text box width (optional, auto-size if not set)" },
        fontSize: { type: "number", description: "Font size or use token like $typography.h1" },
        fontWeight: { type: "string", enum: ["normal", "medium", "semibold", "bold"] },
        fill: { type: "string", description: "Text color" },
        textAlign: { type: "string", enum: ["left", "center", "right"] },
        parentId: { type: "string" }
      },
      required: ["content"]
    }
  },
  {
    name: "create_ellipse",
    description: "Create an ellipse/circle. Use for avatars, icons, status indicators, etc.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        semantic: { type: "string", description: "avatar, icon, indicator, etc." },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        fill: { type: "string" },
        stroke: { type: "string" },
        strokeWidth: { type: "number" },
        parentId: { type: "string" }
      },
      required: ["width", "height"]
    }
  },
  {
    name: "create_image",
    description: "Create an image placeholder or load an image.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        semantic: { type: "string", description: "image, avatar, icon, banner, etc." },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        src: { type: "string", description: "Image URL or base64" },
        placeholder: { type: "string", description: "Placeholder color if no image" },
        parentId: { type: "string" }
      },
      required: ["width", "height"]
    }
  },

  // ===== Element Modification =====
  {
    name: "update_element",
    description: "Update any property of an element.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Element ID to update" },
        name: { type: "string" },
        semantic: { type: "string" },
        description: { type: "string" },
        content: { type: "string", description: "For text elements" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        fill: { type: "string" },
        stroke: { type: "string" },
        strokeWidth: { type: "number" },
        radius: { type: "number" },
        fontSize: { type: "number" },
        fontWeight: { type: "string" },
        textAlign: { type: "string" },
        opacity: { type: "number" },
        interactive: { type: "boolean" },
        action: { type: "string", description: "What happens on click" }
      },
      required: ["id"]
    }
  },
  {
    name: "move_element",
    description: "Move an element to a new position.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        x: { type: "number" },
        y: { type: "number" }
      },
      required: ["id", "x", "y"]
    }
  },
  {
    name: "resize_element",
    description: "Resize an element.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        width: { type: "number" },
        height: { type: "number" }
      },
      required: ["id", "width", "height"]
    }
  },
  {
    name: "delete_element",
    description: "Delete an element from the design.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Element ID to delete" }
      },
      required: ["id"]
    }
  },
  {
    name: "set_style",
    description: "Set multiple style properties at once.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        fill: { type: "string" },
        stroke: { type: "string" },
        strokeWidth: { type: "number" },
        radius: { type: "number" },
        opacity: { type: "number" },
        shadow: {
          type: "object",
          properties: {
            offsetX: { type: "number" },
            offsetY: { type: "number" },
            blur: { type: "number" },
            color: { type: "string" }
          }
        }
      },
      required: ["id"]
    }
  },
  {
    name: "set_layout",
    description: "Set flex or grid layout on a frame.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["none", "flex", "grid"] },
        direction: { type: "string", enum: ["row", "column", "row-reverse", "column-reverse"] },
        gap: { type: "number" },
        rowGap: { type: "number" },
        columnGap: { type: "number" },
        padding: { type: "number" },
        alignItems: { type: "string", enum: ["start", "center", "end", "stretch"] },
        justifyContent: { type: "string", enum: ["start", "center", "end", "space-between", "space-around"] },
        wrap: { type: "boolean" }
      },
      required: ["id"]
    }
  },

  // ===== Query Operations =====
  {
    name: "find_elements",
    description: "Find elements by name, type, or semantic type.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Search by name (partial match)" },
        type: { type: "string", description: "Filter by element type: frame, rectangle, text, ellipse" },
        semantic: { type: "string", description: "Filter by semantic type: button, header, card, etc." },
        parentId: { type: "string", description: "Search only within this parent" }
      }
    }
  },
  {
    name: "get_element",
    description: "Get detailed information about a specific element.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },

  // ===== Import/Export =====
  {
    name: "import_html",
    description: "Import a design from HTML. The AI will analyze the structure and recreate it.",
    inputSchema: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML string to import" },
        css: { type: "string", description: "Optional CSS styles" }
      },
      required: ["html"]
    }
  },
  {
    name: "import_from_description",
    description: "Create a design from a text description. Describe what you want and the AI will create it.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Natural language description of the UI" },
        style: { type: "string", description: "Design style: minimal, playful, corporate, etc." }
      },
      required: ["description"]
    }
  },
  {
    name: "export_html",
    description: "Export the design as HTML/CSS code.",
    inputSchema: {
      type: "object",
      properties: {
        includeCSS: { type: "boolean", description: "Include CSS in output (default true)" },
        framework: { type: "string", enum: ["html", "react", "vue"], description: "Output framework" }
      }
    }
  },
  {
    name: "export_json",
    description: "Export the design as JSON.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },

  // ===== Screenshot =====
  {
    name: "get_screenshot",
    description: "Get a screenshot of the current design as base64 image. Use this to see what the design looks like.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["png", "jpeg"], description: "Image format" },
        scale: { type: "number", description: "Scale factor (1 = 100%)" }
      }
    }
  },

  // ===== Design Tokens =====
  {
    name: "set_tokens",
    description: "Update design tokens (colors, spacing, typography, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        colors: { type: "object", description: "Color tokens: { primary: '#007AFF', ... }" },
        spacing: { type: "object", description: "Spacing tokens: { sm: 8, md: 16, ... }" },
        radius: { type: "object", description: "Border radius tokens: { sm: 8, md: 12, ... }" },
        typography: { type: "object", description: "Typography tokens" }
      }
    }
  },
  {
    name: "get_tokens",
    description: "Get current design tokens.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

// ========== Tool Handlers ==========
async function handleTool(name: string, args: any): Promise<any> {
  switch (name) {
    // Document Operations
    case "get_design": {
      const format = args.format || "full";
      if (format === "summary") {
        return store.generateSummary();
      } else if (format === "tree") {
        return {
          hierarchy: store.generateSummary().structure.hierarchy,
          totalElements: store.generateSummary().structure.totalElements
        };
      }
      return store.getDesign();
    }

    case "new_design": {
      const devicePresets: Record<string, { width: number; height: number }> = {
        "iPhone 14 Pro": { width: 390, height: 844 },
        "iPhone SE": { width: 375, height: 667 },
        "iPad": { width: 810, height: 1080 },
        "Desktop": { width: 1440, height: 900 }
      };
      const preset = args.device ? devicePresets[args.device] : null;
      const design = store.createEmptyDesign(args.name);
      if (preset) {
        design.canvas.width = preset.width;
        design.canvas.height = preset.height;
        design.canvas.device = args.device;
      }
      if (args.width) design.canvas.width = args.width;
      if (args.height) design.canvas.height = args.height;
      store.setDesign(design);
      return { success: true, design: store.generateSummary() };
    }

    case "set_canvas": {
      const design = store.getDesign();
      if (args.width) design.canvas.width = args.width;
      if (args.height) design.canvas.height = args.height;
      if (args.backgroundColor) design.canvas.backgroundColor = args.backgroundColor;
      store.setDesign(design);
      return { success: true, canvas: design.canvas };
    }

    // Element Creation
    case "create_frame":
    case "create_rectangle":
    case "create_ellipse":
    case "create_image": {
      const typeMap: Record<string, ElementType> = {
        create_frame: "frame",
        create_rectangle: "rectangle",
        create_ellipse: "ellipse",
        create_image: "image"
      };
      const element = store.createElement(typeMap[name], {
        name: args.name,
        semantic: args.semantic as SemanticType,
        description: args.description,
        bounds: {
          x: args.x || 0,
          y: args.y || 0,
          width: args.width,
          height: args.height
        },
        style: {
          fill: args.fill || args.placeholder,
          stroke: args.stroke ? { color: args.stroke, width: args.strokeWidth || 1 } : undefined,
          radius: args.radius,
          layout: args.layout
        },
        src: args.src
      });
      store.addElement(element, args.parentId);
      return { success: true, element };
    }

    case "create_text": {
      const element = store.createElement("text", {
        name: args.name,
        semantic: args.semantic as SemanticType,
        description: args.description,
        content: args.content,
        bounds: {
          x: args.x || 0,
          y: args.y || 0,
          width: args.width || 200,
          height: args.fontSize ? args.fontSize * 1.5 : 24
        },
        style: {
          fill: args.fill,
          text: {
            fontSize: args.fontSize,
            fontWeight: args.fontWeight,
            textAlign: args.textAlign
          }
        }
      });
      store.addElement(element, args.parentId);
      return { success: true, element };
    }

    // Element Modification
    case "update_element": {
      const updates: Partial<DesignElement> = {};
      if (args.name) updates.name = args.name;
      if (args.semantic) updates.semantic = args.semantic as SemanticType;
      if (args.description) updates.description = args.description;
      if (args.content) updates.content = args.content;
      if (args.interactive !== undefined) updates.interactive = args.interactive;
      if (args.action) updates.action = args.action;

      if (args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined) {
        const existing = store.findElement(args.id);
        if (existing) {
          updates.bounds = {
            x: args.x ?? existing.bounds.x,
            y: args.y ?? existing.bounds.y,
            width: args.width ?? existing.bounds.width,
            height: args.height ?? existing.bounds.height
          };
        }
      }

      if (args.fill || args.stroke || args.radius !== undefined || args.opacity !== undefined || args.fontSize || args.fontWeight || args.textAlign) {
        const existing = store.findElement(args.id);
        updates.style = { ...existing?.style };
        if (args.fill) updates.style.fill = args.fill;
        if (args.stroke) updates.style.stroke = { color: args.stroke, width: args.strokeWidth || 1 };
        if (args.radius !== undefined) updates.style.radius = args.radius;
        if (args.opacity !== undefined) updates.style.opacity = args.opacity;
        if (args.fontSize || args.fontWeight || args.textAlign) {
          updates.style.text = {
            ...existing?.style?.text,
            fontSize: args.fontSize ?? existing?.style?.text?.fontSize,
            fontWeight: args.fontWeight ?? existing?.style?.text?.fontWeight,
            textAlign: args.textAlign ?? existing?.style?.text?.textAlign
          };
        }
      }

      const element = store.updateElement(args.id, updates);
      return element ? { success: true, element } : { success: false, error: "Element not found" };
    }

    case "move_element": {
      const element = store.moveElement(args.id, args.x, args.y);
      return element ? { success: true, element } : { success: false, error: "Element not found" };
    }

    case "resize_element": {
      const element = store.resizeElement(args.id, args.width, args.height);
      return element ? { success: true, element } : { success: false, error: "Element not found" };
    }

    case "delete_element": {
      const deleted = store.deleteElement(args.id);
      return { success: deleted };
    }

    case "set_style": {
      const existing = store.findElement(args.id);
      if (!existing) return { success: false, error: "Element not found" };

      const style = { ...existing.style };
      if (args.fill) style.fill = args.fill;
      if (args.stroke) style.stroke = { color: args.stroke, width: args.strokeWidth || 1 };
      if (args.radius !== undefined) style.radius = args.radius;
      if (args.opacity !== undefined) style.opacity = args.opacity;
      if (args.shadow) style.shadow = args.shadow;

      const element = store.updateElement(args.id, { style });
      return { success: true, element };
    }

    case "set_layout": {
      const existing = store.findElement(args.id);
      if (!existing) return { success: false, error: "Element not found" };

      const layout = {
        type: args.type || "flex",
        direction: args.direction,
        gap: args.gap,
        rowGap: args.rowGap,
        columnGap: args.columnGap,
        padding: args.padding,
        alignItems: args.alignItems,
        justifyContent: args.justifyContent,
        wrap: args.wrap
      };

      const element = store.updateElement(args.id, {
        style: { ...existing.style, layout }
      });
      return { success: true, element };
    }

    // Query Operations
    case "find_elements": {
      let results = store.findElements(() => true);
      if (args.name) {
        results = results.filter(el => el.name?.toLowerCase().includes(args.name.toLowerCase()));
      }
      if (args.type) {
        results = results.filter(el => el.type === args.type);
      }
      if (args.semantic) {
        results = results.filter(el => el.semantic === args.semantic);
      }
      return { count: results.length, elements: results.map(el => ({
        id: el.id,
        type: el.type,
        semantic: el.semantic,
        name: el.name,
        bounds: el.bounds
      }))};
    }

    case "get_element": {
      const element = store.findElement(args.id);
      return element || { error: "Element not found" };
    }

    // Import/Export
    case "import_html": {
      // This would parse HTML and create elements
      // For now, return a placeholder
      return { success: false, error: "HTML import not yet implemented. Use create_* tools instead." };
    }

    case "import_from_description": {
      // This would use AI to generate design from description
      return { success: false, error: "Description import requires AI processing. Please describe individual elements using create_* tools." };
    }

    case "export_html": {
      const design = store.getDesign();
      const html = generateHTML(design, args.framework || "html");
      return { html };
    }

    case "export_json": {
      return { json: store.exportDesign() };
    }

    // Screenshot
    case "get_screenshot": {
      if (screenshotCallback) {
        try {
          const screenshot = await screenshotCallback();
          return { success: true, image: screenshot, format: args.format || "png" };
        } catch (error) {
          return { success: false, error: "Failed to capture screenshot" };
        }
      }
      return { success: false, error: "Screenshot not available. Preview panel must be open." };
    }

    // Design Tokens
    case "set_tokens": {
      const design = store.getDesign();
      if (args.colors) Object.assign(design.tokens.colors, args.colors);
      if (args.spacing) Object.assign(design.tokens.spacing, args.spacing);
      if (args.radius) Object.assign(design.tokens.radius, args.radius);
      if (args.typography) Object.assign(design.tokens.typography, args.typography);
      store.setDesign(design);
      return { success: true, tokens: design.tokens };
    }

    case "get_tokens": {
      return store.getDesign().tokens;
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ========== HTML Generator ==========
function generateHTML(design: any, framework: string): string {
  // Simple HTML generation
  const generateElement = (el: any, indent: string = ""): string => {
    const style = [];
    if (el.bounds) {
      style.push(`position: absolute`);
      style.push(`left: ${el.bounds.x}px`);
      style.push(`top: ${el.bounds.y}px`);
      style.push(`width: ${el.bounds.width}px`);
      style.push(`height: ${el.bounds.height}px`);
    }
    if (el.style?.fill) style.push(`background-color: ${el.style.fill}`);
    if (el.style?.radius) style.push(`border-radius: ${el.style.radius}px`);
    if (el.style?.stroke) style.push(`border: ${el.style.stroke.width}px solid ${el.style.stroke.color}`);

    const styleStr = style.length > 0 ? ` style="${style.join('; ')}"` : '';
    const children = el.children?.map((c: any) => generateElement(c, indent + "  ")).join('\n') || '';

    if (el.type === 'text') {
      return `${indent}<span${styleStr}>${el.content || ''}</span>`;
    }

    return `${indent}<div${styleStr}>${children ? '\n' + children + '\n' + indent : ''}</div>`;
  };

  const elements = design.elements.map((el: any) => generateElement(el, "  ")).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${design.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .canvas { position: relative; width: ${design.canvas.width}px; height: ${design.canvas.height}px; background: ${design.canvas.backgroundColor || '#fff'}; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="canvas">
${elements}
  </div>
</body>
</html>`;
}

// ========== MCP Server Setup ==========
const mcpServer = new Server(
  { name: "ui-design-canvas", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ========== SSE Server ==========
const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Map of sessionId -> transport
const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req, res) => {
  console.error("[ui-design-canvas] SSE connection established");
  const transport = new SSEServerTransport("/message", res);

  // NOTE: Do NOT call transport.start() manually!
  // mcpServer.connect() will call it automatically.
  // Get the sessionId from the transport (it's private, but we need it for routing)
  const sessionId = (transport as any)._sessionId;
  transports.set(sessionId, transport);

  res.on("close", () => {
    console.error("[ui-design-canvas] SSE connection closed");
    transports.delete(sessionId);
  });

  // connect() calls transport.start() internally, which sends the endpoint event
  await mcpServer.connect(transport);
});

// Don't use express.json() - the MCP SDK parses the body itself using raw-body
app.post("/message", async (req, res) => {
  // Extract sessionId from query params
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId" });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(400).json({ error: "Invalid sessionId or session expired" });
    return;
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (e) {
    console.error("[ui-design-canvas] Error handling POST message:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: String(e) });
    }
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", designName: store.getDesign().name });
});

// Get current design (for preview panel)
app.get("/design", (req, res) => {
  res.json(store.getDesign());
});

// Update full design (from preview panel edits)
app.put("/api/design", express.json(), (req, res) => {
  try {
    const design = req.body;
    if (!design) {
      res.status(400).json({ error: "No design data provided" });
      return;
    }

    // Update the design store (setDesign expects an object, not a string)
    store.setDesign(design);
    console.error("[ui-design-canvas] Design updated from preview panel");
    res.json({ success: true });
  } catch (error) {
    console.error("[ui-design-canvas] Error updating design:", error);
    res.status(500).json({ error: "Failed to update design" });
  }
});

// Update individual element (from preview panel edits)
app.put("/api/design/element/:id", express.json(), (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id || !updates) {
      res.status(400).json({ error: "Missing element id or updates" });
      return;
    }

    // Apply updates to the element (returns element or null)
    const element = store.updateElement(id, updates);
    if (element) {
      console.error(`[ui-design-canvas] Element ${id} updated from preview panel`);
      res.json({ success: true, element });
    } else {
      res.status(404).json({ error: "Element not found" });
    }
  } catch (error) {
    console.error("[ui-design-canvas] Error updating element:", error);
    res.status(500).json({ error: "Failed to update element" });
  }
});

// Delete element (from preview panel)
app.delete("/api/design/element/:id", (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ error: "Missing element id" });
      return;
    }

    const success = store.deleteElement(id);
    if (success) {
      console.error(`[ui-design-canvas] Element ${id} deleted from preview panel`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Element not found" });
    }
  } catch (error) {
    console.error("[ui-design-canvas] Error deleting element:", error);
    res.status(500).json({ error: "Failed to delete element" });
  }
});

export function startServer(port: number = Number(SSE_PORT)) {
  const httpServer = createServer(app);
  httpServer.listen(port, HOST, () => {
    console.error(`[ui-design-canvas] MCP SSE server listening on http://${HOST}:${port}/sse`);
  });
  return httpServer;
}

// Export for use by VS Code extension
export { store, handleTool, TOOLS };

// Auto-start the server when run directly (not imported as a module)
// In ESM, we check if this is the main module using import.meta.url
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule || process.argv[1]?.endsWith('McpServer.js')) {
  console.error('[ui-design-canvas] Starting server...');
  startServer();
}
