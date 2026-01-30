import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
// --- UI Tool definitions ---
const TOOLS = [
    {
        name: "render_button",
        description: "Render an interactive button. Returns HTML that can be displayed in the chat.",
        inputSchema: {
            type: "object",
            properties: {
                label: { type: "string", description: "Button text label" },
                variant: {
                    type: "string",
                    enum: ["primary", "secondary", "danger", "success"],
                    description: "Button style variant",
                    default: "primary"
                },
                size: {
                    type: "string",
                    enum: ["small", "medium", "large"],
                    description: "Button size",
                    default: "medium"
                },
                disabled: { type: "boolean", description: "Whether button is disabled", default: false },
                icon: { type: "string", description: "Optional icon name (e.g., 'check', 'close', 'download')" },
            },
            required: ["label"],
        },
    },
    {
        name: "render_card",
        description: "Render a styled card component with title, content, and optional actions.",
        inputSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Card title" },
                content: { type: "string", description: "Card body content (supports markdown)" },
                footer: { type: "string", description: "Optional footer text" },
                variant: {
                    type: "string",
                    enum: ["default", "info", "warning", "error", "success"],
                    description: "Card style variant",
                    default: "default"
                },
                collapsible: { type: "boolean", description: "Whether card can be collapsed", default: false },
            },
            required: ["title", "content"],
        },
    },
    {
        name: "render_table",
        description: "Render a data table with headers and rows.",
        inputSchema: {
            type: "object",
            properties: {
                headers: {
                    type: "array",
                    items: { type: "string" },
                    description: "Table column headers"
                },
                rows: {
                    type: "array",
                    items: {
                        type: "array",
                        items: { type: "string" }
                    },
                    description: "Table rows (array of arrays)"
                },
                caption: { type: "string", description: "Optional table caption" },
                striped: { type: "boolean", description: "Use striped rows", default: true },
                compact: { type: "boolean", description: "Use compact spacing", default: false },
            },
            required: ["headers", "rows"],
        },
    },
    {
        name: "render_progress",
        description: "Render a progress bar or indicator.",
        inputSchema: {
            type: "object",
            properties: {
                value: { type: "number", minimum: 0, maximum: 100, description: "Progress percentage (0-100)" },
                label: { type: "string", description: "Progress label" },
                showPercentage: { type: "boolean", description: "Show percentage text", default: true },
                variant: {
                    type: "string",
                    enum: ["default", "success", "warning", "error"],
                    description: "Progress bar color variant",
                    default: "default"
                },
                size: {
                    type: "string",
                    enum: ["small", "medium", "large"],
                    description: "Progress bar size",
                    default: "medium"
                },
            },
            required: ["value"],
        },
    },
    {
        name: "render_alert",
        description: "Render an alert/notification message.",
        inputSchema: {
            type: "object",
            properties: {
                message: { type: "string", description: "Alert message" },
                title: { type: "string", description: "Optional alert title" },
                type: {
                    type: "string",
                    enum: ["info", "success", "warning", "error"],
                    description: "Alert type",
                    default: "info"
                },
                dismissible: { type: "boolean", description: "Can be dismissed", default: false },
            },
            required: ["message"],
        },
    },
    {
        name: "render_code_block",
        description: "Render a syntax-highlighted code block.",
        inputSchema: {
            type: "object",
            properties: {
                code: { type: "string", description: "Code content" },
                language: { type: "string", description: "Programming language for syntax highlighting" },
                title: { type: "string", description: "Optional title/filename" },
                showLineNumbers: { type: "boolean", description: "Show line numbers", default: true },
                highlightLines: {
                    type: "array",
                    items: { type: "number" },
                    description: "Line numbers to highlight"
                },
            },
            required: ["code"],
        },
    },
    {
        name: "render_list",
        description: "Render a styled list (ordered or unordered).",
        inputSchema: {
            type: "object",
            properties: {
                items: {
                    type: "array",
                    items: { type: "string" },
                    description: "List items"
                },
                ordered: { type: "boolean", description: "Use ordered (numbered) list", default: false },
                title: { type: "string", description: "Optional list title" },
                icon: { type: "string", description: "Custom icon for list items (unordered only)" },
            },
            required: ["items"],
        },
    },
    {
        name: "render_badge",
        description: "Render a small badge/tag.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Badge text" },
                variant: {
                    type: "string",
                    enum: ["default", "primary", "secondary", "success", "warning", "error"],
                    description: "Badge color variant",
                    default: "default"
                },
                size: {
                    type: "string",
                    enum: ["small", "medium"],
                    description: "Badge size",
                    default: "medium"
                },
            },
            required: ["text"],
        },
    },
    {
        name: "render_divider",
        description: "Render a horizontal divider/separator.",
        inputSchema: {
            type: "object",
            properties: {
                label: { type: "string", description: "Optional label in the middle of divider" },
                variant: {
                    type: "string",
                    enum: ["solid", "dashed", "dotted"],
                    description: "Divider line style",
                    default: "solid"
                },
            },
        },
    },
    {
        name: "render_stats",
        description: "Render a statistics/metrics display.",
        inputSchema: {
            type: "object",
            properties: {
                stats: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            label: { type: "string" },
                            value: { type: "string" },
                            change: { type: "string", description: "Optional change indicator (e.g., '+5%')" },
                            trend: { type: "string", enum: ["up", "down", "neutral"] },
                        },
                        required: ["label", "value"],
                    },
                    description: "Array of stat items"
                },
                columns: { type: "number", description: "Number of columns", default: 3 },
            },
            required: ["stats"],
        },
    },
];
// --- CSS Styles for UI components (optimized for VS Code dark theme) ---
const getStyles = () => `
<style>
  :root { color-scheme: dark; }
  .mcp-ui {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #e0e0e0;
  }

  /* Buttons */
  .mcp-button {
    padding: 10px 20px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }
  .mcp-button:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.4); }
  .mcp-button.primary { background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; }
  .mcp-button.secondary { background: linear-gradient(135deg, #4b5563, #374151); color: white; }
  .mcp-button.danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; }
  .mcp-button.success { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; }
  .mcp-button.small { padding: 6px 12px; font-size: 12px; }
  .mcp-button.large { padding: 14px 28px; font-size: 16px; }
  .mcp-button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  /* Cards */
  .mcp-card {
    border: 1px solid #3a3a3a;
    border-radius: 12px;
    overflow: hidden;
    margin: 12px 0;
    background: #252525;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  .mcp-card.info { border-color: #3b82f6; border-left: 4px solid #3b82f6; }
  .mcp-card.warning { border-color: #f59e0b; border-left: 4px solid #f59e0b; }
  .mcp-card.error { border-color: #ef4444; border-left: 4px solid #ef4444; }
  .mcp-card.success { border-color: #22c55e; border-left: 4px solid #22c55e; }
  .mcp-card-header { padding: 14px 18px; font-weight: 600; border-bottom: 1px solid #3a3a3a; color: #f0f0f0; font-size: 15px; }
  .mcp-card-body { padding: 18px; color: #d0d0d0; line-height: 1.6; }
  .mcp-card-footer { padding: 12px 18px; background: #2a2a2a; border-top: 1px solid #3a3a3a; font-size: 13px; color: #909090; }

  /* Tables */
  .mcp-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  .mcp-table th, .mcp-table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #3a3a3a; }
  .mcp-table th { background: #2a2a2a; font-weight: 600; color: #f0f0f0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
  .mcp-table td { color: #d0d0d0; }
  .mcp-table.striped tr:nth-child(even) { background: #2a2a2a; }
  .mcp-table.compact th, .mcp-table.compact td { padding: 8px 10px; }
  .mcp-table caption { padding: 12px; font-weight: 600; color: #909090; text-align: left; }

  /* Progress bars */
  .mcp-progress { width: 100%; margin: 12px 0; }
  .mcp-progress-label { margin-bottom: 8px; font-size: 14px; font-weight: 500; color: #e0e0e0; }
  .mcp-progress-bar { height: 10px; background: #3a3a3a; border-radius: 5px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.3); }
  .mcp-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #60a5fa);
    transition: width 0.4s ease;
    border-radius: 5px;
  }
  .mcp-progress-fill.success { background: linear-gradient(90deg, #22c55e, #4ade80); }
  .mcp-progress-fill.warning { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
  .mcp-progress-fill.error { background: linear-gradient(90deg, #ef4444, #f87171); }
  .mcp-progress-fill.info { background: linear-gradient(90deg, #06b6d4, #22d3ee); }
  .mcp-progress.small .mcp-progress-bar { height: 6px; }
  .mcp-progress.large .mcp-progress-bar { height: 14px; }
  .mcp-progress-text { margin-top: 6px; font-size: 13px; color: #909090; }

  /* Alerts */
  .mcp-alert {
    padding: 14px 18px;
    border-radius: 10px;
    margin: 12px 0;
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .mcp-alert.info { background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.3); }
  .mcp-alert.success { background: rgba(34, 197, 94, 0.15); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.3); }
  .mcp-alert.warning { background: rgba(245, 158, 11, 0.15); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.3); }
  .mcp-alert.error { background: rgba(239, 68, 68, 0.15); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); }
  .mcp-alert-icon { font-size: 20px; }
  .mcp-alert-content strong { display: block; margin-bottom: 4px; font-size: 14px; }

  /* Code blocks */
  .mcp-code {
    background: #1a1a1a;
    color: #d4d4d4;
    padding: 16px;
    border-radius: 10px;
    overflow-x: auto;
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 13px;
    border: 1px solid #3a3a3a;
    line-height: 1.5;
  }
  .mcp-code-title {
    background: #2a2a2a;
    padding: 10px 16px;
    border-radius: 10px 10px 0 0;
    font-size: 12px;
    color: #909090;
    border: 1px solid #3a3a3a;
    border-bottom: none;
  }

  /* Badges */
  .mcp-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 12px;
    font-weight: 600;
  }
  .mcp-badge.default { background: #3a3a3a; color: #d0d0d0; }
  .mcp-badge.primary { background: rgba(59, 130, 246, 0.2); color: #93c5fd; }
  .mcp-badge.secondary { background: rgba(107, 114, 128, 0.2); color: #9ca3af; }
  .mcp-badge.success { background: rgba(34, 197, 94, 0.2); color: #86efac; }
  .mcp-badge.warning { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
  .mcp-badge.error { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }

  /* Dividers */
  .mcp-divider { display: flex; align-items: center; margin: 20px 0; }
  .mcp-divider-line { flex: 1; height: 1px; background: #3a3a3a; }
  .mcp-divider-line.dashed { border-top: 1px dashed #3a3a3a; background: none; }
  .mcp-divider-line.dotted { border-top: 1px dotted #3a3a3a; background: none; }
  .mcp-divider-label { padding: 0 16px; color: #707070; font-size: 13px; font-weight: 500; }

  /* Stats */
  .mcp-stats { display: grid; gap: 14px; margin: 12px 0; }
  .mcp-stat {
    padding: 18px;
    background: #252525;
    border-radius: 10px;
    border: 1px solid #3a3a3a;
  }
  .mcp-stat-label { font-size: 13px; color: #909090; text-transform: uppercase; letter-spacing: 0.5px; }
  .mcp-stat-value { font-size: 28px; font-weight: 700; margin: 8px 0; color: #f0f0f0; }
  .mcp-stat-change { font-size: 13px; font-weight: 500; }
  .mcp-stat-change.up { color: #4ade80; }
  .mcp-stat-change.down { color: #f87171; }
  .mcp-stat-change.neutral { color: #909090; }

  /* Lists */
  .mcp-list { margin: 12px 0; padding: 0; }
  .mcp-list-title { font-weight: 600; margin-bottom: 10px; color: #f0f0f0; }
  .mcp-list li { padding: 8px 0; color: #d0d0d0; border-bottom: 1px solid #3a3a3a; }
  .mcp-list li:last-child { border-bottom: none; }
</style>
`;
// --- Render functions ---
function renderButton(args) {
    const { label, variant = "primary", size = "medium", disabled = false, icon } = args;
    const iconHtml = icon ? `<span class="icon">${icon}</span>` : "";
    return `
    <div class="mcp-ui">
      ${getStyles()}
      <button class="mcp-button ${variant} ${size}" ${disabled ? "disabled" : ""}>
        ${iconHtml}${label}
      </button>
    </div>
  `;
}
function renderCard(args) {
    const { title, content, footer, variant = "default" } = args;
    return `
    <div class="mcp-ui">
      ${getStyles()}
      <div class="mcp-card ${variant}">
        <div class="mcp-card-header">${title}</div>
        <div class="mcp-card-body">${content}</div>
        ${footer ? `<div class="mcp-card-footer">${footer}</div>` : ""}
      </div>
    </div>
  `;
}
function renderTable(args) {
    const { headers, rows, caption, striped = true, compact = false } = args;
    const headerHtml = headers.map((h) => `<th>${h}</th>`).join("");
    const rowsHtml = rows.map((row) => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("");
    return `
    <div class="mcp-ui">
      ${getStyles()}
      <table class="mcp-table ${striped ? "striped" : ""} ${compact ? "compact" : ""}">
        ${caption ? `<caption>${caption}</caption>` : ""}
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}
function renderProgress(args) {
    const { value, label, showPercentage = true, variant = "default", size = "medium" } = args;
    return `
    <div class="mcp-ui">
      ${getStyles()}
      <div class="mcp-progress ${size}">
        ${label ? `<div class="mcp-progress-label">${label}</div>` : ""}
        <div class="mcp-progress-bar">
          <div class="mcp-progress-fill ${variant}" style="width: ${value}%"></div>
        </div>
        ${showPercentage ? `<div class="mcp-progress-text">${value}%</div>` : ""}
      </div>
    </div>
  `;
}
function renderAlert(args) {
    const { message, title, type = "info" } = args;
    const icons = {
        info: "ℹ️",
        success: "✅",
        warning: "⚠️",
        error: "❌"
    };
    return `
    <div class="mcp-ui">
      ${getStyles()}
      <div class="mcp-alert ${type}">
        <span>${icons[type]}</span>
        <div>
          ${title ? `<strong>${title}</strong><br>` : ""}
          ${message}
        </div>
      </div>
    </div>
  `;
}
function renderCodeBlock(args) {
    const { code, language, title, showLineNumbers = true } = args;
    const lines = code.split("\n");
    const codeHtml = showLineNumbers
        ? lines.map((line, i) => `<span style="color:#6b7280;margin-right:16px;">${i + 1}</span>${escapeHtml(line)}`).join("\n")
        : escapeHtml(code);
    return `
    <div class="mcp-ui">
      ${getStyles()}
      ${title ? `<div class="mcp-code-title">${title}${language ? ` (${language})` : ""}</div>` : ""}
      <pre class="mcp-code" ${!title ? 'style="border-radius:8px;"' : 'style="border-radius:0 0 8px 8px;"'}><code>${codeHtml}</code></pre>
    </div>
  `;
}
function renderList(args) {
    const { items, ordered = false, title, icon } = args;
    // Validate items is an array
    if (!items || !Array.isArray(items)) {
        return `
      <div class="mcp-ui">
        ${getStyles()}
        <div style="color: #ff6b6b; padding: 8px;">Error: items must be an array</div>
      </div>
    `;
    }
    const tag = ordered ? "ol" : "ul";
    const itemsHtml = items.map((item) => `<li>${icon && !ordered ? `${icon} ` : ""}${item}</li>`).join("");
    return `
    <div class="mcp-ui">
      ${getStyles()}
      ${title ? `<div style="font-weight: 600; margin-bottom: 8px;">${title}</div>` : ""}
      <${tag} style="margin: 0; padding-left: 24px;">${itemsHtml}</${tag}>
    </div>
  `;
}
function renderBadge(args) {
    const { text, variant = "default", size = "medium" } = args;
    return `
    <div class="mcp-ui">
      ${getStyles()}
      <span class="mcp-badge ${variant} ${size}">${text}</span>
    </div>
  `;
}
function renderDivider(args) {
    const { label, variant = "solid" } = args;
    return `
    <div class="mcp-ui">
      ${getStyles()}
      <div class="mcp-divider">
        <div class="mcp-divider-line ${variant}"></div>
        ${label ? `<span class="mcp-divider-label">${label}</span><div class="mcp-divider-line ${variant}"></div>` : ""}
      </div>
    </div>
  `;
}
function renderStats(args) {
    const { stats, columns = 3 } = args;
    const statsHtml = stats.map((stat) => {
        const trendIcon = stat.trend === "up" ? "↑" : stat.trend === "down" ? "↓" : "";
        return `
      <div class="mcp-stat">
        <div class="mcp-stat-label">${stat.label}</div>
        <div class="mcp-stat-value">${stat.value}</div>
        ${stat.change ? `<div class="mcp-stat-change ${stat.trend || ""}">${trendIcon} ${stat.change}</div>` : ""}
      </div>
    `;
    }).join("");
    return `
    <div class="mcp-ui">
      ${getStyles()}
      <div class="mcp-stats" style="grid-template-columns: repeat(${columns}, 1fr);">
        ${statsHtml}
      </div>
    </div>
  `;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
// --- MCP Server ---
const server = new Server({
    name: "mcp-ui-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Handle tools/list
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
// Handle tools/call
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let html = "";
        switch (name) {
            case "render_button":
                html = renderButton(args || {});
                break;
            case "render_card":
                html = renderCard(args || {});
                break;
            case "render_table":
                html = renderTable(args || {});
                break;
            case "render_progress":
                html = renderProgress(args || {});
                break;
            case "render_alert":
                html = renderAlert(args || {});
                break;
            case "render_code_block":
                html = renderCodeBlock(args || {});
                break;
            case "render_list":
                html = renderList(args || {});
                break;
            case "render_badge":
                html = renderBadge(args || {});
                break;
            case "render_divider":
                html = renderDivider(args || {});
                break;
            case "render_stats":
                html = renderStats(args || {});
                break;
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
        return {
            content: [{ type: "text", text: html }],
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true,
        };
    }
});
// --- Graceful shutdown ---
async function gracefulShutdown(signal) {
    console.error(`[mcp-ui] Received ${signal}, shutting down...`);
    try {
        await server.close();
    }
    catch (e) {
        console.error("[mcp-ui] Error closing server:", e);
    }
    process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp-ui] MCP-UI Server started");
