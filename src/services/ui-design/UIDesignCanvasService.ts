/**
 * UI Design Canvas Service
 * Manages the MCP server and preview panel for the UI design canvas
 */

import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { UIDesignCanvasPanel } from "./UIDesignCanvasPanel";

export class UIDesignCanvasService {
  private static instance: UIDesignCanvasService | null = null;

  private mcpServerProcess: ChildProcess | null = null;
  private mcpServerPort: number = 4420;
  private extensionUri: vscode.Uri;
  private isRunning: boolean = false;

  private constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  public static getInstance(extensionUri?: vscode.Uri): UIDesignCanvasService {
    if (!UIDesignCanvasService.instance) {
      if (!extensionUri) {
        throw new Error("extensionUri required for first initialization");
      }
      UIDesignCanvasService.instance = new UIDesignCanvasService(extensionUri);
    }
    return UIDesignCanvasService.instance;
  }

  /**
   * Start the UI Design Canvas MCP server
   */
  public async startServer(): Promise<boolean> {
    if (this.isRunning) {
      console.log("[UIDesignCanvas] Server already running");
      return true;
    }

    try {
      const serverPath = path.join(
        this.extensionUri.fsPath,
        "tools",
        "ui-design-canvas",
        "dist",
        "McpServer.js"
      );

      // Check if server file exists
      const fs = await import("fs");
      if (!fs.existsSync(serverPath)) {
        console.error("[UIDesignCanvas] Server file not found:", serverPath);
        return false;
      }

      console.log("[UIDesignCanvas] Starting MCP server...");

      this.mcpServerProcess = spawn("node", [serverPath], {
        env: {
          ...process.env,
          UI_CANVAS_PORT: String(this.mcpServerPort),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.mcpServerProcess.stdout?.on("data", (data) => {
        console.log("[UIDesignCanvas] Server:", data.toString().trim());
      });

      this.mcpServerProcess.stderr?.on("data", (data) => {
        console.error("[UIDesignCanvas] Server:", data.toString().trim());
      });

      this.mcpServerProcess.on("close", (code) => {
        console.log("[UIDesignCanvas] Server exited with code:", code);
        this.isRunning = false;
      });

      this.mcpServerProcess.on("error", (error) => {
        console.error("[UIDesignCanvas] Server error:", error);
        this.isRunning = false;
      });

      // Wait a bit for server to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      this.isRunning = true;
      console.log(`[UIDesignCanvas] Server started on port ${this.mcpServerPort}`);
      return true;
    } catch (error) {
      console.error("[UIDesignCanvas] Failed to start server:", error);
      return false;
    }
  }

  /**
   * Stop the MCP server
   */
  public stopServer(): void {
    if (this.mcpServerProcess) {
      console.log("[UIDesignCanvas] Stopping server...");
      this.mcpServerProcess.kill("SIGTERM");
      this.mcpServerProcess = null;
      this.isRunning = false;
    }
  }

  /**
   * Open the preview panel
   */
  public openPreviewPanel(): UIDesignCanvasPanel {
    return UIDesignCanvasPanel.createOrShow(this.extensionUri);
  }

  /**
   * Get the SSE endpoint URL
   */
  public getSseUrl(): string {
    return `http://127.0.0.1:${this.mcpServerPort}/sse`;
  }

  /**
   * Get the design endpoint URL
   */
  public getDesignUrl(): string {
    return `http://127.0.0.1:${this.mcpServerPort}/design`;
  }

  /**
   * Check if server is running
   */
  public isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Dispose the service
   */
  public dispose(): void {
    this.stopServer();
    UIDesignCanvasService.instance = null;
  }
}

/**
 * MCP Server configuration for McpHub
 */
export function getUIDesignCanvasMcpConfig() {
  return {
    name: "UIDesignCanvas",
    type: "sse" as const,
    url: "http://127.0.0.1:4420/sse",
    description: "UI Design Canvas - Create and manipulate UI designs with AI",
    autoApprove: [
      "get_design",
      "new_design",
      "create_frame",
      "create_rectangle",
      "create_text",
      "create_ellipse",
      "create_image",
      "update_element",
      "move_element",
      "resize_element",
      "delete_element",
      "set_style",
      "set_layout",
      "find_elements",
      "get_element",
      "export_html",
      "export_json",
      "get_screenshot",
      "set_tokens",
      "get_tokens",
      "set_canvas",
    ],
  };
}
