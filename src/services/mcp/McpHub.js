import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import ReconnectingEventSource from "reconnecting-eventsource";
import { CallToolResultSchema, ListResourcesResultSchema, ListResourceTemplatesResultSchema, ListToolsResultSchema, ReadResourceResultSchema, } from "@modelcontextprotocol/sdk/types.js";
import chokidar from "chokidar";
import delay from "delay";
import deepEqual from "fast-deep-equal";
import { z } from "zod";
import { t } from "../../i18n";
import { GlobalFileNames } from "../../shared/globalFileNames";
import { fileExistsAtPath } from "../../utils/fs";
import { arePathsEqual, getWorkspacePath } from "../../utils/path";
import { injectVariables } from "../../utils/config";
import { safeWriteJson } from "../../utils/safeWriteJson";
import { sanitizeMcpName } from "../../utils/mcp-name";
// Enum for disable reasons
export var DisableReason;
(function (DisableReason) {
    DisableReason["MCP_DISABLED"] = "mcpDisabled";
    DisableReason["SERVER_DISABLED"] = "serverDisabled";
})(DisableReason || (DisableReason = {}));
// Base configuration schema for common settings
const BaseConfigSchema = z.object({
    disabled: z.boolean().optional(),
    timeout: z.number().min(1).max(3600).optional().default(60),
    alwaysAllow: z.array(z.string()).default([]),
    watchPaths: z.array(z.string()).optional(), // paths to watch for changes and restart server
    disabledTools: z.array(z.string()).default([]),
});
// Custom error messages for better user feedback
const typeErrorMessage = "Server type must be 'stdio', 'sse', or 'streamable-http'";
const stdioFieldsErrorMessage = "For 'stdio' type servers, you must provide a 'command' field and can optionally include 'args' and 'env'";
const sseFieldsErrorMessage = "For 'sse' type servers, you must provide a 'url' field and can optionally include 'headers'";
const streamableHttpFieldsErrorMessage = "For 'streamable-http' type servers, you must provide a 'url' field and can optionally include 'headers'";
const mixedFieldsErrorMessage = "Cannot mix 'stdio' and ('sse' or 'streamable-http') fields. For 'stdio' use 'command', 'args', and 'env'. For 'sse'/'streamable-http' use 'url' and 'headers'";
const missingFieldsErrorMessage = "Server configuration must include either 'command' (for stdio) or 'url' (for sse/streamable-http) and a corresponding 'type' if 'url' is used.";
// Helper function to create a refined schema with better error messages
const createServerTypeSchema = () => {
    return z.union([
        // Stdio config (has command field)
        BaseConfigSchema.extend({
            type: z.enum(["stdio"]).optional(),
            command: z.string().min(1, "Command cannot be empty"),
            args: z.array(z.string()).optional(),
            cwd: z.string().default(() => vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath ?? process.cwd()),
            env: z.record(z.string()).optional(),
            // Ensure no SSE fields are present
            url: z.undefined().optional(),
            headers: z.undefined().optional(),
        })
            .transform((data) => ({
            ...data,
            type: "stdio",
        }))
            .refine((data) => data.type === undefined || data.type === "stdio", { message: typeErrorMessage }),
        // SSE config (has url field)
        BaseConfigSchema.extend({
            type: z.enum(["sse"]).optional(),
            url: z.string().url("URL must be a valid URL format"),
            headers: z.record(z.string()).optional(),
            // Ensure no stdio fields are present
            command: z.undefined().optional(),
            args: z.undefined().optional(),
            env: z.undefined().optional(),
        })
            .transform((data) => ({
            ...data,
            type: "sse",
        }))
            .refine((data) => data.type === undefined || data.type === "sse", { message: typeErrorMessage }),
        // StreamableHTTP config (has url field)
        BaseConfigSchema.extend({
            type: z.enum(["streamable-http"]).optional(),
            url: z.string().url("URL must be a valid URL format"),
            headers: z.record(z.string()).optional(),
            // Ensure no stdio fields are present
            command: z.undefined().optional(),
            args: z.undefined().optional(),
            env: z.undefined().optional(),
        })
            .transform((data) => ({
            ...data,
            type: "streamable-http",
        }))
            .refine((data) => data.type === undefined || data.type === "streamable-http", {
            message: typeErrorMessage,
        }),
    ]);
};
// Server configuration schema with automatic type inference and validation
export const ServerConfigSchema = createServerTypeSchema();
// Settings schema
const McpSettingsSchema = z.object({
    mcpServers: z.record(ServerConfigSchema),
});
export class McpHub {
    providerRef;
    disposables = [];
    settingsWatcher;
    fileWatchers = new Map();
    projectMcpWatcher;
    isDisposed = false;
    connections = [];
    isConnecting = false;
    refCount = 0; // Reference counter for active clients
    configChangeDebounceTimers = new Map();
    isProgrammaticUpdate = false;
    flagResetTimer;
    sanitizedNameRegistry = new Map();
    // Auto-reconnect tracking
    reconnectAttempts = new Map();
    reconnectTimers = new Map();
    static MAX_RECONNECT_DELAY = 8000; // 8 seconds max delay
    static BASE_RECONNECT_DELAY = 1000; // 1 second base delay
    // Figma preview auto-open tracking (per session)
    figmaPreviewAutoOpened = false;
    constructor(provider) {
        this.providerRef = new WeakRef(provider);
        this.watchMcpSettingsFile();
        this.watchProjectMcpFile().catch(console.error);
        this.setupWorkspaceFoldersWatcher();
        this.initializeGlobalMcpServers();
        this.initializeProjectMcpServers();
        this.initializeBuiltInFigmaWriteServer(provider);
        this.initializeBuiltInTalkToFigmaServer();
    }
    /**
     * Registers a client (e.g., ClineProvider) using this hub.
     * Increments the reference count.
     */
    registerClient() {
        this.refCount++;
        // console.log(`McpHub: Client registered. Ref count: ${this.refCount}`)
    }
    /**
     * Unregisters a client. Decrements the reference count.
     * If the count reaches zero, disposes the hub.
     */
    async unregisterClient() {
        this.refCount--;
        // console.log(`McpHub: Client unregistered. Ref count: ${this.refCount}`)
        if (this.refCount <= 0) {
            console.log("McpHub: Last client unregistered. Disposing hub.");
            await this.dispose();
        }
    }
    /**
     * Validates and normalizes server configuration
     * @param config The server configuration to validate
     * @param serverName Optional server name for error messages
     * @returns The validated configuration
     * @throws Error if the configuration is invalid
     */
    validateServerConfig(config, serverName) {
        // Detect configuration issues before validation
        const hasStdioFields = config.command !== undefined;
        const hasUrlFields = config.url !== undefined; // Covers sse and streamable-http
        // Check for mixed fields (stdio vs url-based)
        if (hasStdioFields && hasUrlFields) {
            throw new Error(mixedFieldsErrorMessage);
        }
        // Infer type for stdio if not provided
        if (!config.type && hasStdioFields) {
            config.type = "stdio";
        }
        // For url-based configs, type must be provided by the user
        if (hasUrlFields && !config.type) {
            throw new Error("Configuration with 'url' must explicitly specify 'type' as 'sse' or 'streamable-http'.");
        }
        // Validate type if provided
        if (config.type && !["stdio", "sse", "streamable-http"].includes(config.type)) {
            throw new Error(typeErrorMessage);
        }
        // Check for type/field mismatch
        if (config.type === "stdio" && !hasStdioFields) {
            throw new Error(stdioFieldsErrorMessage);
        }
        if (config.type === "sse" && !hasUrlFields) {
            throw new Error(sseFieldsErrorMessage);
        }
        if (config.type === "streamable-http" && !hasUrlFields) {
            throw new Error(streamableHttpFieldsErrorMessage);
        }
        // If neither command nor url is present (type alone is not enough)
        if (!hasStdioFields && !hasUrlFields) {
            throw new Error(missingFieldsErrorMessage);
        }
        // Validate the config against the schema
        try {
            return ServerConfigSchema.parse(config);
        }
        catch (validationError) {
            if (validationError instanceof z.ZodError) {
                // Extract and format validation errors
                const errorMessages = validationError.errors
                    .map((err) => `${err.path.join(".")}: ${err.message}`)
                    .join("; ");
                throw new Error(serverName
                    ? `Invalid configuration for server "${serverName}": ${errorMessages}`
                    : `Invalid server configuration: ${errorMessages}`);
            }
            throw validationError;
        }
    }
    /**
     * Formats and displays error messages to the user
     * @param message The error message prefix
     * @param error The error object
     */
    showErrorMessage(message, error) {
        console.error(`${message}:`, error);
    }
    setupWorkspaceFoldersWatcher() {
        // Skip if test environment is detected
        if (process.env.NODE_ENV === "test") {
            return;
        }
        this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await this.updateProjectMcpServers();
            await this.watchProjectMcpFile();
        }));
    }
    /**
     * Debounced wrapper for handling config file changes
     */
    debounceConfigChange(filePath, source) {
        // Skip processing if this is a programmatic update to prevent unnecessary server restarts
        if (this.isProgrammaticUpdate) {
            return;
        }
        const key = `${source}-${filePath}`;
        // Clear existing timer if any
        const existingTimer = this.configChangeDebounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        // Set new timer
        const timer = setTimeout(async () => {
            this.configChangeDebounceTimers.delete(key);
            await this.handleConfigFileChange(filePath, source);
        }, 500); // 500ms debounce
        this.configChangeDebounceTimers.set(key, timer);
    }
    async handleConfigFileChange(filePath, source) {
        try {
            const content = await fs.readFile(filePath, "utf-8");
            let config;
            try {
                config = JSON.parse(content);
            }
            catch (parseError) {
                const errorMessage = t("mcp:errors.invalid_settings_syntax");
                console.error(errorMessage, parseError);
                vscode.window.showErrorMessage(errorMessage);
                return;
            }
            const result = McpSettingsSchema.safeParse(config);
            if (!result.success) {
                const errorMessages = result.error.errors
                    .map((err) => `${err.path.join(".")}: ${err.message}`)
                    .join("\n");
                vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }));
                return;
            }
            await this.updateServerConnections(result.data.mcpServers || {}, source);
        }
        catch (error) {
            // Check if the error is because the file doesn't exist
            if (error.code === "ENOENT" && source === "project") {
                // File was deleted, clean up project MCP servers
                await this.cleanupProjectMcpServers();
                await this.notifyWebviewOfServerChanges();
                vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"));
            }
            else {
                this.showErrorMessage(t("mcp:errors.failed_update_project"), error);
            }
        }
    }
    async watchProjectMcpFile() {
        // Skip if test environment is detected or VSCode APIs are not available
        if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
            return;
        }
        // Clean up existing project MCP watcher if it exists
        if (this.projectMcpWatcher) {
            this.projectMcpWatcher.dispose();
            this.projectMcpWatcher = undefined;
        }
        if (!vscode.workspace.workspaceFolders?.length) {
            return;
        }
        const workspaceFolder = this.providerRef.deref()?.cwd ?? getWorkspacePath();
        const projectMcpPattern = new vscode.RelativePattern(workspaceFolder, ".roo/mcp.json");
        // Create a file system watcher for the project MCP file pattern
        this.projectMcpWatcher = vscode.workspace.createFileSystemWatcher(projectMcpPattern);
        // Watch for file changes
        const changeDisposable = this.projectMcpWatcher.onDidChange((uri) => {
            this.debounceConfigChange(uri.fsPath, "project");
        });
        // Watch for file creation
        const createDisposable = this.projectMcpWatcher.onDidCreate((uri) => {
            this.debounceConfigChange(uri.fsPath, "project");
        });
        // Watch for file deletion
        const deleteDisposable = this.projectMcpWatcher.onDidDelete(async () => {
            // Clean up all project MCP servers when the file is deleted
            await this.cleanupProjectMcpServers();
            await this.notifyWebviewOfServerChanges();
            vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"));
        });
        this.disposables.push(vscode.Disposable.from(changeDisposable, createDisposable, deleteDisposable, this.projectMcpWatcher));
    }
    async updateProjectMcpServers() {
        try {
            const projectMcpPath = await this.getProjectMcpPath();
            if (!projectMcpPath)
                return;
            const content = await fs.readFile(projectMcpPath, "utf-8");
            let config;
            try {
                config = JSON.parse(content);
            }
            catch (parseError) {
                const errorMessage = t("mcp:errors.invalid_settings_syntax");
                console.error(errorMessage, parseError);
                vscode.window.showErrorMessage(errorMessage);
                return;
            }
            // Validate configuration structure
            const result = McpSettingsSchema.safeParse(config);
            if (result.success) {
                await this.updateServerConnections(result.data.mcpServers || {}, "project");
            }
            else {
                // Format validation errors for better user feedback
                const errorMessages = result.error.errors
                    .map((err) => `${err.path.join(".")}: ${err.message}`)
                    .join("\n");
                console.error("Invalid project MCP settings format:", errorMessages);
                vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }));
            }
        }
        catch (error) {
            this.showErrorMessage(t("mcp:errors.failed_update_project"), error);
        }
    }
    async cleanupProjectMcpServers() {
        // Disconnect and remove all project MCP servers
        const projectConnections = this.connections.filter((conn) => conn.server.source === "project");
        for (const conn of projectConnections) {
            await this.deleteConnection(conn.server.name, "project");
        }
        // Clear project servers from the connections list
        await this.updateServerConnections({}, "project", false);
    }
    getServers() {
        // Only return enabled servers, deduplicating by name with project servers taking priority
        const enabledConnections = this.connections.filter((conn) => !conn.server.disabled);
        // Deduplicate by server name: project servers take priority over global servers
        const serversByName = new Map();
        for (const conn of enabledConnections) {
            const existing = serversByName.get(conn.server.name);
            if (!existing) {
                serversByName.set(conn.server.name, conn.server);
            }
            else if (conn.server.source === "project" && existing.source !== "project") {
                // Project server overrides global server with the same name
                serversByName.set(conn.server.name, conn.server);
            }
            // If existing is project and current is global, keep existing (project wins)
        }
        return Array.from(serversByName.values());
    }
    getAllServers() {
        // Return all servers regardless of state
        return this.connections.map((conn) => conn.server);
    }
    async getMcpServersPath() {
        const provider = this.providerRef.deref();
        if (!provider) {
            throw new Error("Provider not available");
        }
        const mcpServersPath = await provider.ensureMcpServersDirectoryExists();
        return mcpServersPath;
    }
    async getMcpSettingsFilePath() {
        const provider = this.providerRef.deref();
        if (!provider) {
            throw new Error("Provider not available");
        }
        const mcpSettingsFilePath = path.join(await provider.ensureSettingsDirectoryExists(), GlobalFileNames.mcpSettings);
        const fileExists = await fileExistsAtPath(mcpSettingsFilePath);
        if (!fileExists) {
            await fs.writeFile(mcpSettingsFilePath, `{
  "mcpServers": {

  }
}`);
        }
        return mcpSettingsFilePath;
    }
    async watchMcpSettingsFile() {
        // Skip if test environment is detected or VSCode APIs are not available
        if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
            return;
        }
        // Clean up existing settings watcher if it exists
        if (this.settingsWatcher) {
            this.settingsWatcher.dispose();
            this.settingsWatcher = undefined;
        }
        const settingsPath = await this.getMcpSettingsFilePath();
        const settingsUri = vscode.Uri.file(settingsPath);
        const settingsPattern = new vscode.RelativePattern(path.dirname(settingsPath), path.basename(settingsPath));
        // Create a file system watcher for the global MCP settings file
        this.settingsWatcher = vscode.workspace.createFileSystemWatcher(settingsPattern);
        // Watch for file changes
        const changeDisposable = this.settingsWatcher.onDidChange((uri) => {
            if (arePathsEqual(uri.fsPath, settingsPath)) {
                this.debounceConfigChange(settingsPath, "global");
            }
        });
        // Watch for file creation
        const createDisposable = this.settingsWatcher.onDidCreate((uri) => {
            if (arePathsEqual(uri.fsPath, settingsPath)) {
                this.debounceConfigChange(settingsPath, "global");
            }
        });
        this.disposables.push(vscode.Disposable.from(changeDisposable, createDisposable, this.settingsWatcher));
    }
    async initializeMcpServers(source) {
        try {
            const configPath = source === "global" ? await this.getMcpSettingsFilePath() : await this.getProjectMcpPath();
            if (!configPath) {
                return;
            }
            const content = await fs.readFile(configPath, "utf-8");
            const config = JSON.parse(content);
            const result = McpSettingsSchema.safeParse(config);
            if (result.success) {
                // Pass all servers including disabled ones - they'll be handled in updateServerConnections
                await this.updateServerConnections(result.data.mcpServers || {}, source, false);
            }
            else {
                const errorMessages = result.error.errors
                    .map((err) => `${err.path.join(".")}: ${err.message}`)
                    .join("\n");
                console.error(`Invalid ${source} MCP settings format:`, errorMessages);
                vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }));
                if (source === "global") {
                    // Still try to connect with the raw config, but show warnings
                    try {
                        await this.updateServerConnections(config.mcpServers || {}, source, false);
                    }
                    catch (error) {
                        this.showErrorMessage(`Failed to initialize ${source} MCP servers with raw config`, error);
                    }
                }
            }
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                const errorMessage = t("mcp:errors.invalid_settings_syntax");
                console.error(errorMessage, error);
                vscode.window.showErrorMessage(errorMessage);
            }
            else {
                this.showErrorMessage(`Failed to initialize ${source} MCP servers`, error);
            }
        }
    }
    async initializeGlobalMcpServers() {
        await this.initializeMcpServers("global");
    }
    // Get project-level MCP configuration path
    async getProjectMcpPath() {
        const workspacePath = this.providerRef.deref()?.cwd ?? getWorkspacePath();
        const projectMcpDir = path.join(workspacePath, ".roo");
        const projectMcpPath = path.join(projectMcpDir, "mcp.json");
        try {
            await fs.access(projectMcpPath);
            return projectMcpPath;
        }
        catch {
            return null;
        }
    }
    // Initialize project-level MCP servers
    async initializeProjectMcpServers() {
        await this.initializeMcpServers("project");
    }
    /**
     * Initialize the built-in figma-write server for seamless Figma integration
     * This server is automatically registered without user configuration
     */
    async initializeBuiltInFigmaWriteServer(provider) {
        try {
            // Check if figma-write is enabled in settings
            const state = await provider.getState();
            const figmaWriteEnabled = state?.figmaWriteEnabled ?? false; // Default to false (TalkToFigma is preferred)
            if (!figmaWriteEnabled) {
                console.log("[McpHub] figma-write is disabled in settings, skipping initialization");
                return;
            }
            // Get the extension path to locate the figma-write-bridge
            const extensionPath = provider.context?.extensionPath;
            if (!extensionPath) {
                console.log("[McpHub] Extension path not available, skipping built-in figma-write server");
                return;
            }
            const serverPath = `${extensionPath}/tools/figma-write-bridge/server.ts`;
            // Check if the server file exists
            try {
                await fs.access(serverPath);
            }
            catch {
                console.log("[McpHub] figma-write-bridge not found, skipping built-in server");
                return;
            }
            // Check if figma-write is already configured by user (don't override)
            const existingConnection = this.connections.find((conn) => conn.server.name === "figma-write");
            if (existingConnection) {
                console.log("[McpHub] figma-write already configured, skipping built-in server");
                return;
            }
            // Register the built-in figma-write server using node with tsx loader
            // Note: We use node --import tsx/esm to run TypeScript directly, avoiding npx PATH issues and bundling issues with zod schemas
            const nodeModulesPath = `${extensionPath}/tools/figma-write-bridge/node_modules`;
            const tsxPath = `${nodeModulesPath}/tsx/dist/esm/index.mjs`;
            const config = {
                command: "node",
                args: ["--import", tsxPath, serverPath],
                type: "stdio",
                timeout: 60, // 60 seconds (unit is seconds, not milliseconds!)
                alwaysAllow: [],
                disabledTools: [],
                cwd: `${extensionPath}/tools/figma-write-bridge`,
                env: {
                    ...process.env,
                    NODE_PATH: nodeModulesPath,
                },
            };
            console.log("[McpHub] Initializing built-in figma-write server");
            await this.connectToServer("figma-write", config, "global");
            console.log("[McpHub] Built-in figma-write server initialized");
        }
        catch (error) {
            // Don't fail if figma-write can't be initialized - it's optional
            console.log("[McpHub] Could not initialize built-in figma-write server:", error);
        }
    }
    // Track if TalkToFigma initialization is in progress to prevent duplicate initializations
    talkToFigmaInitializing = false;
    lastTalkToFigmaInitTime = 0;
    /**
     * Initialize the built-in TalkToFigma server for Figma integration via ai-figma-mcp
     * This server is automatically registered without user configuration
     */
    async initializeBuiltInTalkToFigmaServer() {
        try {
            // Check if TalkToFigma is enabled in settings
            const provider = this.providerRef.deref();
            if (provider) {
                const state = await provider.getState();
                const talkToFigmaEnabled = state?.talkToFigmaEnabled ?? true; // Default to true
                if (!talkToFigmaEnabled) {
                    console.log("[McpHub] TalkToFigma is disabled in settings, skipping initialization");
                    return;
                }
            }
            // Prevent duplicate initializations - must wait at least 5 seconds between attempts
            const now = Date.now();
            if (this.talkToFigmaInitializing) {
                console.log("[McpHub] TalkToFigma initialization already in progress, skipping");
                return;
            }
            if (now - this.lastTalkToFigmaInitTime < 5000) {
                console.log("[McpHub] TalkToFigma was initialized recently, skipping (debounce)");
                return;
            }
            // Check if TalkToFigma is already configured by user (don't override)
            const existingConnection = this.connections.find((conn) => conn.server.name === "TalkToFigma");
            if (existingConnection && existingConnection.server.status === "connected") {
                console.log("[McpHub] TalkToFigma already configured and connected, skipping built-in server");
                return;
            }
            this.talkToFigmaInitializing = true;
            this.lastTalkToFigmaInitTime = now;
            // Register the built-in TalkToFigma server using npx
            // All tools are set to always allow for seamless Figma integration
            // Package: ai-figma-mcp (same tools as cursor-talk-to-figma-mcp)
            const config = {
                command: "npx",
                args: ["-y", "ai-figma-mcp@latest"],
                type: "stdio",
                timeout: 60, // 60 seconds
                cwd: vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath ?? process.cwd(),
                alwaysAllow: [
                    // Connection Management
                    "join_channel",
                    // Document & Selection
                    "get_document_info",
                    "get_selection",
                    "read_my_design",
                    "get_node_info",
                    "get_nodes_info",
                    // Annotations
                    "get_annotations",
                    "set_annotation",
                    "set_multiple_annotations",
                    "scan_nodes_by_types",
                    // Prototyping & Connections
                    "get_reactions",
                    "set_default_connector",
                    "create_connections",
                    // Creating Elements
                    "create_rectangle",
                    "create_frame",
                    "create_text",
                    // Modifying text content
                    "scan_text_nodes",
                    "set_text_content",
                    "set_multiple_text_contents",
                    // Auto Layout & Spacing
                    "set_layout_mode",
                    "set_padding",
                    "set_axis_align",
                    "set_layout_sizing",
                    "set_item_spacing",
                    // Styling
                    "set_fill_color",
                    "set_stroke_color",
                    "set_corner_radius",
                    // Layout & Organization
                    "move_node",
                    "resize_node",
                    "delete_node",
                    "delete_multiple_nodes",
                    "clone_node",
                    // Components & Styles
                    "get_styles",
                    "get_local_components",
                    "create_component_instance",
                    "get_instance_overrides",
                    "set_instance_overrides",
                    // Export
                    "export_node_as_image",
                ],
                // Disable tools that should not be called by AI agents
                // join_channel is handled automatically by the extension
                disabledTools: ["join_channel"],
            };
            console.log("[McpHub] Initializing built-in TalkToFigma server");
            await this.connectToServer("TalkToFigma", config, "global");
            console.log("[McpHub] Built-in TalkToFigma server initialized");
            // Note: Channel connection prompt is handled in ClineProvider.performPreparationTasks()
        }
        catch (error) {
            // Don't fail if TalkToFigma can't be initialized - it's optional
            console.log("[McpHub] Could not initialize built-in TalkToFigma server:", error);
        }
        finally {
            this.talkToFigmaInitializing = false;
        }
    }
    // Track if Figma channel has been connected in this session
    figmaChannelConnected = false;
    // Prevent multiple error prompts for the same disconnection event
    figmaErrorPromptPending = false;
    // Store the last used channel code for auto-reconnection
    lastFigmaChannelCode = null;
    /**
     * Check if TalkToFigma server is connected and available
     */
    isTalkToFigmaConnected() {
        return this.connections.some((conn) => conn.server.name === "TalkToFigma" && conn.server.status === "connected");
    }
    /**
     * Check if Figma channel has been joined in this session
     */
    isFigmaChannelConnected() {
        return this.figmaChannelConnected;
    }
    /**
     * Reset the Figma channel connection state
     * Called when connection is detected as broken
     */
    resetFigmaChannelConnection() {
        this.figmaChannelConnected = false;
        console.log("[McpHub] Figma channel connection state reset");
    }
    /**
     * Prompt user to enter the Figma channel code and connect
     * Called at the start of each conversation if TalkToFigma is available
     * @param forcePrompt If true, prompts even if already connected (for reconnection)
     */
    async promptTalkToFigmaChannelConnection(forcePrompt = false) {
        // Skip if already connected in this session (unless forcing reconnection)
        if (this.figmaChannelConnected && !forcePrompt) {
            console.log("[McpHub] Figma channel already connected in this session");
            return true;
        }
        // Skip if TalkToFigma server is not connected
        if (!this.isTalkToFigmaConnected()) {
            console.log("[McpHub] TalkToFigma server not connected, skipping channel prompt");
            return false;
        }
        try {
            // If we have a previous channel code and this is a reconnection attempt, try auto-reconnect first
            if (forcePrompt && this.lastFigmaChannelCode) {
                console.log("[McpHub] Attempting auto-reconnection with previous channel code:", this.lastFigmaChannelCode);
                vscode.window.showInformationMessage(`正在嘗試重新連接到頻道 ${this.lastFigmaChannelCode}... (Attempting to reconnect...)`);
                try {
                    const autoResult = await this.callTool("TalkToFigma", "join_channel", {
                        channel: this.lastFigmaChannelCode,
                    });
                    if (autoResult) {
                        const textContent = autoResult.content?.find((c) => c.type === "text");
                        const resultText = textContent && "text" in textContent ? textContent.text.toLowerCase() : "";
                        // Check if auto-reconnect succeeded
                        if (!resultText.includes("error") &&
                            !resultText.includes("failed") &&
                            !resultText.includes("not connected")) {
                            this.figmaChannelConnected = true;
                            vscode.window.showInformationMessage(`已重新連接到頻道 ${this.lastFigmaChannelCode} (Reconnected to channel)`);
                            console.log("[McpHub] Auto-reconnected to Figma channel:", this.lastFigmaChannelCode);
                            return true;
                        }
                    }
                }
                catch (autoError) {
                    console.log("[McpHub] Auto-reconnection failed:", autoError);
                }
                // Auto-reconnect failed, will prompt for new code below
                console.log("[McpHub] Auto-reconnection with previous code failed, prompting for new code");
            }
            // Ask user for the channel code
            const promptMessage = forcePrompt
                ? `自動重連失敗。請輸入新的頻道代碼：\n(Auto-reconnect failed. Enter a new channel code:)`
                : "請輸入 Figma 頻道代碼 (Enter Figma channel code from plugin)";
            const channelCode = await vscode.window.showInputBox({
                prompt: promptMessage,
                placeHolder: this.lastFigmaChannelCode || "e.g., abc123",
                value: this.lastFigmaChannelCode || undefined, // Pre-fill with last code
                title: forcePrompt ? "重新連接 Figma (Reconnect)" : "連接 Figma (Connect)",
                ignoreFocusOut: true,
            });
            if (!channelCode) {
                console.log("[McpHub] User cancelled Figma channel connection");
                vscode.window.showInformationMessage("Figma 頻道未連接。(Figma channel not connected.)");
                return false;
            }
            // Reset connection state before reconnecting
            this.figmaChannelConnected = false;
            // Call the join_channel tool (correct tool name for ai-figma-mcp)
            const result = await this.callTool("TalkToFigma", "join_channel", { channel: channelCode });
            if (result) {
                this.figmaChannelConnected = true;
                this.lastFigmaChannelCode = channelCode; // Store for auto-reconnection
                vscode.window.showInformationMessage(`已連接到 Figma 頻道: ${channelCode}`);
                console.log("[McpHub] Successfully connected to Figma channel:", channelCode);
                return true;
            }
            return false;
        }
        catch (error) {
            console.log("[McpHub] Failed to connect to Figma channel:", error);
            this.figmaChannelConnected = false;
            vscode.window.showWarningMessage("Failed to connect to Figma channel. Make sure the Cursor Talk to Figma plugin is running in Figma.");
            return false;
        }
    }
    /**
     * Open the Figma preview panel
     */
    async openFigmaPreviewPanel(figmaUrl, extensionUri) {
        try {
            const { FigmaPreviewPanel } = await import("../figma/FigmaPreviewPanel");
            const figmaPreview = FigmaPreviewPanel.initialize(extensionUri);
            await figmaPreview.show(figmaUrl);
            console.log("[McpHub] Figma preview panel opened automatically");
        }
        catch (error) {
            console.error("[McpHub] Failed to open Figma preview:", error);
        }
    }
    /**
     * Handle Figma tool call failure - auto-reconnect with same channel code
     * Returns true if reconnection was successful
     */
    async handleFigmaConnectionError(errorMessage) {
        console.log("[McpHub] Figma connection error detected:", errorMessage);
        // Check if this looks like a connection error
        const lowerError = (errorMessage || "").toLowerCase();
        const isConnectionError = !errorMessage ||
            lowerError.includes("disconnect") ||
            lowerError.includes("timeout") ||
            lowerError.includes("not connected") ||
            lowerError.includes("channel not found") ||
            lowerError.includes("no channel") ||
            lowerError.includes("join a channel") ||
            lowerError.includes("please join") ||
            lowerError.includes("not joined") ||
            lowerError.includes("channel closed") ||
            lowerError.includes("socket closed") ||
            lowerError.includes("websocket error") ||
            lowerError.includes("connection lost") ||
            lowerError.includes("connection refused") ||
            lowerError.includes("failed to send") ||
            lowerError.includes("no response") ||
            lowerError.includes("no active connection") ||
            lowerError.includes("unable to send");
        if (isConnectionError) {
            // Reset connection state
            this.resetFigmaChannelConnection();
            // Try auto-reconnect with stored channel code first (silently)
            if (this.lastFigmaChannelCode) {
                console.log("[McpHub] Attempting silent auto-reconnect to channel:", this.lastFigmaChannelCode);
                vscode.window.showInformationMessage(`正在自動重新連接到頻道 ${this.lastFigmaChannelCode}... (Auto-reconnecting to channel...)`);
                try {
                    const autoResult = await this.callTool("TalkToFigma", "join_channel", {
                        channel: this.lastFigmaChannelCode,
                    });
                    if (autoResult) {
                        const textContent = autoResult.content?.find((c) => c.type === "text");
                        const resultText = textContent && "text" in textContent ? textContent.text.toLowerCase() : "";
                        // Check if auto-reconnect succeeded
                        if (!resultText.includes("error") &&
                            !resultText.includes("failed") &&
                            !resultText.includes("not connected")) {
                            this.figmaChannelConnected = true;
                            vscode.window.showInformationMessage(`✓ 已自動重新連接到頻道 ${this.lastFigmaChannelCode} (Auto-reconnected successfully)`);
                            console.log("[McpHub] Silent auto-reconnect successful:", this.lastFigmaChannelCode);
                            return true;
                        }
                    }
                }
                catch (autoError) {
                    console.log("[McpHub] Silent auto-reconnect failed:", autoError);
                }
                // Auto-reconnect failed, show prompt
                vscode.window.showWarningMessage(`自動重連失敗。(Auto-reconnect to ${this.lastFigmaChannelCode} failed.)`);
            }
            // Show error message and prompt for action (only if auto-reconnect failed or no stored code)
            const action = await vscode.window.showWarningMessage("Figma 連線中斷或失敗。\n(Figma connection lost or failed.)", "重啟伺服器 (Restart Server)", "輸入新代碼 (New Code)", "取消 (Cancel)");
            if (action === "重啟伺服器 (Restart Server)") {
                // Try to restart the MCP server first
                console.log("[McpHub] Attempting to restart Figma MCP server...");
                try {
                    // Find which Figma server is being used
                    const talkToFigmaConn = this.findConnection("TalkToFigma");
                    const figmaWriteConn = this.findConnection("figma-write");
                    if (talkToFigmaConn) {
                        vscode.window.showInformationMessage("正在重啟 TalkToFigma 伺服器... (Restarting TalkToFigma server...)");
                        await this.restartConnection("TalkToFigma", talkToFigmaConn.server.source);
                        // After restart, clear old channel code and prompt for new one
                        // This ensures the input dialog appears instead of auto-reconnecting
                        this.lastFigmaChannelCode = null;
                        this.figmaChannelConnected = false;
                        vscode.window.showInformationMessage("伺服器已重啟，請輸入新的連接代碼。(Server restarted, please enter new channel code.)");
                        return this.promptTalkToFigmaChannelConnection(true);
                    }
                    else if (figmaWriteConn) {
                        vscode.window.showInformationMessage("正在重啟 figma-write 伺服器... (Restarting figma-write server...)");
                        await this.restartConnection("figma-write", figmaWriteConn.server.source);
                        vscode.window.showInformationMessage("figma-write 伺服器已重啟。(figma-write server restarted.)");
                        return true;
                    }
                    else {
                        vscode.window.showErrorMessage("找不到 Figma MCP 伺服器。(No Figma MCP server found.)");
                        return false;
                    }
                }
                catch (error) {
                    console.error("[McpHub] Failed to restart Figma server:", error);
                    vscode.window.showErrorMessage(`重啟失敗: ${error instanceof Error ? error.message : String(error)}`);
                    // If restart fails, offer to enter new code
                    const retry = await vscode.window.showWarningMessage("伺服器重啟失敗，是否要輸入新的連接代碼？\n(Server restart failed. Enter new channel code?)", "輸入新代碼 (New Code)", "取消 (Cancel)");
                    if (retry === "輸入新代碼 (New Code)") {
                        return this.promptTalkToFigmaChannelConnection(true);
                    }
                    return false;
                }
            }
            else if (action === "輸入新代碼 (New Code)") {
                return this.promptTalkToFigmaChannelConnection(true);
            }
        }
        return false;
    }
    /**
     * Creates a placeholder connection for disabled servers or when MCP is globally disabled
     * @param name The server name
     * @param config The server configuration
     * @param source The source of the server (global or project)
     * @param reason The reason for creating a placeholder (mcpDisabled or serverDisabled)
     * @returns A placeholder DisconnectedMcpConnection object
     */
    createPlaceholderConnection(name, config, source, reason) {
        return {
            type: "disconnected",
            server: {
                name,
                config: JSON.stringify(config),
                status: "disconnected",
                disabled: reason === DisableReason.SERVER_DISABLED ? true : config.disabled,
                source,
                projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
                errorHistory: [],
            },
            client: null,
            transport: null,
        };
    }
    /**
     * Checks if MCP is globally enabled
     * @returns Promise<boolean> indicating if MCP is enabled
     */
    async isMcpEnabled() {
        const provider = this.providerRef.deref();
        if (!provider) {
            return true; // Default to enabled if provider is not available
        }
        const state = await provider.getState();
        return state.mcpEnabled ?? true;
    }
    async connectToServer(name, config, source = "global") {
        // Remove existing connection if it exists with the same source
        await this.deleteConnection(name, source);
        // Register the sanitized name for O(1) lookup
        const sanitizedName = sanitizeMcpName(name);
        this.sanitizedNameRegistry.set(sanitizedName, name);
        // Check if MCP is globally enabled
        const mcpEnabled = await this.isMcpEnabled();
        if (!mcpEnabled) {
            // Still create a connection object to track the server, but don't actually connect
            const connection = this.createPlaceholderConnection(name, config, source, DisableReason.MCP_DISABLED);
            this.connections.push(connection);
            return;
        }
        // Skip connecting to disabled servers
        if (config.disabled) {
            // Still create a connection object to track the server, but don't actually connect
            const connection = this.createPlaceholderConnection(name, config, source, DisableReason.SERVER_DISABLED);
            this.connections.push(connection);
            return;
        }
        // Set up file watchers for enabled servers
        this.setupFileWatcher(name, config, source);
        try {
            const client = new Client({
                name: "Roo Code",
                version: this.providerRef.deref()?.context.extension?.packageJSON?.version ?? "1.0.0",
            }, {
                capabilities: {},
            });
            let transport;
            // Inject variables to the config (environment, magic variables,...)
            const configInjected = (await injectVariables(config, {
                env: process.env,
                workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
            }));
            if (configInjected.type === "stdio") {
                // On Windows, wrap commands with cmd.exe to handle non-exe executables like npx.ps1
                // This is necessary for node version managers (fnm, nvm-windows, volta) that implement
                // commands as PowerShell scripts rather than executables.
                // Note: This adds a small overhead as commands go through an additional shell layer.
                const isWindows = process.platform === "win32";
                // Check if command is already cmd.exe to avoid double-wrapping
                const isAlreadyWrapped = configInjected.command.toLowerCase() === "cmd.exe" || configInjected.command.toLowerCase() === "cmd";
                const command = isWindows && !isAlreadyWrapped ? "cmd.exe" : configInjected.command;
                const args = isWindows && !isAlreadyWrapped
                    ? ["/c", configInjected.command, ...(configInjected.args || [])]
                    : configInjected.args;
                transport = new StdioClientTransport({
                    command,
                    args,
                    cwd: configInjected.cwd,
                    env: {
                        ...getDefaultEnvironment(),
                        ...(configInjected.env || {}),
                    },
                    stderr: "pipe",
                });
                // Set up stdio specific error handling
                transport.onerror = async (error) => {
                    console.error(`Transport error for "${name}":`, error);
                    const connection = this.findConnection(name, source);
                    if (connection) {
                        connection.server.status = "disconnected";
                        this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`);
                    }
                    await this.notifyWebviewOfServerChanges();
                    // Schedule auto-reconnect
                    this.scheduleAutoReconnect(name, source);
                };
                transport.onclose = async () => {
                    const connection = this.findConnection(name, source);
                    if (connection) {
                        connection.server.status = "disconnected";
                    }
                    await this.notifyWebviewOfServerChanges();
                    // Schedule auto-reconnect
                    this.scheduleAutoReconnect(name, source);
                };
                // transport.stderr is only available after the process has been started. However we can't start it separately from the .connect() call because it also starts the transport. And we can't place this after the connect call since we need to capture the stderr stream before the connection is established, in order to capture errors during the connection process.
                // As a workaround, we start the transport ourselves, and then monkey-patch the start method to no-op so that .connect() doesn't try to start it again.
                await transport.start();
                const stderrStream = transport.stderr;
                if (stderrStream) {
                    stderrStream.on("data", async (data) => {
                        const output = data.toString();
                        // Check if output contains INFO level log (without ERROR)
                        const hasInfo = /INFO/i.test(output);
                        const hasError = /ERROR/i.test(output);
                        if (hasInfo && !hasError) {
                            // Log normal informational messages
                            console.log(`Server "${name}" info:`, output);
                        }
                        else {
                            // Treat as error log (includes ERROR or no INFO)
                            console.error(`Server "${name}" stderr:`, output);
                            const connection = this.findConnection(name, source);
                            if (connection) {
                                this.appendErrorMessage(connection, output);
                                if (connection.server.status === "disconnected") {
                                    await this.notifyWebviewOfServerChanges();
                                }
                            }
                        }
                        // Check for TalkToFigma connection errors in ANY output (info or stderr)
                        // Only trigger error handling if we HAD previously connected to a channel
                        // "Please join a channel" before connection is NOT an error
                        if (name === "TalkToFigma" && this.figmaChannelConnected) {
                            const lowerOutput = output.toLowerCase();
                            // These patterns indicate a real disconnection AFTER being connected
                            const isFigmaConnectionError = lowerOutput.includes("disconnected from channel") ||
                                lowerOutput.includes("disconnected from figma") ||
                                lowerOutput.includes("left channel") ||
                                lowerOutput.includes("channel closed") ||
                                lowerOutput.includes("websocket closed") ||
                                lowerOutput.includes("connection lost") ||
                                lowerOutput.includes("socket closed") ||
                                lowerOutput.includes("socket error") ||
                                lowerOutput.includes("aggregateerror") ||
                                lowerOutput.includes("econnrefused") ||
                                lowerOutput.includes("connection error") ||
                                lowerOutput.includes("connection refused");
                            if (isFigmaConnectionError && !this.figmaErrorPromptPending) {
                                console.log("[McpHub] TalkToFigma disconnection detected:", output);
                                this.figmaErrorPromptPending = true;
                                // Trigger reconnection prompt (with debounce to prevent multiple prompts)
                                setTimeout(() => {
                                    this.handleFigmaConnectionError(output).finally(() => {
                                        this.figmaErrorPromptPending = false;
                                    });
                                }, 500);
                            }
                        }
                    });
                }
                else {
                    console.error(`No stderr stream for ${name}`);
                }
            }
            else if (configInjected.type === "streamable-http") {
                // Streamable HTTP connection
                transport = new StreamableHTTPClientTransport(new URL(configInjected.url), {
                    requestInit: {
                        headers: configInjected.headers,
                    },
                });
                // Set up Streamable HTTP specific error handling
                transport.onerror = async (error) => {
                    console.error(`Transport error for "${name}" (streamable-http):`, error);
                    const connection = this.findConnection(name, source);
                    if (connection) {
                        connection.server.status = "disconnected";
                        this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`);
                    }
                    await this.notifyWebviewOfServerChanges();
                    // Schedule auto-reconnect
                    this.scheduleAutoReconnect(name, source);
                };
                transport.onclose = async () => {
                    const connection = this.findConnection(name, source);
                    if (connection) {
                        connection.server.status = "disconnected";
                    }
                    await this.notifyWebviewOfServerChanges();
                    // Schedule auto-reconnect
                    this.scheduleAutoReconnect(name, source);
                };
            }
            else if (configInjected.type === "sse") {
                // SSE connection
                const sseOptions = {
                    requestInit: {
                        headers: configInjected.headers,
                    },
                };
                // Configure ReconnectingEventSource options
                const reconnectingEventSourceOptions = {
                    max_retry_time: 5000, // Maximum retry time in milliseconds
                    withCredentials: configInjected.headers?.["Authorization"] ? true : false, // Enable credentials if Authorization header exists
                    fetch: (url, init) => {
                        const headers = new Headers({ ...(init?.headers || {}), ...(configInjected.headers || {}) });
                        return fetch(url, {
                            ...init,
                            headers,
                        });
                    },
                };
                global.EventSource = ReconnectingEventSource;
                transport = new SSEClientTransport(new URL(configInjected.url), {
                    ...sseOptions,
                    eventSourceInit: reconnectingEventSourceOptions,
                });
                // Set up SSE specific error handling
                transport.onerror = async (error) => {
                    console.error(`Transport error for "${name}":`, error);
                    const connection = this.findConnection(name, source);
                    if (connection) {
                        connection.server.status = "disconnected";
                        this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`);
                    }
                    await this.notifyWebviewOfServerChanges();
                    // Schedule auto-reconnect
                    this.scheduleAutoReconnect(name, source);
                };
                transport.onclose = async () => {
                    const connection = this.findConnection(name, source);
                    if (connection) {
                        connection.server.status = "disconnected";
                    }
                    await this.notifyWebviewOfServerChanges();
                    // Schedule auto-reconnect
                    this.scheduleAutoReconnect(name, source);
                };
            }
            else {
                // Should not happen if validateServerConfig is correct
                throw new Error(`Unsupported MCP server type: ${configInjected.type}`);
            }
            // Only override transport.start for stdio transports that have already been started
            if (configInjected.type === "stdio") {
                transport.start = async () => { };
            }
            // Create a connected connection
            const connection = {
                type: "connected",
                server: {
                    name,
                    config: JSON.stringify(configInjected),
                    status: "connecting",
                    disabled: configInjected.disabled,
                    source,
                    projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
                    errorHistory: [],
                },
                client,
                transport,
            };
            this.connections.push(connection);
            // Connect (this will automatically start the transport)
            await client.connect(transport);
            connection.server.status = "connected";
            connection.server.error = "";
            connection.server.instructions = client.getInstructions();
            // Reset reconnect attempts on successful connection
            this.resetReconnectAttempts(name, source);
            // Initial fetch of tools and resources
            connection.server.tools = await this.fetchToolsList(name, source);
            connection.server.resources = await this.fetchResourcesList(name, source);
            connection.server.resourceTemplates = await this.fetchResourceTemplatesList(name, source);
        }
        catch (error) {
            // Update status with error
            const connection = this.findConnection(name, source);
            if (connection) {
                connection.server.status = "disconnected";
                this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`);
            }
            throw error;
        }
    }
    appendErrorMessage(connection, error, level = "error") {
        const MAX_ERROR_LENGTH = 1000;
        const truncatedError = error.length > MAX_ERROR_LENGTH
            ? `${error.substring(0, MAX_ERROR_LENGTH)}...(error message truncated)`
            : error;
        // Add to error history
        if (!connection.server.errorHistory) {
            connection.server.errorHistory = [];
        }
        connection.server.errorHistory.push({
            message: truncatedError,
            timestamp: Date.now(),
            level,
        });
        // Keep only the last 100 errors
        if (connection.server.errorHistory.length > 100) {
            connection.server.errorHistory = connection.server.errorHistory.slice(-100);
        }
        // Update current error display
        connection.server.error = truncatedError;
    }
    /**
     * Schedule an auto-reconnect for a disconnected server
     * Uses exponential backoff to prevent overwhelming the server
     */
    scheduleAutoReconnect(name, source) {
        // Don't reconnect if disposed
        if (this.isDisposed) {
            return;
        }
        const key = `${name}-${source}`;
        // Clear any existing reconnect timer
        const existingTimer = this.reconnectTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        // Get current attempt count
        const attempts = this.reconnectAttempts.get(key) || 0;
        // Calculate delay with exponential backoff (2s, 4s, 8s, ... up to 30s)
        const delay = Math.min(McpHub.BASE_RECONNECT_DELAY * Math.pow(2, attempts), McpHub.MAX_RECONNECT_DELAY);
        console.log(`[McpHub] Scheduling auto-reconnect for "${name}" in ${delay}ms (attempt ${attempts + 1})`);
        const timer = setTimeout(async () => {
            // Don't reconnect if disposed
            if (this.isDisposed) {
                return;
            }
            // Check if server still exists and is disconnected
            const connection = this.findConnection(name, source);
            if (!connection) {
                console.log(`[McpHub] Server "${name}" no longer exists, cancelling reconnect`);
                this.reconnectAttempts.delete(key);
                return;
            }
            if (connection.server.status === "connected") {
                console.log(`[McpHub] Server "${name}" already connected, cancelling reconnect`);
                this.reconnectAttempts.delete(key);
                return;
            }
            if (connection.server.disabled) {
                console.log(`[McpHub] Server "${name}" is disabled, cancelling reconnect`);
                this.reconnectAttempts.delete(key);
                return;
            }
            // Increment attempt counter
            this.reconnectAttempts.set(key, attempts + 1);
            try {
                console.log(`[McpHub] Auto-reconnecting to "${name}"...`);
                // Read config from the connection BEFORE deleting
                const config = JSON.parse(connection.server.config);
                const validatedConfig = this.validateServerConfig(config, name);
                // Close the old transport/client but keep server info for retry
                try {
                    if (connection.type === "connected") {
                        await connection.transport.close().catch(() => { });
                        await connection.client.close().catch(() => { });
                    }
                }
                catch {
                    // Ignore close errors
                }
                // Remove from connections array
                this.connections = this.connections.filter((conn) => !(conn.server.name === name && conn.server.source === source));
                // Try to connect
                await this.connectToServer(name, validatedConfig, source);
                // Success - reset attempt counter
                this.reconnectAttempts.delete(key);
                console.log(`[McpHub] Auto-reconnect to "${name}" successful`);
            }
            catch (error) {
                console.error(`[McpHub] Auto-reconnect to "${name}" failed:`, error);
                // Re-add a placeholder connection so findConnection works for next retry
                const existingConnection = this.findConnection(name, source);
                if (!existingConnection) {
                    // Create a placeholder disconnected connection
                    const config = connection.server.config;
                    this.connections.push({
                        type: "disconnected",
                        server: {
                            name,
                            config,
                            status: "disconnected",
                            error: error instanceof Error ? error.message : String(error),
                            source,
                        },
                        client: null,
                        transport: null,
                    });
                    await this.notifyWebviewOfServerChanges();
                }
                // Schedule another reconnect attempt
                this.scheduleAutoReconnect(name, source);
            }
        }, delay);
        this.reconnectTimers.set(key, timer);
    }
    /**
     * Reset reconnect attempts for a server (called on successful manual reconnect)
     */
    resetReconnectAttempts(name, source) {
        const key = `${name}-${source}`;
        this.reconnectAttempts.delete(key);
        const timer = this.reconnectTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(key);
        }
    }
    /**
     * Helper method to find a connection by server name and source
     * @param serverName The name of the server to find
     * @param source Optional source to filter by (global or project)
     * @returns The matching connection or undefined if not found
     */
    findConnection(serverName, source) {
        // If source is specified, only find servers with that source
        if (source !== undefined) {
            return this.connections.find((conn) => conn.server.name === serverName && conn.server.source === source);
        }
        // If no source is specified, first look for project servers, then global servers
        // This ensures that when servers have the same name, project servers are prioritized
        const projectConn = this.connections.find((conn) => conn.server.name === serverName && conn.server.source === "project");
        if (projectConn)
            return projectConn;
        // If no project server is found, look for global servers
        return this.connections.find((conn) => conn.server.name === serverName && (conn.server.source === "global" || !conn.server.source));
    }
    /**
     * Find a connection by sanitized server name.
     * This is used when parsing MCP tool responses where the server name has been
     * sanitized (e.g., hyphens replaced with underscores) for API compliance.
     * @param sanitizedServerName The sanitized server name from the API tool call
     * @returns The original server name if found, or null if no match
     */
    findServerNameBySanitizedName(sanitizedServerName) {
        const exactMatch = this.connections.find((conn) => conn.server.name === sanitizedServerName);
        if (exactMatch) {
            return exactMatch.server.name;
        }
        return this.sanitizedNameRegistry.get(sanitizedServerName) ?? null;
    }
    async fetchToolsList(serverName, source) {
        try {
            // Use the helper method to find the connection
            const connection = this.findConnection(serverName, source);
            if (!connection || connection.type !== "connected") {
                return [];
            }
            const response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema);
            // Determine the actual source of the server
            const actualSource = connection.server.source || "global";
            let configPath;
            let alwaysAllowConfig = [];
            let disabledToolsList = [];
            // Read from the appropriate config file based on the actual source
            try {
                let serverConfigData = {};
                if (actualSource === "project") {
                    // Get project MCP config path
                    const projectMcpPath = await this.getProjectMcpPath();
                    if (projectMcpPath) {
                        configPath = projectMcpPath;
                        const content = await fs.readFile(configPath, "utf-8");
                        serverConfigData = JSON.parse(content);
                    }
                }
                else {
                    // Get global MCP settings path
                    configPath = await this.getMcpSettingsFilePath();
                    const content = await fs.readFile(configPath, "utf-8");
                    serverConfigData = JSON.parse(content);
                }
                if (serverConfigData) {
                    alwaysAllowConfig = serverConfigData.mcpServers?.[serverName]?.alwaysAllow || [];
                    disabledToolsList = serverConfigData.mcpServers?.[serverName]?.disabledTools || [];
                }
            }
            catch (error) {
                console.error(`Failed to read tool configuration for ${serverName}:`, error);
                // Continue with empty configs
            }
            // Mark tools as always allowed and enabled for prompt based on settings
            const tools = (response?.tools || []).map((tool) => ({
                ...tool,
                alwaysAllow: alwaysAllowConfig.includes(tool.name),
                enabledForPrompt: !disabledToolsList.includes(tool.name),
            }));
            return tools;
        }
        catch (error) {
            console.error(`Failed to fetch tools for ${serverName}:`, error);
            return [];
        }
    }
    async fetchResourcesList(serverName, source) {
        try {
            const connection = this.findConnection(serverName, source);
            if (!connection || connection.type !== "connected") {
                return [];
            }
            const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema);
            return response?.resources || [];
        }
        catch (error) {
            // console.error(`Failed to fetch resources for ${serverName}:`, error)
            return [];
        }
    }
    async fetchResourceTemplatesList(serverName, source) {
        try {
            const connection = this.findConnection(serverName, source);
            if (!connection || connection.type !== "connected") {
                return [];
            }
            const response = await connection.client.request({ method: "resources/templates/list" }, ListResourceTemplatesResultSchema);
            return response?.resourceTemplates || [];
        }
        catch (error) {
            // console.error(`Failed to fetch resource templates for ${serverName}:`, error)
            return [];
        }
    }
    async deleteConnection(name, source) {
        // Clean up file watchers for this server
        this.removeFileWatchersForServer(name);
        // If source is provided, only delete connections from that source
        const connections = source
            ? this.connections.filter((conn) => conn.server.name === name && conn.server.source === source)
            : this.connections.filter((conn) => conn.server.name === name);
        for (const connection of connections) {
            try {
                if (connection.type === "connected") {
                    // For TalkToFigma, try to access the underlying process and kill it forcefully
                    if (name === "TalkToFigma") {
                        try {
                            // Try to kill the process more forcefully
                            const transport = connection.transport;
                            if (transport._process) {
                                console.log(`[McpHub] Killing TalkToFigma process (pid: ${transport._process.pid})`);
                                transport._process.kill("SIGKILL");
                            }
                            else if (transport.process) {
                                console.log(`[McpHub] Killing TalkToFigma process (pid: ${transport.process.pid})`);
                                transport.process.kill("SIGKILL");
                            }
                        }
                        catch (killError) {
                            console.log(`[McpHub] Could not access TalkToFigma process for forceful kill:`, killError);
                        }
                    }
                    await connection.transport.close();
                    await connection.client.close();
                }
            }
            catch (error) {
                console.error(`Failed to close transport for ${name}:`, error);
            }
        }
        // Remove the connections from the array
        this.connections = this.connections.filter((conn) => {
            if (conn.server.name !== name)
                return true;
            if (source && conn.server.source !== source)
                return true;
            return false;
        });
        // Remove from sanitized name registry if no more connections with this name exist
        const remainingConnections = this.connections.filter((conn) => conn.server.name === name);
        if (remainingConnections.length === 0) {
            const sanitizedName = sanitizeMcpName(name);
            this.sanitizedNameRegistry.delete(sanitizedName);
        }
    }
    async updateServerConnections(newServers, source = "global", manageConnectingState = true) {
        if (manageConnectingState) {
            this.isConnecting = true;
        }
        this.removeAllFileWatchers();
        // Filter connections by source
        const currentConnections = this.connections.filter((conn) => conn.server.source === source || (!conn.server.source && source === "global"));
        const currentNames = new Set(currentConnections.map((conn) => conn.server.name));
        const newNames = new Set(Object.keys(newServers));
        // Delete removed servers
        for (const name of currentNames) {
            if (!newNames.has(name)) {
                await this.deleteConnection(name, source);
            }
        }
        // Update or add servers
        for (const [name, config] of Object.entries(newServers)) {
            // Only consider connections that match the current source
            const currentConnection = this.findConnection(name, source);
            // Validate and transform the config
            let validatedConfig;
            try {
                validatedConfig = this.validateServerConfig(config, name);
            }
            catch (error) {
                this.showErrorMessage(`Invalid configuration for MCP server "${name}"`, error);
                continue;
            }
            if (!currentConnection) {
                // New server
                try {
                    // Only setup file watcher for enabled servers
                    if (!validatedConfig.disabled) {
                        this.setupFileWatcher(name, validatedConfig, source);
                    }
                    await this.connectToServer(name, validatedConfig, source);
                }
                catch (error) {
                    this.showErrorMessage(`Failed to connect to new MCP server ${name}`, error);
                }
            }
            else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
                // Existing server with changed config
                try {
                    // Only setup file watcher for enabled servers
                    if (!validatedConfig.disabled) {
                        this.setupFileWatcher(name, validatedConfig, source);
                    }
                    await this.deleteConnection(name, source);
                    await this.connectToServer(name, validatedConfig, source);
                }
                catch (error) {
                    this.showErrorMessage(`Failed to reconnect MCP server ${name}`, error);
                }
            }
            // If server exists with same config, do nothing
        }
        await this.notifyWebviewOfServerChanges();
        if (manageConnectingState) {
            this.isConnecting = false;
        }
    }
    setupFileWatcher(name, config, source = "global") {
        // Initialize an empty array for this server if it doesn't exist
        if (!this.fileWatchers.has(name)) {
            this.fileWatchers.set(name, []);
        }
        const watchers = this.fileWatchers.get(name) || [];
        // Only stdio type has args
        if (config.type === "stdio") {
            // Setup watchers for custom watchPaths if defined
            if (config.watchPaths && config.watchPaths.length > 0) {
                const watchPathsWatcher = chokidar.watch(config.watchPaths, {
                // persistent: true,
                // ignoreInitial: true,
                // awaitWriteFinish: true,
                });
                watchPathsWatcher.on("change", async (changedPath) => {
                    try {
                        // Pass the source from the config to restartConnection
                        await this.restartConnection(name, source);
                    }
                    catch (error) {
                        console.error(`Failed to restart server ${name} after change in ${changedPath}:`, error);
                    }
                });
                watchers.push(watchPathsWatcher);
            }
            // Also setup the fallback build/index.js watcher if applicable
            const filePath = config.args?.find((arg) => arg.includes("build/index.js"));
            if (filePath) {
                // we use chokidar instead of onDidSaveTextDocument because it doesn't require the file to be open in the editor
                const indexJsWatcher = chokidar.watch(filePath, {
                // persistent: true,
                // ignoreInitial: true,
                // awaitWriteFinish: true, // This helps with atomic writes
                });
                indexJsWatcher.on("change", async () => {
                    try {
                        // Pass the source from the config to restartConnection
                        await this.restartConnection(name, source);
                    }
                    catch (error) {
                        console.error(`Failed to restart server ${name} after change in ${filePath}:`, error);
                    }
                });
                watchers.push(indexJsWatcher);
            }
            // Update the fileWatchers map with all watchers for this server
            if (watchers.length > 0) {
                this.fileWatchers.set(name, watchers);
            }
        }
    }
    removeAllFileWatchers() {
        this.fileWatchers.forEach((watchers) => watchers.forEach((watcher) => watcher.close()));
        this.fileWatchers.clear();
    }
    removeFileWatchersForServer(serverName) {
        const watchers = this.fileWatchers.get(serverName);
        if (watchers) {
            watchers.forEach((watcher) => watcher.close());
            this.fileWatchers.delete(serverName);
        }
    }
    async restartConnection(serverName, source) {
        this.isConnecting = true;
        // Check if MCP is globally enabled
        const mcpEnabled = await this.isMcpEnabled();
        if (!mcpEnabled) {
            this.isConnecting = false;
            return;
        }
        // Special handling for built-in figma-write server
        if (serverName === "figma-write") {
            vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }));
            // Reset Figma channel connection state
            this.resetFigmaChannelConnection();
            await delay(500);
            // Delete existing connection first
            await this.deleteConnection(serverName, source);
            // Re-initialize the built-in server
            const provider = this.providerRef.deref();
            if (provider) {
                await this.initializeBuiltInFigmaWriteServer(provider);
            }
            await this.notifyWebviewOfServerChanges();
            this.isConnecting = false;
            return;
        }
        // Special handling for built-in TalkToFigma server
        if (serverName === "TalkToFigma") {
            vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }));
            // Reset Figma channel connection state
            this.resetFigmaChannelConnection();
            // Reset initialization tracking to allow re-initialization
            this.talkToFigmaInitializing = false;
            this.lastTalkToFigmaInitTime = 0;
            // Delete existing connection first - this should kill the process
            await this.deleteConnection(serverName, source);
            // Wait longer for the process to fully terminate and release the port
            await delay(3000);
            // Re-initialize with retry for EADDRINUSE
            const maxRetries = 3;
            let lastError;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    console.log(`[McpHub] Attempting to restart TalkToFigma (attempt ${attempt}/${maxRetries})`);
                    await this.initializeBuiltInTalkToFigmaServer();
                    await this.notifyWebviewOfServerChanges();
                    this.isConnecting = false;
                    return;
                }
                catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    console.error(`[McpHub] TalkToFigma restart attempt ${attempt} failed:`, error);
                    if (attempt < maxRetries && lastError.message.includes("EADDRINUSE")) {
                        // Wait longer between retries (exponential backoff)
                        const waitTime = 2000 * attempt;
                        console.log(`[McpHub] Waiting ${waitTime}ms before retry...`);
                        await delay(waitTime);
                    }
                }
            }
            // All retries failed
            vscode.window.showErrorMessage(`TalkToFigma 伺服器重啟失敗: ${lastError?.message || "Unknown error"}`);
            this.isConnecting = false;
            return;
        }
        // Get existing connection and update its status
        const connection = this.findConnection(serverName, source);
        const config = connection?.server.config;
        if (config) {
            vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }));
            connection.server.status = "connecting";
            connection.server.error = "";
            await this.notifyWebviewOfServerChanges();
            await delay(500); // artificial delay to show user that server is restarting
            try {
                await this.deleteConnection(serverName, connection.server.source);
                // Parse the config to validate it
                const parsedConfig = JSON.parse(config);
                try {
                    // Validate the config
                    const validatedConfig = this.validateServerConfig(parsedConfig, serverName);
                    // Try to connect again using validated config
                    await this.connectToServer(serverName, validatedConfig, connection.server.source || "global");
                    vscode.window.showInformationMessage(t("mcp:info.server_connected", { serverName }));
                }
                catch (validationError) {
                    this.showErrorMessage(`Invalid configuration for MCP server "${serverName}"`, validationError);
                }
            }
            catch (error) {
                this.showErrorMessage(`Failed to restart ${serverName} MCP server connection`, error);
            }
        }
        await this.notifyWebviewOfServerChanges();
        this.isConnecting = false;
    }
    async refreshAllConnections() {
        if (this.isConnecting) {
            return;
        }
        // Check if MCP is globally enabled
        const mcpEnabled = await this.isMcpEnabled();
        if (!mcpEnabled) {
            // Clear all existing connections
            const existingConnections = [...this.connections];
            for (const conn of existingConnections) {
                await this.deleteConnection(conn.server.name, conn.server.source);
            }
            // Still initialize servers to track them, but they won't connect
            await this.initializeMcpServers("global");
            await this.initializeMcpServers("project");
            await this.notifyWebviewOfServerChanges();
            return;
        }
        this.isConnecting = true;
        try {
            const globalPath = await this.getMcpSettingsFilePath();
            let globalServers = {};
            try {
                const globalContent = await fs.readFile(globalPath, "utf-8");
                const globalConfig = JSON.parse(globalContent);
                globalServers = globalConfig.mcpServers || {};
                const globalServerNames = Object.keys(globalServers);
            }
            catch (error) {
                console.log("Error reading global MCP config:", error);
            }
            const projectPath = await this.getProjectMcpPath();
            let projectServers = {};
            if (projectPath) {
                try {
                    const projectContent = await fs.readFile(projectPath, "utf-8");
                    const projectConfig = JSON.parse(projectContent);
                    projectServers = projectConfig.mcpServers || {};
                    const projectServerNames = Object.keys(projectServers);
                }
                catch (error) {
                    console.log("Error reading project MCP config:", error);
                }
            }
            // Clear all existing connections first
            const existingConnections = [...this.connections];
            for (const conn of existingConnections) {
                await this.deleteConnection(conn.server.name, conn.server.source);
            }
            // Reset TalkToFigma initialization tracking
            this.talkToFigmaInitializing = false;
            this.lastTalkToFigmaInitTime = 0;
            this.resetFigmaChannelConnection();
            // Wait for processes to fully terminate and release ports
            await delay(3000);
            // Re-initialize all servers from scratch
            // This ensures proper initialization including fetching tools, resources, etc.
            await this.initializeMcpServers("global");
            await this.initializeMcpServers("project");
            // Re-initialize built-in servers if not already configured
            const provider = this.providerRef.deref();
            if (provider) {
                await this.initializeBuiltInFigmaWriteServer(provider);
            }
            await this.initializeBuiltInTalkToFigmaServer();
            await delay(100);
            await this.notifyWebviewOfServerChanges();
        }
        catch (error) {
            this.showErrorMessage("Failed to refresh MCP servers", error);
        }
        finally {
            this.isConnecting = false;
        }
    }
    async notifyWebviewOfServerChanges() {
        // Get global server order from settings file
        const settingsPath = await this.getMcpSettingsFilePath();
        const content = await fs.readFile(settingsPath, "utf-8");
        const config = JSON.parse(content);
        const globalServerOrder = Object.keys(config.mcpServers || {});
        // Get project server order if available
        const projectMcpPath = await this.getProjectMcpPath();
        let projectServerOrder = [];
        if (projectMcpPath) {
            try {
                const projectContent = await fs.readFile(projectMcpPath, "utf-8");
                const projectConfig = JSON.parse(projectContent);
                projectServerOrder = Object.keys(projectConfig.mcpServers || {});
            }
            catch (error) {
                // Silently continue with empty project server order
            }
        }
        // Sort connections: first project servers in their defined order, then global servers in their defined order
        // This ensures that when servers have the same name, project servers are prioritized
        const sortedConnections = [...this.connections].sort((a, b) => {
            const aIsGlobal = a.server.source === "global" || !a.server.source;
            const bIsGlobal = b.server.source === "global" || !b.server.source;
            // If both are global or both are project, sort by their respective order
            if (aIsGlobal && bIsGlobal) {
                const indexA = globalServerOrder.indexOf(a.server.name);
                const indexB = globalServerOrder.indexOf(b.server.name);
                return indexA - indexB;
            }
            else if (!aIsGlobal && !bIsGlobal) {
                const indexA = projectServerOrder.indexOf(a.server.name);
                const indexB = projectServerOrder.indexOf(b.server.name);
                return indexA - indexB;
            }
            // Project servers come before global servers (reversed from original)
            return aIsGlobal ? 1 : -1;
        });
        // Send sorted servers to webview
        const targetProvider = this.providerRef.deref();
        if (targetProvider) {
            const serversToSend = sortedConnections.map((connection) => connection.server);
            const message = {
                type: "mcpServers",
                mcpServers: serversToSend,
            };
            try {
                await targetProvider.postMessageToWebview(message);
            }
            catch (error) {
                console.error("[McpHub] Error calling targetProvider.postMessageToWebview:", error);
            }
        }
        else {
            console.error("[McpHub] No target provider available (neither from getInstance nor providerRef) - cannot send mcpServers message to webview");
        }
    }
    async toggleServerDisabled(serverName, disabled, source) {
        try {
            // Find the connection to determine if it's a global or project server
            const connection = this.findConnection(serverName, source);
            if (!connection) {
                throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`);
            }
            const serverSource = connection.server.source || "global";
            // Update the server config in the appropriate file
            await this.updateServerConfig(serverName, { disabled }, serverSource);
            // Update the connection object
            if (connection) {
                try {
                    connection.server.disabled = disabled;
                    // If disabling a connected server, disconnect it
                    if (disabled && connection.server.status === "connected") {
                        // Clean up file watchers when disabling
                        this.removeFileWatchersForServer(serverName);
                        await this.deleteConnection(serverName, serverSource);
                        // Re-add as a disabled connection
                        // Re-read config from file to get updated disabled state
                        const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource);
                        await this.connectToServer(serverName, updatedConfig, serverSource);
                    }
                    else if (!disabled && connection.server.status === "disconnected") {
                        // If enabling a disabled server, connect it
                        // Re-read config from file to get updated disabled state
                        const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource);
                        await this.deleteConnection(serverName, serverSource);
                        // When re-enabling, file watchers will be set up in connectToServer
                        await this.connectToServer(serverName, updatedConfig, serverSource);
                    }
                    else if (connection.server.status === "connected") {
                        // Only refresh capabilities if connected
                        connection.server.tools = await this.fetchToolsList(serverName, serverSource);
                        connection.server.resources = await this.fetchResourcesList(serverName, serverSource);
                        connection.server.resourceTemplates = await this.fetchResourceTemplatesList(serverName, serverSource);
                    }
                }
                catch (error) {
                    console.error(`Failed to refresh capabilities for ${serverName}:`, error);
                }
            }
            await this.notifyWebviewOfServerChanges();
        }
        catch (error) {
            this.showErrorMessage(`Failed to update server ${serverName} state`, error);
            throw error;
        }
    }
    /**
     * Helper method to read a server's configuration from the appropriate settings file
     * @param serverName The name of the server to read
     * @param source Whether to read from the global or project config
     * @returns The validated server configuration
     */
    async readServerConfigFromFile(serverName, source = "global") {
        // Determine which config file to read
        let configPath;
        if (source === "project") {
            const projectMcpPath = await this.getProjectMcpPath();
            if (!projectMcpPath) {
                throw new Error("Project MCP configuration file not found");
            }
            configPath = projectMcpPath;
        }
        else {
            configPath = await this.getMcpSettingsFilePath();
        }
        // Ensure the settings file exists and is accessible
        try {
            await fs.access(configPath);
        }
        catch (error) {
            console.error("Settings file not accessible:", error);
            throw new Error("Settings file not accessible");
        }
        // Read and parse the config file
        const content = await fs.readFile(configPath, "utf-8");
        const config = JSON.parse(content);
        // Validate the config structure
        if (!config || typeof config !== "object") {
            throw new Error("Invalid config structure");
        }
        if (!config.mcpServers || typeof config.mcpServers !== "object") {
            throw new Error("No mcpServers section in config");
        }
        if (!config.mcpServers[serverName]) {
            throw new Error(`Server ${serverName} not found in config`);
        }
        // Validate and return the server config
        return this.validateServerConfig(config.mcpServers[serverName], serverName);
    }
    /**
     * Helper method to update a server's configuration in the appropriate settings file
     * @param serverName The name of the server to update
     * @param configUpdate The configuration updates to apply
     * @param source Whether to update the global or project config
     */
    async updateServerConfig(serverName, configUpdate, source = "global") {
        // Determine which config file to update
        let configPath;
        if (source === "project") {
            const projectMcpPath = await this.getProjectMcpPath();
            if (!projectMcpPath) {
                throw new Error("Project MCP configuration file not found");
            }
            configPath = projectMcpPath;
        }
        else {
            configPath = await this.getMcpSettingsFilePath();
        }
        // Ensure the settings file exists and is accessible
        try {
            await fs.access(configPath);
        }
        catch (error) {
            console.error("Settings file not accessible:", error);
            throw new Error("Settings file not accessible");
        }
        // Read and parse the config file
        const content = await fs.readFile(configPath, "utf-8");
        const config = JSON.parse(content);
        // Validate the config structure
        if (!config || typeof config !== "object") {
            throw new Error("Invalid config structure");
        }
        if (!config.mcpServers || typeof config.mcpServers !== "object") {
            config.mcpServers = {};
        }
        if (!config.mcpServers[serverName]) {
            config.mcpServers[serverName] = {};
        }
        // Create a new server config object to ensure clean structure
        const serverConfig = {
            ...config.mcpServers[serverName],
            ...configUpdate,
        };
        // Ensure required fields exist
        if (!serverConfig.alwaysAllow) {
            serverConfig.alwaysAllow = [];
        }
        config.mcpServers[serverName] = serverConfig;
        // Write the entire config back
        const updatedConfig = {
            mcpServers: config.mcpServers,
        };
        // Set flag to prevent file watcher from triggering server restart
        if (this.flagResetTimer) {
            clearTimeout(this.flagResetTimer);
        }
        this.isProgrammaticUpdate = true;
        try {
            await safeWriteJson(configPath, updatedConfig, { prettyPrint: true });
        }
        finally {
            // Reset flag after watcher debounce period (non-blocking)
            this.flagResetTimer = setTimeout(() => {
                this.isProgrammaticUpdate = false;
                this.flagResetTimer = undefined;
            }, 600);
        }
    }
    async updateServerTimeout(serverName, timeout, source) {
        try {
            // Find the connection to determine if it's a global or project server
            const connection = this.findConnection(serverName, source);
            if (!connection) {
                throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`);
            }
            // Update the server config in the appropriate file
            await this.updateServerConfig(serverName, { timeout }, connection.server.source || "global");
            await this.notifyWebviewOfServerChanges();
        }
        catch (error) {
            this.showErrorMessage(`Failed to update server ${serverName} timeout settings`, error);
            throw error;
        }
    }
    async deleteServer(serverName, source) {
        try {
            // Find the connection to determine if it's a global or project server
            const connection = this.findConnection(serverName, source);
            if (!connection) {
                throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`);
            }
            const serverSource = connection.server.source || "global";
            // Determine config file based on server source
            const isProjectServer = serverSource === "project";
            let configPath;
            if (isProjectServer) {
                // Get project MCP config path
                const projectMcpPath = await this.getProjectMcpPath();
                if (!projectMcpPath) {
                    throw new Error("Project MCP configuration file not found");
                }
                configPath = projectMcpPath;
            }
            else {
                // Get global MCP settings path
                configPath = await this.getMcpSettingsFilePath();
            }
            // Ensure the settings file exists and is accessible
            try {
                await fs.access(configPath);
            }
            catch (error) {
                throw new Error("Settings file not accessible");
            }
            const content = await fs.readFile(configPath, "utf-8");
            const config = JSON.parse(content);
            // Validate the config structure
            if (!config || typeof config !== "object") {
                throw new Error("Invalid config structure");
            }
            if (!config.mcpServers || typeof config.mcpServers !== "object") {
                config.mcpServers = {};
            }
            // Remove the server from the settings
            if (config.mcpServers[serverName]) {
                delete config.mcpServers[serverName];
                // Write the entire config back
                const updatedConfig = {
                    mcpServers: config.mcpServers,
                };
                await safeWriteJson(configPath, updatedConfig, { prettyPrint: true });
                // Update server connections with the correct source
                await this.updateServerConnections(config.mcpServers, serverSource);
                vscode.window.showInformationMessage(t("mcp:info.server_deleted", { serverName }));
            }
            else {
                vscode.window.showWarningMessage(t("mcp:info.server_not_found", { serverName }));
            }
        }
        catch (error) {
            this.showErrorMessage(`Failed to delete MCP server ${serverName}`, error);
            throw error;
        }
    }
    async readResource(serverName, uri, source) {
        const connection = this.findConnection(serverName, source);
        if (!connection || connection.type !== "connected") {
            throw new Error(`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}`);
        }
        if (connection.server.disabled) {
            throw new Error(`Server "${serverName}" is disabled`);
        }
        return await connection.client.request({
            method: "resources/read",
            params: {
                uri,
            },
        }, ReadResourceResultSchema);
    }
    async callTool(serverName, toolName, toolArguments, source) {
        const connection = this.findConnection(serverName, source);
        if (!connection || connection.type !== "connected") {
            // Check if this is a Figma server and trigger reconnection
            if (serverName === "TalkToFigma" || serverName === "figma-write") {
                console.log(`[McpHub] Figma server "${serverName}" not connected, triggering reconnection prompt`);
                await this.handleFigmaConnectionError(`Server ${serverName} not connected`);
            }
            throw new Error(`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`);
        }
        if (connection.server.disabled) {
            throw new Error(`Server "${serverName}" is disabled and cannot be used`);
        }
        let timeout;
        try {
            const parsedConfig = ServerConfigSchema.parse(JSON.parse(connection.server.config));
            timeout = (parsedConfig.timeout ?? 60) * 1000;
        }
        catch (error) {
            console.error("Failed to parse server config for timeout:", error);
            // Default to 60 seconds if parsing fails
            timeout = 60 * 1000;
        }
        // Coerce string numbers to actual numbers for Figma tools
        // LLMs often send "400" instead of 400 for numeric fields
        let processedArguments = toolArguments;
        const isFigmaServer = serverName === "TalkToFigma" || serverName === "figma-write" || serverName.toLowerCase().includes("figma");
        if (isFigmaServer && toolArguments) {
            processedArguments = this.coerceNumericArguments(toolArguments);
            // For TalkToFigma, also map tool-specific parameters (like fillColor format)
            if (serverName === "TalkToFigma") {
                processedArguments = this.mapTalkToFigmaArguments(toolName, processedArguments);
            }
        }
        // Auto-open Figma preview when AI is about to create elements
        const figmaCreationTools = [
            "create_rectangle",
            "create_frame",
            "create_text",
            "add_text",
            "create_ellipse",
            "create_line",
            "create_polygon",
            "create_star",
            "place_image_base64",
        ];
        if (isFigmaServer && figmaCreationTools.includes(toolName) && !this.figmaPreviewAutoOpened) {
            const provider = this.providerRef.deref();
            if (provider) {
                const figmaWebPreviewEnabled = provider.getValue("figmaWebPreviewEnabled");
                const figmaFileUrl = provider.getValue("figmaFileUrl");
                if (figmaWebPreviewEnabled && figmaFileUrl) {
                    console.log(`[McpHub] Auto-opening Figma preview for creation tool: ${toolName}`);
                    this.figmaPreviewAutoOpened = true;
                    // Open Figma preview panel directly
                    this.openFigmaPreviewPanel(figmaFileUrl, provider.context.extensionUri).catch((error) => {
                        console.error("[McpHub] Failed to auto-open Figma preview:", error);
                    });
                }
            }
        }
        try {
            const result = await connection.client.request({
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: processedArguments,
                },
            }, CallToolResultSchema, {
                timeout,
            });
            // Check if the result indicates a Figma connection error
            // Only trigger error handling for tool call failures, not for "please join" messages before connection
            if ((serverName === "TalkToFigma" || serverName === "figma-write") && result.content) {
                const textContent = result.content.find((c) => c.type === "text");
                if (textContent && "text" in textContent) {
                    const text = textContent.text.toLowerCase();
                    console.log(`[McpHub] Figma tool response:`, textContent.text.substring(0, 200));
                    // Check for connection error patterns in tool response
                    // These indicate the tool call failed due to connection issues
                    const isRealError = text.includes("not connected") ||
                        text.includes("disconnected") ||
                        text.includes("channel not found") ||
                        text.includes("no channel") ||
                        text.includes("join a channel") ||
                        text.includes("please join") ||
                        text.includes("not joined") ||
                        text.includes("websocket error") ||
                        text.includes("socket closed") ||
                        text.includes("connection lost") ||
                        text.includes("failed to send") ||
                        text.includes("no active connection") ||
                        text.includes("unable to send") ||
                        text.includes("connection refused") ||
                        text.includes("timeout") ||
                        (text.includes("error") && text.includes("connection"));
                    if (isRealError) {
                        console.log(`[McpHub] Figma connection error detected in response:`, textContent.text);
                        // Trigger reconnection prompt asynchronously
                        this.handleFigmaConnectionError(textContent.text).catch(console.error);
                    }
                }
            }
            // Also check if result has isError flag
            if ((serverName === "TalkToFigma" || serverName === "figma-write") && result.isError) {
                const textContent = result.content?.find((c) => c.type === "text");
                const errorText = textContent && "text" in textContent ? textContent.text : "Unknown error";
                console.log(`[McpHub] Figma tool returned error:`, errorText);
                this.handleFigmaConnectionError(errorText).catch(console.error);
            }
            return result;
        }
        catch (error) {
            // Check if this is a Figma server and the error looks like a connection issue
            if (serverName === "TalkToFigma" || serverName === "figma-write") {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.log(`[McpHub] Figma tool call failed:`, errorMessage);
                // Check for connection-related errors
                if (errorMessage.toLowerCase().includes("timeout") ||
                    errorMessage.toLowerCase().includes("disconnect") ||
                    errorMessage.toLowerCase().includes("socket") ||
                    errorMessage.toLowerCase().includes("connection") ||
                    errorMessage.toLowerCase().includes("econnrefused") ||
                    errorMessage.toLowerCase().includes("not connected")) {
                    // Trigger reconnection prompt asynchronously
                    this.handleFigmaConnectionError(errorMessage).catch(console.error);
                }
            }
            throw error;
        }
    }
    /**
     * Coerce string numbers to actual numbers in tool arguments
     * This handles common LLM mistakes where numbers are sent as strings
     */
    coerceNumericArguments(args) {
        const numericFields = [
            "width",
            "height",
            "x",
            "y",
            "fontSize",
            "opacity",
            "cornerRadius",
            "minItems",
            "r",
            "g",
            "b",
        ];
        const result = { ...args };
        for (const [key, value] of Object.entries(args)) {
            if (numericFields.includes(key) && typeof value === "string") {
                const parsed = parseFloat(value);
                if (!isNaN(parsed)) {
                    result[key] = parsed;
                }
            }
        }
        return result;
    }
    /**
     * Map arguments for TalkToFigma-specific tools
     * Handles parameter format differences like fillColor (hex string -> RGB object)
     */
    mapTalkToFigmaArguments(toolName, args) {
        const result = { ...args };
        // TalkToFigma uses 'parentId' instead of 'parent' for specifying parent frame
        if (result.parent && !result.parentId) {
            result.parentId = result.parent;
            delete result.parent;
            console.log(`[McpHub] Mapped 'parent' to 'parentId': ${result.parentId}`);
        }
        // Convert color value to RGB object - handles hex strings, JSON strings, and objects
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
                // Try parsing as JSON first (e.g., '{"r": 1, "g": 1, "b": 1}')
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
                        // Not valid JSON, try hex
                    }
                }
                // Try parsing as hex color (e.g., '#ffffff' or 'ffffff')
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
        // create_rectangle: TalkToFigma uses 'radius' instead of 'cornerRadius', 'color' instead of 'hex'
        if (toolName === "create_rectangle") {
            // Map cornerRadius to radius
            if (result.cornerRadius !== undefined && result.radius === undefined) {
                result.radius = result.cornerRadius;
                delete result.cornerRadius;
                console.log(`[McpHub] create_rectangle: Mapped cornerRadius to radius: ${result.radius}`);
            }
            // Ensure radius is a number and has minimum value
            if (typeof result.radius === "string") {
                result.radius = parseFloat(result.radius) || 8;
            }
            if (result.radius === undefined || result.radius === null || typeof result.radius !== "number" || result.radius < 8) {
                result.radius = 12; // Use 12 as default for better visibility
                console.log(`[McpHub] create_rectangle: Set default radius: ${result.radius}`);
            }
            // Map hex to color (TalkToFigma might expect RGB object)
            if (result.hex && !result.color) {
                // Try sending as hex string first, TalkToFigma may accept it
                result.color = result.hex;
                delete result.hex;
                console.log(`[McpHub] create_rectangle: Mapped hex to color: ${result.color}`);
            }
            console.log(`[McpHub] create_rectangle FINAL PARAMS:`, JSON.stringify(result));
        }
        // create_frame expects fillColor as RGB object
        if (toolName === "create_frame") {
            if (result.fillColor) {
                const rgb = toRgbObject(result.fillColor);
                if (rgb) {
                    console.log(`[McpHub] Converting fillColor to RGB object:`, rgb);
                    result.fillColor = rgb;
                }
            }
            if (result.color) {
                const rgb = toRgbObject(result.color);
                if (rgb) {
                    console.log(`[McpHub] Converting color to fillColor RGB object:`, rgb);
                    result.fillColor = rgb;
                    delete result.color;
                }
            }
            if (result.hex) {
                const rgb = toRgbObject(result.hex);
                if (rgb) {
                    console.log(`[McpHub] Converting hex to fillColor RGB object:`, rgb);
                    result.fillColor = rgb;
                    delete result.hex;
                }
            }
        }
        // create_text expects fontColor as RGB object
        if (toolName === "create_text") {
            if (result.fontColor) {
                const rgb = toRgbObject(result.fontColor);
                if (rgb) {
                    console.log(`[McpHub] Converting fontColor to RGB object:`, rgb);
                    result.fontColor = rgb;
                }
            }
            if (result.color) {
                const rgb = toRgbObject(result.color);
                if (rgb) {
                    console.log(`[McpHub] Converting color to fontColor RGB object:`, rgb);
                    result.fontColor = rgb;
                    delete result.color;
                }
            }
        }
        // set_fill_color, set_fill, set_text_color expect r, g, b as separate number parameters
        if (toolName === "set_fill_color" || toolName === "set_fill" || toolName === "set_text_color") {
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
                console.log(`[McpHub] Extracted r, g, b from color object:`, { r: result.r, g: result.g, b: result.b });
            }
            // If color is a string (hex or JSON), convert it
            if (result.color && typeof result.color === "string") {
                const rgb = toRgbObject(result.color);
                if (rgb) {
                    result.r = rgb.r;
                    result.g = rgb.g;
                    result.b = rgb.b;
                    delete result.color;
                    console.log(`[McpHub] Converted color string to r, g, b:`, rgb);
                }
            }
            // Ensure r, g, b are numbers (coerce from string if needed)
            for (const key of ["r", "g", "b"]) {
                if (typeof result[key] === "string") {
                    const parsed = parseFloat(result[key]);
                    if (!isNaN(parsed)) {
                        result[key] = parsed;
                    }
                }
            }
        }
        // get_nodes_info expects nodeIds as array
        if (toolName === "get_nodes_info") {
            if (typeof result.nodeIds === "string") {
                // Try parsing as JSON array
                const str = result.nodeIds.trim();
                if (str.startsWith("[")) {
                    try {
                        result.nodeIds = JSON.parse(str);
                        console.log(`[McpHub] Parsed nodeIds from JSON string:`, result.nodeIds);
                    }
                    catch {
                        // If not valid JSON, split by comma
                        result.nodeIds = str.split(",").map((s) => s.trim());
                        console.log(`[McpHub] Split nodeIds by comma:`, result.nodeIds);
                    }
                }
                else {
                    // Single node ID or comma-separated
                    result.nodeIds = str.split(",").map((s) => s.trim());
                    console.log(`[McpHub] Split nodeIds by comma:`, result.nodeIds);
                }
            }
        }
        // get_node_info - check if nodeId comes under different key
        if (toolName === "get_node_info") {
            if (result.nodeId === undefined) {
                // Try alternative parameter names
                if (result.id) {
                    result.nodeId = result.id;
                    delete result.id;
                    console.log(`[McpHub] Renamed 'id' to 'nodeId':`, result.nodeId);
                }
                else if (result.node_id) {
                    result.nodeId = result.node_id;
                    delete result.node_id;
                    console.log(`[McpHub] Renamed 'node_id' to 'nodeId':`, result.nodeId);
                }
            }
        }
        // set_corner_radius - Handle different parameter names between figma-write and TalkToFigma
        if (toolName === "set_corner_radius") {
            // Get the radius value from any available parameter
            let radiusValue = 8;
            const rawRadius = result.radius ?? result.cornerRadius;
            if (typeof rawRadius === "string") {
                radiusValue = parseFloat(rawRadius) || 8;
            }
            else if (typeof rawRadius === "number") {
                radiusValue = rawRadius;
            }
            // Ensure minimum visibility
            if (radiusValue < 8) {
                radiusValue = 8;
            }
            // Send BOTH uniform radius AND per-corner parameters for maximum compatibility
            result.radius = radiusValue;
            result.cornerRadius = radiusValue;
            result.topLeft = radiusValue;
            result.topRight = radiusValue;
            result.bottomRight = radiusValue;
            result.bottomLeft = radiusValue;
            console.log(`[McpHub] set_corner_radius: radius=${radiusValue}, all corners=${radiusValue} (nodeId: ${result.nodeId})`);
        }
        return result;
    }
    /**
     * Helper method to update a specific tool list (alwaysAllow or disabledTools)
     * in the appropriate settings file.
     * @param serverName The name of the server to update
     * @param source Whether to update the global or project config
     * @param toolName The name of the tool to add or remove
     * @param listName The name of the list to modify ("alwaysAllow" or "disabledTools")
     * @param addTool Whether to add (true) or remove (false) the tool from the list
     */
    async updateServerToolList(serverName, source, toolName, listName, addTool) {
        // Find the connection with matching name and source
        const connection = this.findConnection(serverName, source);
        if (!connection) {
            throw new Error(`Server ${serverName} with source ${source} not found`);
        }
        // Determine the correct config path based on the source
        let configPath;
        if (source === "project") {
            // Get project MCP config path
            const projectMcpPath = await this.getProjectMcpPath();
            if (!projectMcpPath) {
                throw new Error("Project MCP configuration file not found");
            }
            configPath = projectMcpPath;
        }
        else {
            // Get global MCP settings path
            configPath = await this.getMcpSettingsFilePath();
        }
        // Normalize path for cross-platform compatibility
        // Use a consistent path format for both reading and writing
        const normalizedPath = process.platform === "win32" ? configPath.replace(/\\/g, "/") : configPath;
        // Read the appropriate config file
        const content = await fs.readFile(normalizedPath, "utf-8");
        const config = JSON.parse(content);
        if (!config.mcpServers) {
            config.mcpServers = {};
        }
        if (!config.mcpServers[serverName]) {
            config.mcpServers[serverName] = {
                type: "stdio",
                command: "node",
                args: [], // Default to an empty array; can be set later if needed
            };
        }
        if (!config.mcpServers[serverName][listName]) {
            config.mcpServers[serverName][listName] = [];
        }
        const targetList = config.mcpServers[serverName][listName];
        const toolIndex = targetList.indexOf(toolName);
        if (addTool && toolIndex === -1) {
            targetList.push(toolName);
        }
        else if (!addTool && toolIndex !== -1) {
            targetList.splice(toolIndex, 1);
        }
        // Set flag to prevent file watcher from triggering server restart
        if (this.flagResetTimer) {
            clearTimeout(this.flagResetTimer);
        }
        this.isProgrammaticUpdate = true;
        try {
            await safeWriteJson(normalizedPath, config, { prettyPrint: true });
        }
        finally {
            // Reset flag after watcher debounce period (non-blocking)
            this.flagResetTimer = setTimeout(() => {
                this.isProgrammaticUpdate = false;
                this.flagResetTimer = undefined;
            }, 600);
        }
        if (connection) {
            connection.server.tools = await this.fetchToolsList(serverName, source);
            await this.notifyWebviewOfServerChanges();
        }
    }
    async toggleToolAlwaysAllow(serverName, source, toolName, shouldAllow) {
        try {
            await this.updateServerToolList(serverName, source, toolName, "alwaysAllow", shouldAllow);
        }
        catch (error) {
            this.showErrorMessage(`Failed to toggle always allow for tool "${toolName}" on server "${serverName}" with source "${source}"`, error);
            throw error;
        }
    }
    async toggleToolEnabledForPrompt(serverName, source, toolName, isEnabled) {
        try {
            // When isEnabled is true, we want to remove the tool from the disabledTools list.
            // When isEnabled is false, we want to add the tool to the disabledTools list.
            const addToolToDisabledList = !isEnabled;
            await this.updateServerToolList(serverName, source, toolName, "disabledTools", addToolToDisabledList);
        }
        catch (error) {
            this.showErrorMessage(`Failed to update settings for tool ${toolName}`, error);
            throw error; // Re-throw to ensure the error is properly handled
        }
    }
    /**
     * Handles enabling/disabling MCP globally
     * @param enabled Whether MCP should be enabled or disabled
     * @returns Promise<void>
     */
    async handleMcpEnabledChange(enabled) {
        if (!enabled) {
            // If MCP is being disabled, disconnect all servers with error handling
            const existingConnections = [...this.connections];
            const disconnectionErrors = [];
            for (const conn of existingConnections) {
                try {
                    await this.deleteConnection(conn.server.name, conn.server.source);
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    disconnectionErrors.push({
                        serverName: conn.server.name,
                        error: errorMessage,
                    });
                    console.error(`Failed to disconnect MCP server ${conn.server.name}: ${errorMessage}`);
                }
            }
            // If there were errors, notify the user
            if (disconnectionErrors.length > 0) {
                const errorSummary = disconnectionErrors.map((e) => `${e.serverName}: ${e.error}`).join("\n");
                vscode.window.showWarningMessage(t("mcp:errors.disconnect_servers_partial", {
                    count: disconnectionErrors.length,
                    errors: errorSummary,
                }));
            }
            // Re-initialize servers to track them in disconnected state
            try {
                await this.refreshAllConnections();
            }
            catch (error) {
                console.error(`Failed to refresh MCP connections after disabling: ${error}`);
                vscode.window.showErrorMessage(t("mcp:errors.refresh_after_disable"));
            }
        }
        else {
            // If MCP is being enabled, reconnect all servers
            try {
                await this.refreshAllConnections();
            }
            catch (error) {
                console.error(`Failed to refresh MCP connections after enabling: ${error}`);
                vscode.window.showErrorMessage(t("mcp:errors.refresh_after_enable"));
            }
        }
    }
    async dispose() {
        // Prevent multiple disposals
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;
        // Clear all debounce timers
        for (const timer of this.configChangeDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this.configChangeDebounceTimers.clear();
        // Clear flag reset timer and reset programmatic update flag
        if (this.flagResetTimer) {
            clearTimeout(this.flagResetTimer);
            this.flagResetTimer = undefined;
        }
        // Clear all reconnect timers
        for (const timer of this.reconnectTimers.values()) {
            clearTimeout(timer);
        }
        this.reconnectTimers.clear();
        this.reconnectAttempts.clear();
        this.isProgrammaticUpdate = false;
        this.removeAllFileWatchers();
        for (const connection of this.connections) {
            try {
                await this.deleteConnection(connection.server.name, connection.server.source);
            }
            catch (error) {
                console.error(`Failed to close connection for ${connection.server.name}:`, error);
            }
        }
        this.connections = [];
        if (this.settingsWatcher) {
            this.settingsWatcher.dispose();
            this.settingsWatcher = undefined;
        }
        if (this.projectMcpWatcher) {
            this.projectMcpWatcher.dispose();
            this.projectMcpWatcher = undefined;
        }
        this.disposables.forEach((d) => d.dispose());
    }
}
//# sourceMappingURL=McpHub.js.map