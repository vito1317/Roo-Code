/**
 * UI Design Canvas Panel - VS Code Webview Panel
 * Displays and manages the UI design canvas preview
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
// Type definition for the design document
interface DesignDocument {
  name: string;
  canvas: {
    width: number;
    height: number;
    backgroundColor?: string;
  };
  tokens?: {
    colors?: Record<string, string>;
    spacing?: Record<string, number>;
    typography?: Record<string, any>;
    radius?: Record<string, number>;
    shadows?: Record<string, any>;
  };
  elements: DesignElement[];
  context?: {
    purpose?: string;
    targetAudience?: string;
    designStyle?: string;
    colorScheme?: string;
    notes?: string;
  };
}

interface DesignElement {
  id: string;
  type: string;
  name?: string;
  semantic?: string;
  description?: string;
  bounds: { x: number; y: number; width: number; height: number };
  style?: {
    fill?: string;
    stroke?: { color: string; width: number };
    radius?: number | number[];
    opacity?: number;
    shadow?: any;
    blur?: number;
    text?: any;
  };
  content?: string;
  children?: DesignElement[];
}

export class UIDesignCanvasPanel {
  public static currentPanel: UIDesignCanvasPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private design: DesignDocument | null = null;
  private onDesignUpdate: ((design: DesignDocument) => void) | null = null;
  private mcpServerPort: number | null = null;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Set up webview content
    this.panel.webview.html = this.getWebviewContent();

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "requestDesign":
            if (this.design) {
              this.panel.webview.postMessage({
                type: "updateDesign",
                design: this.design,
              });
            }
            break;

          case "elementSelected":
            // Notify extension about selection
            console.log("[UIDesignCanvas] Element selected:", message.id);
            break;

          case "updateElement":
            // Handle element update from webview
            this.handleUpdateElement(message.id, message.updates);
            break;

          case "deleteElement":
            // Handle delete request
            this.handleDeleteElement(message.id);
            break;

          case "duplicateElement":
            // Handle duplicate request
            this.handleDuplicateElement(message.id);
            break;

          case "reorderElement":
            // Handle bring to front / send to back
            this.handleReorderElement(message.id, message.direction);
            break;

          case "addElement":
            // Handle add new element
            this.handleAddElement(message.element);
            break;

          case "designChanged":
            // Full design update from webview
            if (message.design) {
              this.design = message.design;
              this.notifyDesignUpdate();
              this.syncToMcpServer();
            }
            break;

          case "exportDesign":
            await this.exportDesign();
            break;

          case "takeScreenshot":
            await this.takeScreenshot();
            break;

          case "mcpToolCall":
            // Handle MCP tool calls from webview (edit operations like delete, create, update)
            await this.handleMcpToolCall(message.tool, message.args);
            break;
        }
      },
      null,
      this.disposables
    );

    // Handle panel disposal
    this.panel.onDidDispose(
      () => {
        UIDesignCanvasPanel.currentPanel = undefined;
        this.dispose();
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(extensionUri: vscode.Uri): UIDesignCanvasPanel {
    // Use ViewColumn.One to display in main editor area (fullscreen instead of split)

    // If panel exists, show it
    if (UIDesignCanvasPanel.currentPanel) {
      UIDesignCanvasPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return UIDesignCanvasPanel.currentPanel;
    }

    // Create new panel in main editor area (fullscreen)
    const panel = vscode.window.createWebviewPanel(
      "uiDesignCanvas",
      "UI Design Canvas",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    UIDesignCanvasPanel.currentPanel = new UIDesignCanvasPanel(panel, extensionUri);
    return UIDesignCanvasPanel.currentPanel;
  }

  /**
   * Update the design displayed in the canvas
   */
  public updateDesign(design: DesignDocument): void {
    this.design = design;
    this.panel.webview.postMessage({
      type: "updateDesign",
      design: design,
    });
  }

  /**
   * Set callback for design updates from the panel
   */
  public onDesignChange(callback: (design: DesignDocument) => void): void {
    this.onDesignUpdate = callback;
  }

  /**
   * Set the MCP server port for syncing
   */
  public setMcpServerPort(port: number): void {
    this.mcpServerPort = port;
    console.log("[UIDesignCanvas] MCP server port set to:", port);
  }

  /**
   * Handle element update from webview
   */
  private handleUpdateElement(id: string, updates: Partial<DesignElement>): void {
    if (!this.design) return;

    const element = this.findElementById(this.design.elements, id);
    if (element) {
      // Apply updates to element
      if (updates.bounds) {
        element.bounds = { ...element.bounds, ...updates.bounds };
      }
      if (updates.style) {
        element.style = { ...element.style, ...updates.style };
      }
      if (updates.content !== undefined) {
        element.content = updates.content;
      }
      if (updates.name !== undefined) {
        element.name = updates.name;
      }

      console.log("[UIDesignCanvas] Element updated:", id, updates);
      this.notifyDesignUpdate();
      this.syncToMcpServer();
    }
  }

  /**
   * Handle element deletion
   */
  private handleDeleteElement(id: string): void {
    if (!this.design) return;

    const removed = this.removeElementById(this.design.elements, id);
    if (removed) {
      console.log("[UIDesignCanvas] Element deleted:", id);
      this.notifyDesignUpdate();
      this.syncToMcpServer();
    }
  }

  /**
   * Handle element duplication
   */
  private handleDuplicateElement(id: string): void {
    if (!this.design) return;

    const element = this.findElementById(this.design.elements, id);
    if (element) {
      const duplicate = JSON.parse(JSON.stringify(element));
      duplicate.id = `${element.type}_${Date.now()}`;
      duplicate.name = `${element.name || element.type} Copy`;
      // Offset the duplicate
      duplicate.bounds.x += 20;
      duplicate.bounds.y += 20;

      this.design.elements.push(duplicate);
      console.log("[UIDesignCanvas] Element duplicated:", id, "->", duplicate.id);

      // Update webview with new design
      this.panel.webview.postMessage({
        type: "updateDesign",
        design: this.design,
      });

      this.notifyDesignUpdate();
      this.syncToMcpServer();
    }
  }

  /**
   * Handle element reordering (bring to front / send to back)
   */
  private handleReorderElement(id: string, direction: "front" | "back"): void {
    if (!this.design) return;

    const index = this.design.elements.findIndex(el => el.id === id);
    if (index !== -1) {
      const [element] = this.design.elements.splice(index, 1);
      if (direction === "front") {
        this.design.elements.push(element);
      } else {
        this.design.elements.unshift(element);
      }

      console.log("[UIDesignCanvas] Element reordered:", id, direction);

      // Update webview with new design
      this.panel.webview.postMessage({
        type: "updateDesign",
        design: this.design,
      });

      this.notifyDesignUpdate();
      this.syncToMcpServer();
    }
  }

  /**
   * Handle adding a new element
   */
  private handleAddElement(element: DesignElement): void {
    if (!this.design) return;

    this.design.elements.push(element);
    console.log("[UIDesignCanvas] Element added:", element.id);

    // Update webview with new design
    this.panel.webview.postMessage({
      type: "updateDesign",
      design: this.design,
    });

    this.notifyDesignUpdate();
    this.syncToMcpServer();
  }

  /**
   * Find element by ID in the element tree
   */
  private findElementById(elements: DesignElement[], id: string): DesignElement | null {
    for (const element of elements) {
      if (element.id === id) return element;
      if (element.children) {
        const found = this.findElementById(element.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Remove element by ID from the element tree
   */
  private removeElementById(elements: DesignElement[], id: string): boolean {
    const index = elements.findIndex(el => el.id === id);
    if (index !== -1) {
      elements.splice(index, 1);
      return true;
    }
    for (const element of elements) {
      if (element.children) {
        if (this.removeElementById(element.children, id)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Notify external listeners of design changes
   */
  private notifyDesignUpdate(): void {
    if (this.onDesignUpdate && this.design) {
      this.onDesignUpdate(this.design);
    }
  }

  /**
   * Sync the design to the MCP server
   */
  private async syncToMcpServer(): Promise<void> {
    if (!this.mcpServerPort || !this.design) return;

    try {
      const response = await fetch(`http://127.0.0.1:${this.mcpServerPort}/api/design`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.design),
      });

      if (response.ok) {
        console.log("[UIDesignCanvas] Design synced to MCP server");
      } else {
        console.error("[UIDesignCanvas] Failed to sync design:", response.status);
      }
    } catch (error) {
      console.error("[UIDesignCanvas] Error syncing to MCP server:", error);
    }
  }

  /**
   * Handle MCP tool calls from webview (delete, create, update operations)
   */
  private async handleMcpToolCall(toolName: string, args: any): Promise<void> {
    if (!this.mcpServerPort) {
      console.error("[UIDesignCanvas] MCP server port not set");
      return;
    }

    console.log(`[UIDesignCanvas] MCP tool call: ${toolName}`, args);

    try {
      // Call the MCP server's tool endpoint
      const response = await fetch(`http://127.0.0.1:${this.mcpServerPort}/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: toolName, arguments: args }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`[UIDesignCanvas] Tool ${toolName} result:`, result);

        // Refresh the design from server after tool execution
        await this.refreshDesignFromServer();
      } else {
        console.error(`[UIDesignCanvas] Tool ${toolName} failed:`, response.status);
      }
    } catch (error) {
      console.error(`[UIDesignCanvas] Error calling tool ${toolName}:`, error);
    }
  }

  /**
   * Refresh design from MCP server and update webview
   */
  private async refreshDesignFromServer(): Promise<void> {
    if (!this.mcpServerPort) return;

    try {
      const response = await fetch(`http://127.0.0.1:${this.mcpServerPort}/design`);
      if (response.ok) {
        this.design = await response.json();
        this.panel.webview.postMessage({
          type: "updateDesign",
          design: this.design,
        });
        console.log("[UIDesignCanvas] Design refreshed from server");
      }
    } catch (error) {
      console.error("[UIDesignCanvas] Failed to refresh design:", error);
    }
  }

  /**
   * Select an element in the canvas
   */
  public selectElement(id: string): void {
    this.panel.webview.postMessage({
      type: "selectElement",
      id: id,
    });
  }

  /**
   * Take a screenshot of the current design
   */
  public async takeScreenshot(): Promise<string | null> {
    // In a real implementation, this would capture the webview content
    // For now, we'll generate an SVG representation
    if (!this.design) return null;

    try {
      const svgContent = this.generateSVG(this.design);
      const base64 = Buffer.from(svgContent).toString("base64");
      return `data:image/svg+xml;base64,${base64}`;
    } catch (error) {
      console.error("[UIDesignCanvas] Screenshot failed:", error);
      return null;
    }
  }

  /**
   * Export the design
   */
  private async exportDesign(): Promise<void> {
    if (!this.design) {
      vscode.window.showWarningMessage("No design to export");
      return;
    }

    const options: vscode.QuickPickItem[] = [
      { label: "HTML", description: "Export as HTML/CSS file" },
      { label: "JSON", description: "Export as JSON file" },
      { label: "React", description: "Export as React component" },
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: "Select export format",
    });

    if (!selected) return;

    const uri = await vscode.window.showSaveDialog({
      filters: {
        HTML: ["html"],
        JSON: ["json"],
        JavaScript: ["jsx", "tsx"],
      },
      defaultUri: vscode.Uri.file(
        path.join(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
          `${this.design.name || "design"}.${selected.label.toLowerCase() === "react" ? "tsx" : selected.label.toLowerCase()}`
        )
      ),
    });

    if (!uri) return;

    let content = "";
    switch (selected.label) {
      case "HTML":
        content = this.generateHTML(this.design);
        break;
      case "JSON":
        content = JSON.stringify(this.design, null, 2);
        break;
      case "React":
        content = this.generateReact(this.design);
        break;
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    vscode.window.showInformationMessage(`Design exported to ${uri.fsPath}`);
  }

  /**
   * Generate HTML from design
   */
  private generateHTML(design: DesignDocument): string {
    const renderElement = (el: any, indent: string = "    "): string => {
      const styles: string[] = [];

      if (el.bounds) {
        styles.push(`position: absolute`);
        styles.push(`left: ${el.bounds.x}px`);
        styles.push(`top: ${el.bounds.y}px`);
        styles.push(`width: ${el.bounds.width}px`);
        styles.push(`height: ${el.bounds.height}px`);
      }

      if (el.style?.fill) {
        const fill = this.resolveToken(el.style.fill, design);
        styles.push(`background-color: ${fill}`);
      }

      if (el.style?.radius) {
        styles.push(
          `border-radius: ${typeof el.style.radius === "number" ? el.style.radius + "px" : el.style.radius}`
        );
      }

      if (el.style?.stroke) {
        styles.push(`border: ${el.style.stroke.width || 1}px solid ${el.style.stroke.color}`);
      }

      if (el.type === "ellipse") {
        styles.push(`border-radius: 50%`);
      }

      if (el.style?.text) {
        if (el.style.text.fontSize) styles.push(`font-size: ${el.style.text.fontSize}px`);
        if (el.style.text.fontWeight) styles.push(`font-weight: ${el.style.text.fontWeight}`);
        if (el.style.text.textAlign) styles.push(`text-align: ${el.style.text.textAlign}`);
      }

      const styleAttr = styles.length > 0 ? ` style="${styles.join("; ")}"` : "";
      const children = el.children?.map((c: any) => renderElement(c, indent + "  ")).join("\n") || "";

      if (el.type === "text") {
        return `${indent}<span${styleAttr}>${el.content || ""}</span>`;
      }

      const tag = el.semantic === "button" ? "button" : "div";
      const className = el.name ? ` class="${el.name.toLowerCase().replace(/\s+/g, "-")}"` : "";

      return `${indent}<${tag}${className}${styleAttr}>${children ? "\n" + children + "\n" + indent : ""}</${tag}>`;
    };

    const elements = design.elements.map((el) => renderElement(el)).join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${design.name || "UI Design"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .canvas {
      position: relative;
      width: ${design.canvas.width}px;
      height: ${design.canvas.height}px;
      background: ${design.canvas.backgroundColor || "#fff"};
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="canvas">
${elements}
  </div>
</body>
</html>`;
  }

  /**
   * Generate React component from design
   */
  private generateReact(design: DesignDocument): string {
    const componentName = (design.name || "Design").replace(/\s+/g, "");

    const renderElement = (el: any, indent: string = "      "): string => {
      const styles: Record<string, string | number> = {};

      if (el.bounds) {
        styles.position = "absolute";
        styles.left = el.bounds.x;
        styles.top = el.bounds.y;
        styles.width = el.bounds.width;
        styles.height = el.bounds.height;
      }

      if (el.style?.fill) {
        styles.backgroundColor = this.resolveToken(el.style.fill, design);
      }

      if (el.style?.radius) {
        styles.borderRadius = el.style.radius;
      }

      if (el.type === "ellipse") {
        styles.borderRadius = "50%";
      }

      const styleStr = Object.entries(styles)
        .map(([k, v]) => `${k}: ${typeof v === "number" ? v : `'${v}'`}`)
        .join(", ");

      const children = el.children?.map((c: any) => renderElement(c, indent + "  ")).join("\n") || "";

      if (el.type === "text") {
        return `${indent}<span style={{ ${styleStr} }}>${el.content || ""}</span>`;
      }

      const Tag = el.semantic === "button" ? "button" : "div";
      return `${indent}<${Tag} style={{ ${styleStr} }}>${children ? "\n" + children + "\n" + indent : ""}</${Tag}>`;
    };

    const elements = design.elements.map((el) => renderElement(el)).join("\n");

    return `import React from 'react';

const ${componentName}: React.FC = () => {
  return (
    <div style={{
      position: 'relative',
      width: ${design.canvas.width},
      height: ${design.canvas.height},
      backgroundColor: '${design.canvas.backgroundColor || "#fff"}',
    }}>
${elements}
    </div>
  );
};

export default ${componentName};
`;
  }

  /**
   * Generate SVG from design
   */
  private generateSVG(design: DesignDocument): string {
    const renderElement = (el: any): string => {
      const fill = el.style?.fill ? this.resolveToken(el.style.fill, design) : "none";
      const stroke = el.style?.stroke?.color || "none";
      const strokeWidth = el.style?.stroke?.width || 0;

      if (el.type === "rectangle" || el.type === "frame") {
        const rx = el.style?.radius || 0;
        return `<rect x="${el.bounds.x}" y="${el.bounds.y}" width="${el.bounds.width}" height="${el.bounds.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="${rx}" />`;
      }

      if (el.type === "ellipse") {
        const cx = el.bounds.x + el.bounds.width / 2;
        const cy = el.bounds.y + el.bounds.height / 2;
        const rx = el.bounds.width / 2;
        const ry = el.bounds.height / 2;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
      }

      if (el.type === "text") {
        const fontSize = el.style?.text?.fontSize || 16;
        const color = fill !== "none" ? fill : "#000";
        return `<text x="${el.bounds.x}" y="${el.bounds.y + fontSize}" font-size="${fontSize}" fill="${color}">${el.content || ""}</text>`;
      }

      // For other types, render as rect + children
      let svg = `<rect x="${el.bounds.x}" y="${el.bounds.y}" width="${el.bounds.width}" height="${el.bounds.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
      if (el.children) {
        svg += el.children.map((c: any) => renderElement(c)).join("");
      }
      return svg;
    };

    const elements = design.elements.map((el) => renderElement(el)).join("\n  ");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${design.canvas.width}" height="${design.canvas.height}" viewBox="0 0 ${design.canvas.width} ${design.canvas.height}">
  <rect width="100%" height="100%" fill="${design.canvas.backgroundColor || "#fff"}" />
  ${elements}
</svg>`;
  }

  /**
   * Resolve design token reference
   */
  private resolveToken(value: any, design: DesignDocument): string {
    if (!value || typeof value !== "string") return value;
    if (value.startsWith("$")) {
      const path = value.slice(1).split(".");
      let resolved: any = design.tokens;
      for (const key of path) {
        resolved = resolved?.[key];
      }
      return resolved || value;
    }
    return value;
  }

  /**
   * Get the webview HTML content
   */
  private getWebviewContent(): string {
    // Try multiple possible paths for canvas.html
    const possiblePaths = [
      path.join(this.extensionUri.fsPath, "tools", "ui-design-canvas", "webview", "canvas.html"),
      path.join(this.extensionUri.fsPath, "dist", "tools", "ui-design-canvas", "webview", "canvas.html"),
      path.join(this.extensionUri.fsPath, "src", "tools", "ui-design-canvas", "webview", "canvas.html"),
    ];

    for (const htmlPath of possiblePaths) {
      try {
        if (fs.existsSync(htmlPath)) {
          console.log(`[UIDesignCanvas] Loading canvas.html from: ${htmlPath}`);
          return fs.readFileSync(htmlPath, "utf-8");
        }
      } catch (error) {
        console.error(`[UIDesignCanvas] Failed to read ${htmlPath}:`, error);
      }
    }

    // Fallback if file not found
    console.error(`[UIDesignCanvas] canvas.html not found in any of:`, possiblePaths);
    return this.getInlineWebviewContent();
  }

  /**
   * Inline webview content (fallback)
   */
  private getInlineWebviewContent(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #1e1e1e; color: #ccc; }
    .error { color: #f44; }
  </style>
</head>
<body>
  <h2>UI Design Canvas</h2>
  <p class="error">Canvas webview content not found. Please rebuild the extension.</p>
</body>
</html>`;
  }

  public dispose(): void {
    UIDesignCanvasPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
