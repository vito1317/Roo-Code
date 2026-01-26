/**
 * Parallel UI Tasks Tool
 *
 * Enables multiple AI agents to draw UI elements in Figma simultaneously.
 * Each task is assigned to a separate AI agent that works independently.
 */
import * as vscode from "vscode";
import { formatResponse } from "../prompts/responses";
import { BaseTool } from "./BaseTool";
import { getParallelUIService, } from "../../services/figma/ParallelUIService";
/**
 * Standard calculator layout mapping
 * Maps button text/id to [row, column] position
 * Row 0 = function buttons (C/AC, ⌫, %, ÷)
 * Row 1-3 = number pad (7-8-9, 4-5-6, 1-2-3) with operators on right
 * Row 4 = bottom row (0 wide, ., =)
 *
 * Note: C and AC are alternatives - only one should exist in a calculator.
 * If both exist, C goes to col 0, AC goes to col 1 (pushing ⌫ to fallback)
 */
const CALCULATOR_LAYOUT = {
    // Function row (row 0) - C/AC at col 0, ⌫ at col 1, % at col 2, ÷ at col 3
    C: { row: 0, col: 0 },
    CE: { row: 0, col: 0 }, // CE is same as C
    CLR: { row: 0, col: 0 }, // CLR is same as C
    AC: { row: 0, col: 1 }, // AC gets its own column if C exists
    "⌫": { row: 0, col: 2 },
    DEL: { row: 0, col: 2 },
    "←": { row: 0, col: 2 }, // Backspace moves to col 2
    "±": { row: 0, col: 2 },
    "+/-": { row: 0, col: 2 }, // ± alternative position
    "%": { row: 0, col: 2 }, // % shares position with ⌫ (usually only one exists)
    "÷": { row: 0, col: 3 },
    "/": { row: 0, col: 3 },
    // Numbers row 1 (row 1): 7, 8, 9, ×
    "7": { row: 1, col: 0 },
    "8": { row: 1, col: 1 },
    "9": { row: 1, col: 2 },
    "×": { row: 1, col: 3 },
    "*": { row: 1, col: 3 },
    x: { row: 1, col: 3 },
    X: { row: 1, col: 3 },
    // Numbers row 2 (row 2): 4, 5, 6, -
    "4": { row: 2, col: 0 },
    "5": { row: 2, col: 1 },
    "6": { row: 2, col: 2 },
    "-": { row: 2, col: 3 },
    "−": { row: 2, col: 3 },
    // Numbers row 3 (row 3): 1, 2, 3, +
    "1": { row: 3, col: 0 },
    "2": { row: 3, col: 1 },
    "3": { row: 3, col: 2 },
    "+": { row: 3, col: 3 },
    // Bottom row (row 4): 0 (wide), ., =
    "0": { row: 4, col: 0, colSpan: 2 },
    ".": { row: 4, col: 2 },
    "=": { row: 4, col: 3 },
};
/**
 * Extract button text from task for layout calculation
 * Returns the button label (0-9, +, -, ×, ÷, =, C, etc.)
 */
function extractButtonTextFromTask(task) {
    // Priority 1: designSpec.text (most reliable)
    if (task.designSpec?.text !== undefined && task.designSpec.text !== null) {
        const text = String(task.designSpec.text).trim();
        if (text.length > 0) {
            console.log(`[extractButtonText] Task "${task.id}" -> text from designSpec: "${text}"`);
            return text;
        }
    }
    const id = task.id;
    // Priority 2: Check if ID itself is the button label (e.g., "0", "1", "+")
    // Handle single character IDs including "0"
    if (id.length === 1) {
        console.log(`[extractButtonText] Task "${task.id}" -> single char ID: "${id}"`);
        return id;
    }
    // Priority 3: Short IDs (2 chars) without separators
    if (id.length === 2 && !id.includes("-") && !id.includes("_")) {
        console.log(`[extractButtonText] Task "${task.id}" -> short ID: "${id}"`);
        return id;
    }
    // Priority 4: Extract from ID patterns like "btn-7", "button-plus", "num-0"
    const idPatterns = [
        /^btn[-_]?(.+)$/i,
        /^button[-_]?(.+)$/i,
        /^num[-_]?(.+)$/i,
        /^key[-_]?(.+)$/i,
        /^digit[-_]?(.+)$/i,
    ];
    for (const pattern of idPatterns) {
        const match = id.match(pattern);
        if (match) {
            const extracted = match[1];
            // Map common ID patterns to symbols
            const idMappings = {
                "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
                "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
                zero: "0", one: "1", two: "2", three: "3", four: "4",
                five: "5", six: "6", seven: "7", eight: "8", nine: "9",
                plus: "+", add: "+",
                minus: "-", subtract: "-", sub: "-",
                multiply: "×", times: "×", mul: "×", x: "×",
                divide: "÷", div: "÷", slash: "÷",
                equals: "=", equal: "=", eq: "=",
                clear: "C", c: "C", ac: "AC", allclear: "AC",
                delete: "⌫", del: "⌫", backspace: "⌫", back: "⌫",
                dot: ".", decimal: ".", period: ".", point: ".",
                percent: "%", pct: "%",
                plusminus: "±", negate: "±", toggle: "±",
            };
            const lowerExtracted = extracted.toLowerCase();
            if (idMappings[lowerExtracted]) {
                console.log(`[extractButtonText] Task "${task.id}" -> mapped "${extracted}" to "${idMappings[lowerExtracted]}"`);
                return idMappings[lowerExtracted];
            }
            // If it's a single digit string
            if (/^\d$/.test(extracted)) {
                console.log(`[extractButtonText] Task "${task.id}" -> digit from ID: "${extracted}"`);
                return extracted;
            }
        }
    }
    // Priority 5: Check description for number keywords
    const desc = task.description.toLowerCase();
    if (desc.includes("數字") || desc.includes("number") || desc.includes("digit")) {
        const numMatch = desc.match(/[0-9]/);
        if (numMatch) {
            console.log(`[extractButtonText] Task "${task.id}" -> digit from description: "${numMatch[0]}"`);
            return numMatch[0];
        }
    }
    // Priority 6: Check description for operator keywords
    const descMappings = [
        [/清除|clear|reset/i, "C"],
        [/加|plus|add|\+/i, "+"],
        [/減|minus|subtract|-/i, "-"],
        [/乘|multiply|times|×/i, "×"],
        [/除|divide|÷/i, "÷"],
        [/等於|equals|=/i, "="],
        [/小數點|dot|decimal|\./i, "."],
        [/百分比|percent|%/i, "%"],
    ];
    for (const [pattern, symbol] of descMappings) {
        if (pattern.test(desc)) {
            console.log(`[extractButtonText] Task "${task.id}" -> symbol from description pattern: "${symbol}"`);
            return symbol;
        }
    }
    console.log(`[extractButtonText] Task "${task.id}" -> UNRECOGNIZED, returning "?"`);
    return "?";
}
/**
 * Calculate positions for calculator layout
 * Returns a map of task ID to position
 */
function calculateCalculatorLayout(tasks, startX, startY, cellWidth, cellHeight, gap) {
    const positions = new Map();
    const usedPositions = new Set();
    // First pass: assign known layout positions
    for (const task of tasks) {
        const buttonText = extractButtonTextFromTask(task);
        const layoutInfo = CALCULATOR_LAYOUT[buttonText];
        if (layoutInfo) {
            const posKey = `${layoutInfo.row}-${layoutInfo.col}`;
            if (!usedPositions.has(posKey)) {
                const x = startX + layoutInfo.col * (cellWidth + gap);
                const y = startY + layoutInfo.row * (cellHeight + gap);
                const width = layoutInfo.colSpan
                    ? cellWidth * layoutInfo.colSpan + gap * (layoutInfo.colSpan - 1)
                    : undefined;
                positions.set(task.id, { x, y, width });
                usedPositions.add(posKey);
                if (layoutInfo.colSpan) {
                    // Mark additional columns as used
                    for (let c = 1; c < layoutInfo.colSpan; c++) {
                        usedPositions.add(`${layoutInfo.row}-${layoutInfo.col + c}`);
                    }
                }
                console.log(`[CalcLayout] Task "${task.id}" (text: "${buttonText}") -> row ${layoutInfo.row}, col ${layoutInfo.col}, pos (${x}, ${y})`);
            }
        }
    }
    // Second pass: assign remaining tasks to unused grid positions
    let nextRow = 0;
    let nextCol = 0;
    const maxCols = 4;
    for (const task of tasks) {
        if (positions.has(task.id))
            continue;
        // Find next available position
        while (usedPositions.has(`${nextRow}-${nextCol}`)) {
            nextCol++;
            if (nextCol >= maxCols) {
                nextCol = 0;
                nextRow++;
            }
        }
        const x = startX + nextCol * (cellWidth + gap);
        const y = startY + nextRow * (cellHeight + gap);
        positions.set(task.id, { x, y });
        usedPositions.add(`${nextRow}-${nextCol}`);
        const buttonText = extractButtonTextFromTask(task);
        console.log(`[CalcLayout] Task "${task.id}" (text: "${buttonText}") -> FALLBACK row ${nextRow}, col ${nextCol}, pos (${x}, ${y})`);
        nextCol++;
        if (nextCol >= maxCols) {
            nextCol = 0;
            nextRow++;
        }
    }
    return positions;
}
export class ParallelUITasksTool extends BaseTool {
    name = "parallel_ui_tasks";
    parseLegacy(params) {
        return {
            tasks: params.tasks || "[]",
            containerFrame: params.containerFrame,
        };
    }
    async execute(params, task, callbacks) {
        const { askApproval, handleError, pushToolResult } = callbacks;
        try {
            // Validate tasks parameter
            if (!params.tasks) {
                task.consecutiveMistakeCount++;
                task.recordToolError("parallel_ui_tasks");
                task.didToolFailInCurrentTurn = true;
                pushToolResult(await task.sayAndCreateMissingParamError("parallel_ui_tasks", "tasks"));
                return;
            }
            // Parse tasks JSON
            let parsedTasks;
            try {
                parsedTasks = typeof params.tasks === "string" ? JSON.parse(params.tasks) : params.tasks;
            }
            catch (error) {
                task.consecutiveMistakeCount++;
                task.recordToolError("parallel_ui_tasks");
                task.didToolFailInCurrentTurn = true;
                pushToolResult(formatResponse.toolError("Invalid tasks format. Expected a JSON array of task definitions.\n\n" +
                    "Each task should have:\n" +
                    "- id: string (unique identifier, e.g. 'btn-1')\n" +
                    "- description: string (what UI to create, e.g. 'Calculator button 7')\n" +
                    "- position: { x: number, y: number } (optional, auto-assigned if not provided)\n" +
                    "- designSpec: (optional) {\n" +
                    "    width: number (default 350px),\n" +
                    "    height: number (default 250px),\n" +
                    "    colors: [background, text] (e.g. ['#3498db', '#FFFFFF']),\n" +
                    "    cornerRadius: number (default 8, use width/2 for circular buttons),\n" +
                    "    fontSize: number (default 16),\n" +
                    "    text: string (explicit text to display)\n" +
                    "  }\n\n" +
                    "Example for circular buttons (cornerRadius = width/2):\n" +
                    "[\n" +
                    '  { "id": "btn-dot", "description": "Circular button", "designSpec": { "text": ".", "width": 60, "height": 60, "cornerRadius": 30, "colors": ["#505050", "#FFFFFF"] } }\n' +
                    "]\n\n" +
                    "Example for 9 calculator buttons:\n" +
                    "[\n" +
                    '  { "id": "btn-7", "description": "Button 7", "designSpec": { "text": "7", "colors": ["#333333", "#FFFFFF"] } },\n' +
                    '  { "id": "btn-8", "description": "Button 8", "designSpec": { "text": "8", "colors": ["#333333", "#FFFFFF"] } },\n' +
                    "  ...\n" +
                    "]"));
                return;
            }
            // Validate tasks array
            if (!Array.isArray(parsedTasks) || parsedTasks.length === 0) {
                task.consecutiveMistakeCount++;
                task.recordToolError("parallel_ui_tasks");
                task.didToolFailInCurrentTurn = true;
                pushToolResult(formatResponse.toolError("Tasks must be a non-empty array"));
                return;
            }
            // Validate each task and coerce string numbers to actual numbers
            for (const t of parsedTasks) {
                if (!t.id || !t.description) {
                    task.consecutiveMistakeCount++;
                    task.recordToolError("parallel_ui_tasks");
                    task.didToolFailInCurrentTurn = true;
                    pushToolResult(formatResponse.toolError(`Each task must have 'id' and 'description'. Invalid task: ${JSON.stringify(t)}`));
                    return;
                }
                // Coerce string numbers to actual numbers in position
                if (t.position) {
                    if (typeof t.position.x === "string")
                        t.position.x = parseFloat(t.position.x) || 0;
                    if (typeof t.position.y === "string")
                        t.position.y = parseFloat(t.position.y) || 0;
                }
                // Coerce string numbers to actual numbers in designSpec
                if (t.designSpec) {
                    if (typeof t.designSpec.width === "string")
                        t.designSpec.width = parseFloat(t.designSpec.width) || undefined;
                    if (typeof t.designSpec.height === "string")
                        t.designSpec.height = parseFloat(t.designSpec.height) || undefined;
                    if (typeof t.designSpec.cornerRadius === "string")
                        t.designSpec.cornerRadius = parseFloat(t.designSpec.cornerRadius) || undefined;
                    if (typeof t.designSpec.fontSize === "string")
                        t.designSpec.fontSize = parseFloat(t.designSpec.fontSize) || undefined;
                }
            }
            task.consecutiveMistakeCount = 0;
            // ========== DYNAMIC LAYOUT CALCULATION ==========
            // Calculate layout based on actual task specifications, not hardcoded values
            const taskCount = parsedTasks.length;
            const hasContainerFrame = !!params.containerFrame;
            // Analyze tasks to determine element sizes
            const taskWidths = parsedTasks.map((t) => t.designSpec?.width || 0).filter((w) => w > 0);
            const taskHeights = parsedTasks.map((t) => t.designSpec?.height || 0).filter((h) => h > 0);
            // Calculate average element size from task specs, or use sensible defaults
            const avgTaskWidth = taskWidths.length > 0 ? Math.round(taskWidths.reduce((a, b) => a + b, 0) / taskWidths.length) : 80; // Default for unspecified
            const avgTaskHeight = taskHeights.length > 0 ? Math.round(taskHeights.reduce((a, b) => a + b, 0) / taskHeights.length) : 60; // Default for unspecified
            // Determine if elements are "small" based on actual specs
            const isSmallElements = avgTaskWidth <= 150 && avgTaskHeight <= 100;
            // Frame padding and gap
            const FRAME_PADDING = 10;
            const GAP = 10;
            // Cell dimensions: element size + gap
            const CELL_WIDTH = avgTaskWidth + GAP;
            const CELL_HEIGHT = avgTaskHeight + GAP;
            // Calculate optimal grid columns based on task count AND available width
            // Assume a reasonable frame width (can be passed as parameter in future)
            // Common frame widths: mobile (320-414), tablet (768), desktop (1024+)
            // For calculators and similar, use a compact width
            const estimatedFrameWidth = params.frameWidth ? parseInt(params.frameWidth, 10) : 320;
            const availableWidth = estimatedFrameWidth - FRAME_PADDING * 2;
            // Calculate max columns that fit in the frame width
            const maxColumnsByWidth = Math.floor(availableWidth / CELL_WIDTH);
            // Also consider element count for optimal layout
            const maxColumnsByCount = isSmallElements ? 6 : 4;
            const optimalColumns = Math.min(Math.ceil(Math.sqrt(taskCount)), maxColumnsByCount, Math.max(1, maxColumnsByWidth));
            const GRID_COLUMNS = optimalColumns;
            // IMPORTANT: Adjust button sizes if they don't fit within the container
            // This prevents buttons from exceeding frame boundaries
            const totalWidthNeeded = GRID_COLUMNS * avgTaskWidth + (GRID_COLUMNS - 1) * GAP;
            let adjustedTaskWidth = avgTaskWidth;
            if (totalWidthNeeded > availableWidth && GRID_COLUMNS > 0) {
                // Calculate the maximum width per button that fits
                adjustedTaskWidth = Math.floor((availableWidth - (GRID_COLUMNS - 1) * GAP) / GRID_COLUMNS);
                console.log(`[ParallelUI] Button width adjusted: ${avgTaskWidth}px -> ${adjustedTaskWidth}px to fit ${GRID_COLUMNS} columns in ${availableWidth}px`);
                // Update all task specs with adjusted width
                for (const t of parsedTasks) {
                    if (t.designSpec) {
                        t.designSpec.width = adjustedTaskWidth;
                    }
                }
            }
            // Start position: relative to frame (0,0) with padding, or absolute for no frame
            const START_X = hasContainerFrame ? FRAME_PADDING : 20;
            const START_Y = hasContainerFrame ? FRAME_PADDING : 20;
            // Recalculate cell width with adjusted task width
            const ADJUSTED_CELL_WIDTH = adjustedTaskWidth + GAP;
            // Calculate total grid size for logging
            const gridWidth = GRID_COLUMNS * ADJUSTED_CELL_WIDTH + FRAME_PADDING;
            const gridHeight = Math.ceil(taskCount / GRID_COLUMNS) * CELL_HEIGHT + FRAME_PADDING;
            console.log(`[ParallelUI] Dynamic layout: ${GRID_COLUMNS} columns (max by width: ${maxColumnsByWidth}), cell=${ADJUSTED_CELL_WIDTH}x${CELL_HEIGHT}px, element=${adjustedTaskWidth}x${avgTaskHeight}px, grid=${gridWidth}x${gridHeight}px, frameWidth=${estimatedFrameWidth}, tasks=${taskCount}`);
            // Show approval message with position and color info
            const taskSummary = parsedTasks
                .map((t, i) => {
                const pos = t.position || {
                    x: START_X + (i % GRID_COLUMNS) * ADJUSTED_CELL_WIDTH,
                    y: START_Y + Math.floor(i / GRID_COLUMNS) * CELL_HEIGHT,
                };
                const colorInfo = t.designSpec?.colors?.[0] ? ` 🎨 ${t.designSpec.colors[0]}` : "";
                const textInfo = t.designSpec?.text ? ` "${t.designSpec.text}"` : "";
                return `${i + 1}. [${t.id}] ${t.description}${textInfo}${colorInfo} @ (${pos.x}, ${pos.y})`;
            })
                .join("\n");
            const toolMessage = JSON.stringify({
                tool: "parallelUITasks",
                taskCount: parsedTasks.length,
                tasks: taskSummary,
            });
            await task.say("text", `🎨 Starting ${parsedTasks.length} parallel UI drawing tasks:\n${taskSummary}\n\n📍 Grid layout: ${GRID_COLUMNS} columns, ${ADJUSTED_CELL_WIDTH}x${CELL_HEIGHT}px cells`);
            const didApprove = await askApproval("tool", toolMessage);
            if (!didApprove) {
                return;
            }
            // Get the parallel UI service
            const service = getParallelUIService();
            // Configure the service with current API settings
            const provider = task.providerRef.deref();
            if (!provider) {
                pushToolResult(formatResponse.toolError("Provider reference lost"));
                return;
            }
            const state = await provider.getState();
            if (!state) {
                pushToolResult(formatResponse.toolError("Could not get provider state"));
                return;
            }
            // Get McpHub for Figma tool calls
            const mcpHub = provider.getMcpHub?.();
            service.configure(state.apiConfiguration, provider.context?.extensionPath || "", mcpHub, {
                talkToFigmaEnabled: state.talkToFigmaEnabled ?? true,
                figmaWriteEnabled: state.figmaWriteEnabled ?? false,
            });
            // Determine which Figma server to use based on user settings
            const talkToFigmaEnabled = state.talkToFigmaEnabled ?? true; // Default true
            const figmaWriteEnabled = state.figmaWriteEnabled ?? false; // Default false
            let figmaServerName = "TalkToFigma";
            if (mcpHub) {
                const servers = mcpHub.getServers();
                const talkToFigmaConnected = servers.find((s) => s.name === "TalkToFigma" && s.status === "connected");
                const figmaWriteConnected = servers.find((s) => s.name === "figma-write" && s.status === "connected");
                // Use settings to determine preferred server
                if (talkToFigmaEnabled && talkToFigmaConnected) {
                    figmaServerName = "TalkToFigma";
                }
                else if (figmaWriteEnabled && figmaWriteConnected) {
                    figmaServerName = "figma-write";
                }
                else if (talkToFigmaConnected) {
                    // Fallback: use TalkToFigma if connected
                    figmaServerName = "TalkToFigma";
                }
                else if (figmaWriteConnected) {
                    // Fallback: use figma-write if connected
                    figmaServerName = "figma-write";
                }
            }
            console.log(`[ParallelUITasksTool] Using Figma server: ${figmaServerName} (settings: talkToFigma=${talkToFigmaEnabled}, figmaWrite=${figmaWriteEnabled})`);
            // Coerce argument types to numbers where needed
            const coerceArgumentTypes = (tool, args) => {
                const result = { ...args };
                const numericParams = {
                    create_rectangle: ["width", "height", "x", "y", "cornerRadius", "radius", "opacity"],
                    create_frame: ["width", "height", "x", "y"],
                    create_text: ["x", "y", "fontSize"],
                    add_text: ["x", "y", "fontSize"],
                    move_node: ["x", "y"],
                    set_position: ["x", "y"],
                    set_fill_color: ["opacity", "r", "g", "b"],
                    set_fill: ["opacity", "r", "g", "b"],
                    set_text_color: ["opacity", "r", "g", "b"],
                };
                // Handle set_fill_color, set_fill, set_text_color - extract r, g, b from color
                if (tool === "set_fill_color" || tool === "set_fill" || tool === "set_text_color") {
                    // If color object is passed instead of r, g, b separately
                    if (result.color && typeof result.color === "object") {
                        const colorObj = result.color;
                        if (colorObj.r !== undefined)
                            result.r = colorObj.r;
                        if (colorObj.g !== undefined)
                            result.g = colorObj.g;
                        if (colorObj.b !== undefined)
                            result.b = colorObj.b;
                        delete result.color;
                        console.log(`[ParallelUITasksTool] Extracted r, g, b from color object:`, {
                            r: result.r,
                            g: result.g,
                            b: result.b,
                        });
                    }
                    // If color is a string (hex or JSON), convert it
                    if (result.color && typeof result.color === "string") {
                        const str = result.color.trim();
                        let rgb = null;
                        // Try parsing as JSON first
                        if (str.startsWith("{")) {
                            try {
                                const parsed = JSON.parse(str);
                                if (typeof parsed.r === "number" &&
                                    typeof parsed.g === "number" &&
                                    typeof parsed.b === "number") {
                                    rgb = { r: parsed.r, g: parsed.g, b: parsed.b };
                                }
                            }
                            catch {
                                /* not JSON */
                            }
                        }
                        // Try parsing as hex color
                        if (!rgb) {
                            const cleanHex = str.replace(/^#/, "");
                            if (/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
                                rgb = {
                                    r: parseInt(cleanHex.substring(0, 2), 16) / 255,
                                    g: parseInt(cleanHex.substring(2, 4), 16) / 255,
                                    b: parseInt(cleanHex.substring(4, 6), 16) / 255,
                                };
                            }
                        }
                        if (rgb) {
                            result.r = rgb.r;
                            result.g = rgb.g;
                            result.b = rgb.b;
                            delete result.color;
                            console.log(`[ParallelUITasksTool] Converted color string to r, g, b:`, rgb);
                        }
                    }
                }
                // Handle get_nodes_info - nodeIds should be an array
                if (tool === "get_nodes_info") {
                    if (typeof result.nodeIds === "string") {
                        const str = result.nodeIds.trim();
                        if (str.startsWith("[")) {
                            try {
                                result.nodeIds = JSON.parse(str);
                                console.log(`[ParallelUITasksTool] Parsed nodeIds from JSON string:`, result.nodeIds);
                            }
                            catch {
                                result.nodeIds = str.split(",").map((s) => s.trim());
                            }
                        }
                        else {
                            result.nodeIds = str.split(",").map((s) => s.trim());
                        }
                    }
                }
                // Handle get_node_info - check alternative parameter names
                if (tool === "get_node_info") {
                    if (result.nodeId === undefined) {
                        if (result.id) {
                            result.nodeId = result.id;
                            delete result.id;
                        }
                        else if (result.node_id) {
                            result.nodeId = result.node_id;
                            delete result.node_id;
                        }
                    }
                }
                const paramsToCoerce = numericParams[tool] || [];
                for (const param of paramsToCoerce) {
                    if (result[param] !== undefined && typeof result[param] === "string") {
                        const numValue = parseFloat(result[param]);
                        if (!isNaN(numValue)) {
                            result[param] = numValue;
                            console.log(`[ParallelUITasksTool] Coerced ${param}: "${args[param]}" -> ${numValue}`);
                        }
                    }
                }
                return result;
            };
            // Helper to call Figma tools with server-appropriate mapping
            const callFigmaTool = async (toolName, args) => {
                if (!mcpHub)
                    throw new Error("McpHub not available");
                let mappedName = toolName;
                let mappedArgs = { ...args };
                if (figmaServerName === "TalkToFigma") {
                    // Map tool names for TalkToFigma
                    const toolMapping = {
                        get_file_url: "get_document_info",
                        add_text: "create_text",
                        set_position: "move_node",
                        set_fill: "set_fill_color",
                        set_text_color: "set_fill_color",
                    };
                    mappedName = toolMapping[toolName] || toolName;
                    // TalkToFigma uses 'parentId' instead of 'parent' for specifying parent frame
                    if (args.parent && !args.parentId) {
                        mappedArgs = { ...mappedArgs, parentId: args.parent };
                        delete mappedArgs.parent;
                        console.log(`[ParallelUITasksTool] Mapped 'parent' to 'parentId': ${args.parent}`);
                    }
                    // Map parameters
                    // Note: TalkToFigma's create_text uses 'text' parameter (same as add_text)
                    // No parameter renaming needed for text
                    if ((toolName === "set_fill" || toolName === "set_text_color") && args.hex) {
                        mappedArgs = { ...mappedArgs, color: args.hex };
                        delete mappedArgs.hex;
                    }
                    if (toolName === "create_rectangle") {
                        // TalkToFigma uses 'color' instead of 'hex', 'radius' instead of 'cornerRadius'
                        if (args.hex && !args.color) {
                            mappedArgs = { ...mappedArgs, color: args.hex };
                            delete mappedArgs.hex;
                        }
                        if (args.cornerRadius !== undefined && args.radius === undefined) {
                            mappedArgs = { ...mappedArgs, radius: args.cornerRadius };
                            delete mappedArgs.cornerRadius;
                        }
                    }
                    // Smart color conversion - handles hex strings, JSON strings, and RGB objects
                    const toRgbObject = (value) => {
                        // Already an object with r, g, b
                        if (typeof value === "object" && value !== null) {
                            const obj = value;
                            if (typeof obj.r === "number" && typeof obj.g === "number" && typeof obj.b === "number") {
                                return { r: obj.r, g: obj.g, b: obj.b };
                            }
                        }
                        // String value - could be hex or JSON
                        if (typeof value === "string") {
                            const str = value.trim();
                            // Try parsing as JSON first
                            if (str.startsWith("{")) {
                                try {
                                    const parsed = JSON.parse(str);
                                    if (typeof parsed.r === "number" &&
                                        typeof parsed.g === "number" &&
                                        typeof parsed.b === "number") {
                                        return { r: parsed.r, g: parsed.g, b: parsed.b };
                                    }
                                }
                                catch {
                                    /* not JSON */
                                }
                            }
                            // Try parsing as hex color
                            const cleanHex = str.replace(/^#/, "");
                            if (/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
                                return {
                                    r: parseInt(cleanHex.substring(0, 2), 16) / 255,
                                    g: parseInt(cleanHex.substring(2, 4), 16) / 255,
                                    b: parseInt(cleanHex.substring(4, 6), 16) / 255,
                                };
                            }
                        }
                        return null;
                    };
                    if (toolName === "create_frame") {
                        // TalkToFigma's create_frame expects fillColor as RGB object
                        if (args.fillColor) {
                            const rgb = toRgbObject(args.fillColor);
                            if (rgb)
                                mappedArgs = { ...mappedArgs, fillColor: rgb };
                        }
                        if (args.color) {
                            const rgb = toRgbObject(args.color);
                            if (rgb) {
                                mappedArgs = { ...mappedArgs, fillColor: rgb };
                                delete mappedArgs.color;
                            }
                        }
                        if (args.hex) {
                            const rgb = toRgbObject(args.hex);
                            if (rgb) {
                                mappedArgs = { ...mappedArgs, fillColor: rgb };
                                delete mappedArgs.hex;
                            }
                        }
                    }
                    if (toolName === "create_text") {
                        // TalkToFigma's create_text expects fontColor as RGB object
                        if (args.fontColor) {
                            const rgb = toRgbObject(args.fontColor);
                            if (rgb)
                                mappedArgs = { ...mappedArgs, fontColor: rgb };
                        }
                        if (args.color) {
                            const rgb = toRgbObject(args.color);
                            if (rgb) {
                                mappedArgs = { ...mappedArgs, fontColor: rgb };
                                delete mappedArgs.color;
                            }
                        }
                    }
                }
                // Coerce string numbers to actual numbers
                mappedArgs = coerceArgumentTypes(mappedName, mappedArgs);
                console.log(`[ParallelUITasksTool] Calling ${figmaServerName}.${mappedName} with args:`, JSON.stringify(mappedArgs));
                return mcpHub.callTool(figmaServerName, mappedName, mappedArgs);
            };
            // Open Figma for VS Code panel BEFORE starting - so user can see real-time updates
            try {
                // Try to open Figma for VS Code extension panel
                await vscode.commands.executeCommand("figma.showSidebar");
                await task.say("text", `🎨 已開啟 Figma for VS Code 面板，你可以即時觀看繪製過程`);
            }
            catch (error) {
                // If Figma for VS Code is not installed, try opening in browser as fallback
                console.log("[ParallelUITasksTool] Figma for VS Code not available, trying browser fallback");
                if (mcpHub) {
                    try {
                        const fileInfoResult = await callFigmaTool("get_file_url", {});
                        if (fileInfoResult && typeof fileInfoResult === "object") {
                            const content = fileInfoResult.content;
                            if (Array.isArray(content) && content[0]?.text) {
                                const fileInfo = JSON.parse(content[0].text);
                                if (fileInfo.url) {
                                    await vscode.env.openExternal(vscode.Uri.parse(fileInfo.url));
                                    await task.say("text", `🔗 已在瀏覽器開啟 Figma：${fileInfo.fileName || "Untitled"}`);
                                }
                            }
                        }
                    }
                    catch {
                        // Silently ignore
                    }
                }
            }
            // Separate display/container tasks from button tasks
            const displayTasks = parsedTasks.filter((t) => t.description.toLowerCase().includes("display") ||
                t.description.toLowerCase().includes("顯示") ||
                t.description.toLowerCase().includes("container") ||
                t.description.toLowerCase().includes("背景") ||
                t.description.toLowerCase().includes("框架"));
            let buttonTasks = parsedTasks.filter((t) => !displayTasks.includes(t));
            // Sort button tasks for proper visual ordering
            // If tasks have positions, sort by position (y first, then x for reading order)
            // Otherwise, sort by task ID to maintain intended order
            buttonTasks = buttonTasks.sort((a, b) => {
                // If both have positions, sort by position
                if (a.position && b.position) {
                    // Sort by Y first (top to bottom), then by X (left to right)
                    if (a.position.y !== b.position.y) {
                        return a.position.y - b.position.y;
                    }
                    return a.position.x - b.position.x;
                }
                // If no positions, try to sort by numeric part of ID for natural ordering
                // This handles IDs like "btn-1", "btn-2", etc. or "7", "8", "9"
                const extractNumber = (id) => {
                    const match = id.match(/\d+/);
                    return match ? parseInt(match[0], 10) : null;
                };
                const numA = extractNumber(a.id);
                const numB = extractNumber(b.id);
                // If both have numeric parts, use custom sorting for calculator-like layouts
                // Check if IDs suggest a numpad layout (buttons 0-9)
                if (numA !== null && numB !== null) {
                    // Standard reading order - keep original array order if no special pattern
                    return 0;
                }
                // Fallback: maintain original order
                return 0;
            });
            console.log(`[ParallelUI] Button tasks after sorting: ${buttonTasks.map((t) => t.id).join(", ")}`);
            // Calculate display area height (only if there are display tasks)
            const DISPLAY_HEIGHT = 70; // Height for display area
            const DISPLAY_GAP = 10; // Gap between display and buttons
            const displayAreaHeight = displayTasks.length > 0 ? DISPLAY_HEIGHT + DISPLAY_GAP : 0;
            // Calculate container dimensions
            const buttonRows = Math.ceil(buttonTasks.length / GRID_COLUMNS);
            const containerWidth = GRID_COLUMNS * CELL_WIDTH + 40; // +40 for padding
            const containerHeight = displayAreaHeight + buttonRows * CELL_HEIGHT + FRAME_PADDING * 2;
            const containerX = START_X - 20;
            // NOTE: Container frame should be created by Designer BEFORE calling parallel_ui_tasks
            // This tool only creates the UI elements, not the container
            // Track current Y position for stacking elements (frame-relative coordinates start at padding)
            let currentDisplayY = FRAME_PADDING;
            // Step 1: Create display/container elements (sequential)
            if (displayTasks.length > 0) {
                await task.say("text", `📺 Creating ${displayTasks.length} display element(s)...`);
                for (const displayTask of displayTasks) {
                    try {
                        if (mcpHub) {
                            const width = displayTask.designSpec?.width || containerWidth - 40;
                            const height = displayTask.designSpec?.height || 60;
                            const bgColor = displayTask.designSpec?.colors?.[0] || "#2D2D2D";
                            const textColor = displayTask.designSpec?.colors?.[1] || "#FFFFFF";
                            const cornerRadius = displayTask.designSpec?.cornerRadius || 8;
                            // Create display rectangle inside container at positive coordinates
                            // SAFETY: Ensure displayY is always positive (minimum is FRAME_PADDING)
                            const displayY = Math.max(currentDisplayY, FRAME_PADDING);
                            const displayX = Math.max(START_X, FRAME_PADDING);
                            console.log(`[ParallelUI] Creating display element at (${displayX}, ${displayY}) with cornerRadius=${cornerRadius}`);
                            const rectResult = await callFigmaTool("create_rectangle", {
                                width,
                                height,
                                x: displayX,
                                y: displayY, // Use positive Y coordinate
                                cornerRadius,
                                hex: bgColor,
                                parent: params.containerFrame, // Create inside the container frame
                            });
                            // ALWAYS set corner radius explicitly after creating rectangle
                            // This ensures rounded corners work regardless of whether create_rectangle supports radius parameter
                            if (cornerRadius > 0) {
                                try {
                                    // Extract rectangle node ID from result
                                    let rectNodeId;
                                    if (rectResult.content && rectResult.content.length > 0) {
                                        const textContent = rectResult.content.find((c) => c.type === "text");
                                        if (textContent && textContent.type === "text") {
                                            try {
                                                const data = JSON.parse(textContent.text);
                                                rectNodeId = data.nodeId || data.id;
                                            }
                                            catch { }
                                        }
                                    }
                                    if (rectNodeId) {
                                        // Send BOTH radius and per-corner parameters for TalkToFigma compatibility
                                        console.log(`[ParallelUI] Setting corner radius ${cornerRadius} for display rectangle ${rectNodeId}`);
                                        await mcpHub.callTool(figmaServerName, "set_corner_radius", {
                                            nodeId: rectNodeId,
                                            radius: cornerRadius,
                                            cornerRadius: cornerRadius,
                                            topLeft: cornerRadius,
                                            topRight: cornerRadius,
                                            bottomRight: cornerRadius,
                                            bottomLeft: cornerRadius,
                                        });
                                        console.log(`[ParallelUI] ✓ Corner radius ${cornerRadius} set successfully for display`);
                                    }
                                    else {
                                        console.warn(`[ParallelUI] Could not extract rectangle ID to set corner radius`);
                                    }
                                }
                                catch (e) {
                                    console.warn(`[ParallelUI] Failed to set corner radius for display:`, e);
                                }
                            }
                            // Add display text if specified
                            if (displayTask.designSpec?.text) {
                                const textResult = await callFigmaTool("add_text", {
                                    text: displayTask.designSpec.text,
                                    x: displayX + width - 60, // Right-align
                                    y: displayY + 10, // Offset inside the display rectangle
                                    fontSize: displayTask.designSpec?.fontSize || 32,
                                    parent: params.containerFrame, // Create inside the container frame
                                });
                                // Set text color
                                if (textResult.content && textResult.content.length > 0) {
                                    const textContent = textResult.content.find((c) => c.type === "text");
                                    if (textContent && textContent.type === "text") {
                                        try {
                                            const data = JSON.parse(textContent.text);
                                            const textNodeId = data.nodeId || data.id;
                                            if (textNodeId) {
                                                await callFigmaTool("set_text_color", {
                                                    nodeId: textNodeId,
                                                    hex: textColor,
                                                });
                                            }
                                        }
                                        catch { }
                                    }
                                }
                            }
                            await task.say("text", `✅ Created: ${displayTask.description}`);
                        }
                    }
                    catch (error) {
                        console.warn(`[ParallelUI] Failed to create display task ${displayTask.id}:`, error);
                    }
                }
            }
            // Step 2: Convert button tasks to UITaskDefinition format with auto-assigned positions
            // Uses the same GRID_COLUMNS, CELL_WIDTH, etc. defined above
            if (buttonTasks.length === 0) {
                pushToolResult(formatResponse.toolResult("All tasks were display/container elements. No button tasks to parallelize."));
                return;
            }
            // Calculate button start position (after display area)
            const BUTTON_START_Y = FRAME_PADDING + displayAreaHeight;
            // Use smart calculator layout to determine positions
            // This places buttons in standard calculator order: 7-8-9, 4-5-6, 1-2-3, 0-.-=
            const buttonWidth = avgTaskWidth || 70;
            const buttonHeight = avgTaskHeight || 70;
            const buttonGap = 10;
            console.log(`[ParallelUI] Calculating smart calculator layout for ${buttonTasks.length} buttons`);
            const calculatorPositions = calculateCalculatorLayout(buttonTasks, START_X, BUTTON_START_Y, buttonWidth, buttonHeight, buttonGap);
            const uiTasks = buttonTasks.map((t, index) => {
                // Use calculator layout position if available, otherwise fall back to simple grid
                const calcPos = calculatorPositions.get(t.id);
                let position;
                let overrideWidth;
                if (calcPos) {
                    position = { x: calcPos.x, y: calcPos.y };
                    overrideWidth = calcPos.width; // For wide buttons like "0"
                    console.log(`[ParallelUI] Task "${t.id}" using calculator layout: (${position.x}, ${position.y})${overrideWidth ? `, width: ${overrideWidth}` : ""}`);
                }
                else if (t.position) {
                    position = t.position;
                    console.log(`[ParallelUI] Task "${t.id}" using provided position: (${position.x}, ${position.y})`);
                }
                else {
                    // Fallback to simple grid
                    position = {
                        x: START_X + (index % GRID_COLUMNS) * CELL_WIDTH,
                        y: BUTTON_START_Y + Math.floor(index / GRID_COLUMNS) * CELL_HEIGHT,
                    };
                    console.log(`[ParallelUI] Task "${t.id}" using fallback grid position: (${position.x}, ${position.y})`);
                }
                // SAFETY CHECK: Ensure positions are never negative when inside a container frame
                if (hasContainerFrame) {
                    if (position.x < 0) {
                        console.warn(`[ParallelUI] Task "${t.id}" has negative X (${position.x}), clamping to ${FRAME_PADDING}`);
                        position = { ...position, x: FRAME_PADDING };
                    }
                    if (position.y < 0) {
                        console.warn(`[ParallelUI] Task "${t.id}" has negative Y (${position.y}), clamping to ${BUTTON_START_Y}`);
                        position = { ...position, y: BUTTON_START_Y };
                    }
                }
                const designSpec = t.designSpec || {};
                // Use task's own designSpec dimensions, or calculator override, or fall back to averages
                const finalWidth = overrideWidth || designSpec.width || avgTaskWidth;
                const finalHeight = designSpec.height || avgTaskHeight;
                // Calculate default cornerRadius: use specified value, or 8 for normal buttons
                const finalCornerRadius = designSpec.cornerRadius !== undefined ? designSpec.cornerRadius : 8;
                // Log task details
                const buttonText = extractButtonTextFromTask(t);
                const colorInfo = designSpec.colors?.length
                    ? `colors: [${designSpec.colors.join(", ")}]`
                    : "default colors";
                console.log(`[ParallelUI] Task "${t.id}" (text: "${buttonText}") @ (${position.x}, ${position.y}), size: ${finalWidth}x${finalHeight}, ${colorInfo}`);
                return {
                    id: t.id,
                    description: t.description,
                    targetFrame: t.targetFrame,
                    position,
                    designSpec: {
                        width: finalWidth,
                        height: finalHeight,
                        style: designSpec.style,
                        colors: designSpec.colors || ["#3498db", "#FFFFFF"],
                        cornerRadius: finalCornerRadius,
                        fontSize: designSpec.fontSize,
                        text: designSpec.text,
                    },
                };
            });
            // Execute parallel tasks with progress updates
            const containerInfo = params.containerFrame ? ` (inside frame ${params.containerFrame})` : "";
            await task.say("text", `🚀 Launching ${buttonTasks.length} parallel AI agents for buttons${containerInfo}...`);
            const result = await service.executeParallelTasks(uiTasks, (taskId, status) => {
                // Log progress (could be enhanced to show in UI)
                console.log(`[ParallelUI] Task ${taskId}: ${status}`);
            }, params.containerFrame);
            // Report results
            const displayInfo = displayTasks.length > 0
                ? `\n- Display/container elements: ${displayTasks.length} (created sequentially)`
                : "";
            if (result.success) {
                await task.say("text", `✅ All ${buttonTasks.length} parallel button tasks completed successfully!\n\n` +
                    `📊 Summary:\n` +
                    `- Total duration: ${result.totalDuration}ms\n` +
                    `- Button nodes created: ${result.results.reduce((sum, r) => sum + r.nodeIds.length, 0)}` +
                    displayInfo +
                    `\n\n` +
                    `📝 Task Results:\n` +
                    result.results
                        .map((r) => `  • [${r.taskId}] ${r.success ? "✓" : "✗"} - ${r.nodeIds.length} nodes (${r.duration}ms)`)
                        .join("\n"));
            }
            else {
                const failed = result.results.filter((r) => !r.success);
                await task.say("text", `⚠️ Parallel UI tasks partially completed.\n\n` +
                    `📊 Summary: ${result.results.filter((r) => r.success).length}/${buttonTasks.length} buttons succeeded` +
                    displayInfo +
                    `\n\n` +
                    `❌ Failed tasks:\n` +
                    failed.map((r) => `  • [${r.taskId}]: ${r.error}`).join("\n"));
            }
            pushToolResult(formatResponse.toolResult(`Parallel UI drawing completed.\n\n${result.summary}\n\n` +
                `Detailed results:\n${JSON.stringify(result.results, null, 2)}`));
        }
        catch (error) {
            await handleError("executing parallel UI tasks", error);
        }
    }
    async handlePartial(task, block) {
        const nativeArgs = block.nativeArgs;
        const tasks = nativeArgs?.tasks;
        const partialMessage = JSON.stringify({
            tool: "parallelUITasks",
            tasks: tasks || "(streaming...)",
        });
        await task.ask("tool", partialMessage, block.partial).catch(() => { });
    }
}
export const parallelUITasksTool = new ParallelUITasksTool();
//# sourceMappingURL=ParallelUITasksTool.js.map