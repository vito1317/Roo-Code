export const toolParamNames = [
    "command",
    "path",
    "content",
    "regex",
    "file_pattern",
    "recursive",
    "action",
    "url",
    "coordinate",
    "text",
    "server_name",
    "tool_name",
    "arguments",
    "uri",
    "question",
    "result",
    "diff",
    "mode_slug",
    "reason",
    "line",
    "mode",
    "message",
    "cwd",
    "follow_up",
    "task",
    "size",
    "query",
    "args",
    "start_line",
    "end_line",
    "todos",
    "prompt",
    "image",
    "files", // Native protocol parameter for read_file
    "operations", // search_and_replace parameter for multiple operations
    "patch", // apply_patch parameter
    "file_path", // search_replace and edit_file parameter
    "old_string", // search_replace and edit_file parameter
    "new_string", // search_replace and edit_file parameter
    "expected_replacements", // edit_file parameter for multiple occurrences
    // Sentinel Edition: handoff_context parameters
    "notes",
    "context_json",
    // Sentinel Edition: start_background_service parameters
    "service_type",
    "port",
    "wait_ms",
    // Parallel UI tasks parameters
    "tasks",
    // Parallel MCP calls parameters
    "server",
    "calls",
    // Adjust layout parameters
    "layout",
    "columns",
    "gap",
    "gapX",
    "gapY",
    "startX",
    "startY",
    "within",
    "nodeIds",
    "excludeTypes",
    "sortBy",
    // Parallel UI tasks additional parameters
    "containerFrame",
];
export const TOOL_DISPLAY_NAMES = {
    execute_command: "run commands",
    read_file: "read files",
    fetch_instructions: "fetch instructions",
    write_to_file: "write files",
    apply_diff: "apply changes",
    search_and_replace: "apply changes using search and replace",
    search_replace: "apply single search and replace",
    edit_file: "edit files using search and replace",
    apply_patch: "apply patches using codex format",
    search_files: "search files",
    list_files: "list files",
    browser_action: "use a browser",
    use_mcp_tool: "use mcp tools",
    access_mcp_resource: "access mcp resources",
    ask_followup_question: "ask questions",
    attempt_completion: "complete tasks",
    switch_mode: "switch modes",
    new_task: "create new task",
    codebase_search: "codebase search",
    update_todo_list: "update todo list",
    run_slash_command: "run slash command",
    generate_image: "generate images",
    custom_tool: "use custom tools",
    // Sentinel Edition tools
    start_background_service: "start background services",
    handoff_context: "handoff context to next agent",
    parallel_ui_tasks: "execute parallel UI drawing tasks",
    parallel_mcp_calls: "execute parallel MCP tool calls",
    adjust_layout: "arrange Figma nodes in grid/row/column layout",
};
// Define available tool groups.
export const TOOL_GROUPS = {
    read: {
        tools: ["read_file", "fetch_instructions", "search_files", "list_files", "codebase_search"],
    },
    edit: {
        tools: ["apply_diff", "write_to_file", "generate_image"],
        customTools: ["search_and_replace", "search_replace", "edit_file", "apply_patch"],
    },
    browser: {
        tools: ["browser_action"],
    },
    command: {
        tools: ["execute_command"],
    },
    mcp: {
        tools: ["use_mcp_tool", "access_mcp_resource", "parallel_ui_tasks", "parallel_mcp_calls", "adjust_layout"],
    },
    modes: {
        tools: ["switch_mode", "new_task"],
        alwaysAvailable: true,
    },
};
// Tools that are always available to all modes.
export const ALWAYS_AVAILABLE_TOOLS = [
    "ask_followup_question",
    "attempt_completion",
    "switch_mode",
    "new_task",
    "update_todo_list",
    "run_slash_command",
    "handoff_context", // Sentinel Edition: Always available for agent handoffs
    "start_background_service", // Sentinel Edition: Always available for starting servers
    "parallel_ui_tasks", // Sentinel Edition: Always available for parallel UI design
    "parallel_mcp_calls", // Sentinel Edition: Always available for parallel MCP operations
    "adjust_layout", // Sentinel Edition: Always available for auto-layout of Figma nodes
];
/**
 * Central registry of tool aliases.
 * Maps alias name -> canonical tool name.
 *
 * This allows models to use alternative names for tools (e.g., "edit_file" instead of "apply_diff").
 * When a model calls a tool by its alias, the system resolves it to the canonical name for execution,
 * but preserves the alias in API conversation history for consistency.
 *
 * To add a new alias, simply add an entry here. No other files need to be modified.
 */
export const TOOL_ALIASES = {
    write_file: "write_to_file",
};
//# sourceMappingURL=tools.js.map