#!/usr/bin/env node
/**
 * Penpot Write Bridge - MCP Server
 * Provides direct UI creation tools for Penpot via MCP protocol
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import { createServer } from "http";

// Configuration
const SSE_PORT = process.env.PENPOT_WRITE_SSE_PORT || 4410;
const WS_PORT = process.env.PENPOT_WRITE_WS_PORT || 4411;
const HOST = "127.0.0.1";

// ========== WebSocket Bridge to Penpot Plugin ==========
const wss = new WebSocketServer({ host: HOST, port: WS_PORT });
let pluginClient = null;

const pending = new Map();

function makeId() {
  return Math.random().toString(36).slice(2);
}

function sendToPlugin(action, args) {
  if (!pluginClient || pluginClient.readyState !== WebSocket.OPEN) {
    throw new Error(
      "Penpot plugin not connected. Please open the Penpot Write Bridge plugin in Penpot and click 'Connect'."
    );
  }
  const id = makeId();
  const payload = JSON.stringify({ id, action, args });
  pluginClient.send(payload);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Plugin timeout waiting for "${action}" response.`));
    }, 30000);

    pending.set(id, { resolve, reject, timeout });
  });
}

wss.on("connection", (ws) => {
  pluginClient = ws;
  console.error(`[penpot-write-bridge] Plugin connected`);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { replyTo, result, error } = msg;
      if (!replyTo) return;

      const p = pending.get(replyTo);
      if (!p) return;

      clearTimeout(p.timeout);
      pending.delete(replyTo);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    } catch (e) {
      console.error("[penpot-write-bridge] Bad message from plugin:", e);
    }
  });

  ws.on("close", () => {
    console.error("[penpot-write-bridge] Plugin disconnected");
    pluginClient = null;
  });
});

console.error(`[penpot-write-bridge] WebSocket server listening on ws://${HOST}:${WS_PORT}`);

// ========== Tool Definitions ==========
const TOOLS = [
  // Document Info
  {
    name: "get_document_info",
    description: "Get current Penpot document information including pages and current page shapes.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_page_info",
    description: "Get information about a specific page.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Page ID (optional, defaults to current page)" },
      },
    },
  },
  // Shape Creation
  {
    name: "create_board",
    description: "Create a board (frame/container) in Penpot. Boards can contain other shapes.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Board name" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        width: { type: "number", description: "Width in pixels" },
        height: { type: "number", description: "Height in pixels" },
        fillColor: { type: "string", description: "Fill color (hex, e.g. #FFFFFF)" },
      },
      required: ["width", "height"],
    },
  },
  {
    name: "create_rectangle",
    description: "Create a rectangle shape.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Shape name" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        width: { type: "number", description: "Width in pixels" },
        height: { type: "number", description: "Height in pixels" },
        fillColor: { type: "string", description: "Fill color (hex)" },
        strokeColor: { type: "string", description: "Stroke color (hex)" },
        strokeWidth: { type: "number", description: "Stroke width" },
        borderRadius: { type: "number", description: "Corner radius" },
        parentId: { type: "string", description: "Parent board ID to create inside" },
      },
      required: ["width", "height"],
    },
  },
  {
    name: "create_ellipse",
    description: "Create an ellipse/circle shape.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Shape name" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        width: { type: "number", description: "Width in pixels" },
        height: { type: "number", description: "Height in pixels" },
        fillColor: { type: "string", description: "Fill color (hex)" },
        strokeColor: { type: "string", description: "Stroke color (hex)" },
        strokeWidth: { type: "number", description: "Stroke width" },
        parentId: { type: "string", description: "Parent board ID" },
      },
      required: ["width", "height"],
    },
  },
  {
    name: "create_text",
    description: "Create a text element.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text content" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        fontSize: { type: "number", description: "Font size (default 16)" },
        fontFamily: { type: "string", description: "Font family (default 'Work Sans')" },
        fillColor: { type: "string", description: "Text color (hex)" },
        parentId: { type: "string", description: "Parent board ID" },
      },
      required: ["text"],
    },
  },
  // Shape Modification
  {
    name: "set_fill",
    description: "Set the fill color of a shape.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Shape ID" },
        color: { type: "string", description: "Fill color (hex)" },
        opacity: { type: "number", description: "Fill opacity (0-1)" },
      },
      required: ["nodeId", "color"],
    },
  },
  {
    name: "set_stroke",
    description: "Set the stroke of a shape.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Shape ID" },
        color: { type: "string", description: "Stroke color (hex)" },
        width: { type: "number", description: "Stroke width" },
        opacity: { type: "number", description: "Stroke opacity (0-1)" },
      },
      required: ["nodeId", "color"],
    },
  },
  {
    name: "move_node",
    description: "Move a shape to a new position.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Shape ID" },
        x: { type: "number", description: "New X position" },
        y: { type: "number", description: "New Y position" },
      },
      required: ["nodeId", "x", "y"],
    },
  },
  {
    name: "resize_node",
    description: "Resize a shape.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Shape ID" },
        width: { type: "number", description: "New width" },
        height: { type: "number", description: "New height" },
      },
      required: ["nodeId", "width", "height"],
    },
  },
  {
    name: "delete_node",
    description: "Delete a shape.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Shape ID to delete" },
      },
      required: ["nodeId"],
    },
  },
  {
    name: "rename_node",
    description: "Rename a shape.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Shape ID" },
        name: { type: "string", description: "New name" },
      },
      required: ["nodeId", "name"],
    },
  },
  // Layout
  {
    name: "set_flex_layout",
    description: "Add flex layout to a board.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Board ID" },
        direction: { type: "string", enum: ["row", "column", "row-reverse", "column-reverse"], description: "Flex direction" },
        gap: { type: "number", description: "Gap between items" },
        padding: { type: "number", description: "Padding" },
        alignItems: { type: "string", enum: ["start", "center", "end", "stretch"], description: "Align items" },
        justifyContent: { type: "string", enum: ["start", "center", "end", "space-between", "space-around"], description: "Justify content" },
      },
      required: ["nodeId"],
    },
  },
  // Grouping
  {
    name: "group_nodes",
    description: "Group multiple shapes together.",
    inputSchema: {
      type: "object",
      properties: {
        nodeIds: { type: "array", items: { type: "string" }, description: "Array of shape IDs to group" },
        name: { type: "string", description: "Group name" },
      },
      required: ["nodeIds"],
    },
  },
  {
    name: "ungroup",
    description: "Ungroup a group.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "Group ID to ungroup" },
      },
      required: ["groupId"],
    },
  },
  // Selection & Navigation
  {
    name: "get_selection",
    description: "Get currently selected shapes.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "select_nodes",
    description: "Select specific shapes.",
    inputSchema: {
      type: "object",
      properties: {
        nodeIds: { type: "array", items: { type: "string" }, description: "Array of shape IDs to select" },
      },
      required: ["nodeIds"],
    },
  },
  {
    name: "find_shapes",
    description: "Find shapes by name or type.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name to search for (partial match)" },
        type: { type: "string", description: "Shape type filter (rect, ellipse, text, board, etc.)" },
        parentId: { type: "string", description: "Search within this parent" },
      },
    },
  },
];

// ========== MCP Server ==========
const mcpServer = new Server(
  {
    name: "penpot-write-bridge",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tools/list
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tools/call
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await sendToPlugin(name, args || {});
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

// ========== SSE Server for MCP ==========
const app = express();

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Store active transports
const transports = new Map();

// SSE endpoint
app.get("/sse", async (req, res) => {
  console.error("[penpot-write-bridge] SSE connection established");

  const transport = new SSEServerTransport("/message", res);
  const sessionId = makeId();
  transports.set(sessionId, transport);

  res.on("close", () => {
    console.error("[penpot-write-bridge] SSE connection closed");
    transports.delete(sessionId);
  });

  await mcpServer.connect(transport);
});

// Message endpoint for SSE
app.post("/message", express.json(), async (req, res) => {
  // Find active transport and forward message
  for (const transport of transports.values()) {
    try {
      await transport.handlePostMessage(req, res);
      return;
    } catch (e) {
      // Try next transport
    }
  }
  res.status(400).json({ error: "No active SSE connection" });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    pluginConnected: pluginClient !== null && pluginClient.readyState === WebSocket.OPEN,
  });
});

const httpServer = createServer(app);
httpServer.listen(SSE_PORT, HOST, () => {
  console.error(`[penpot-write-bridge] MCP SSE server listening on http://${HOST}:${SSE_PORT}/sse`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.error("[penpot-write-bridge] Shutting down...");
  wss.close();
  httpServer.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[penpot-write-bridge] Shutting down...");
  wss.close();
  httpServer.close();
  process.exit(0);
});
