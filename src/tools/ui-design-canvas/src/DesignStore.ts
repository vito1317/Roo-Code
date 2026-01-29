/**
 * Design Store - Manages the design state
 */

import type { DesignDocument, DesignElement, DesignSummary, DesignTokens } from './types';

export class DesignStore {
  private design: DesignDocument;
  private listeners: Set<(design: DesignDocument) => void> = new Set();

  constructor() {
    this.design = this.createEmptyDesign();
  }

  // ========== Design Management ==========

  createEmptyDesign(name: string = 'Untitled Design'): DesignDocument {
    return {
      id: this.generateId(),
      name,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      canvas: {
        width: 390,
        height: 844,
        backgroundColor: '#FFFFFF',
        device: 'iPhone 14 Pro',
      },
      tokens: {
        colors: {
          primary: '#007AFF',
          secondary: '#5856D6',
          success: '#34C759',
          warning: '#FF9500',
          error: '#FF3B30',
          background: '#FFFFFF',
          surface: '#F2F2F7',
          text: '#000000',
          textSecondary: '#8E8E93',
        },
        spacing: {
          xs: 4,
          sm: 8,
          md: 16,
          lg: 24,
          xl: 32,
        },
        radius: {
          sm: 8,
          md: 12,
          lg: 16,
          xl: 24,
          full: 9999,
        },
        typography: {
          h1: { fontSize: 34, fontWeight: 'bold', lineHeight: 41 },
          h2: { fontSize: 28, fontWeight: 'bold', lineHeight: 34 },
          h3: { fontSize: 22, fontWeight: 'semibold', lineHeight: 28 },
          body: { fontSize: 17, fontWeight: 'normal', lineHeight: 22 },
          caption: { fontSize: 12, fontWeight: 'normal', lineHeight: 16 },
        },
        shadows: {
          sm: { offsetX: 0, offsetY: 1, blur: 3, color: 'rgba(0,0,0,0.1)' },
          md: { offsetX: 0, offsetY: 4, blur: 6, color: 'rgba(0,0,0,0.1)' },
          lg: { offsetX: 0, offsetY: 10, blur: 15, color: 'rgba(0,0,0,0.1)' },
        },
      },
      elements: [],
    };
  }

  getDesign(): DesignDocument {
    return this.design;
  }

  setDesign(design: DesignDocument): void {
    this.design = design;
    this.design.updatedAt = new Date().toISOString();
    this.notifyListeners();
  }

  loadDesign(json: string): DesignDocument {
    const design = JSON.parse(json) as DesignDocument;
    this.setDesign(design);
    return design;
  }

  exportDesign(): string {
    return JSON.stringify(this.design, null, 2);
  }

  // ========== Element Operations ==========

  createElement(type: DesignElement['type'], props: Partial<DesignElement>): DesignElement {
    const element: DesignElement = {
      id: this.generateId(),
      type,
      bounds: props.bounds || { x: 0, y: 0, width: 100, height: 100 },
      ...props,
    };
    return element;
  }

  addElement(element: DesignElement, parentId?: string): DesignElement {
    if (parentId) {
      const parent = this.findElement(parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(element);
      }
    } else {
      this.design.elements.push(element);
    }
    this.design.updatedAt = new Date().toISOString();
    this.notifyListeners();
    return element;
  }

  findElement(id: string, elements: DesignElement[] = this.design.elements): DesignElement | null {
    for (const el of elements) {
      if (el.id === id) return el;
      if (el.children) {
        const found = this.findElement(id, el.children);
        if (found) return found;
      }
    }
    return null;
  }

  updateElement(id: string, updates: Partial<DesignElement>): DesignElement | null {
    const element = this.findElement(id);
    if (element) {
      Object.assign(element, updates);
      this.design.updatedAt = new Date().toISOString();
      this.notifyListeners();
    }
    return element;
  }

  deleteElement(id: string, elements: DesignElement[] = this.design.elements): boolean {
    const index = elements.findIndex(el => el.id === id);
    if (index !== -1) {
      elements.splice(index, 1);
      this.design.updatedAt = new Date().toISOString();
      this.notifyListeners();
      return true;
    }
    for (const el of elements) {
      if (el.children && this.deleteElement(id, el.children)) {
        return true;
      }
    }
    return false;
  }

  moveElement(id: string, x: number, y: number): DesignElement | null {
    const element = this.findElement(id);
    if (element) {
      element.bounds.x = x;
      element.bounds.y = y;
      this.design.updatedAt = new Date().toISOString();
      this.notifyListeners();
    }
    return element;
  }

  resizeElement(id: string, width: number, height: number): DesignElement | null {
    const element = this.findElement(id);
    if (element) {
      element.bounds.width = width;
      element.bounds.height = height;
      this.design.updatedAt = new Date().toISOString();
      this.notifyListeners();
    }
    return element;
  }

  // ========== Query Operations ==========

  findElements(predicate: (el: DesignElement) => boolean, elements: DesignElement[] = this.design.elements): DesignElement[] {
    const results: DesignElement[] = [];
    for (const el of elements) {
      if (predicate(el)) results.push(el);
      if (el.children) {
        results.push(...this.findElements(predicate, el.children));
      }
    }
    return results;
  }

  findByName(name: string): DesignElement[] {
    return this.findElements(el => el.name?.toLowerCase().includes(name.toLowerCase()) ?? false);
  }

  findBySemantic(semantic: string): DesignElement[] {
    return this.findElements(el => el.semantic === semantic);
  }

  findByType(type: string): DesignElement[] {
    return this.findElements(el => el.type === type);
  }

  // ========== AI Summary ==========

  generateSummary(): DesignSummary {
    const allElements = this.findElements(() => true);
    const interactiveElements = allElements.filter(el => el.interactive || el.semantic === 'button' || el.semantic === 'input');

    return {
      id: this.design.id,
      name: this.design.name,
      description: this.design.context?.notes || `UI design with ${allElements.length} elements`,
      canvasSize: {
        width: this.design.canvas.width,
        height: this.design.canvas.height,
      },
      structure: {
        totalElements: allElements.length,
        hierarchy: this.generateHierarchyTree(),
        mainSections: this.identifyMainSections(),
      },
      designSystem: {
        primaryColor: this.design.tokens.colors.primary || '#007AFF',
        secondaryColors: Object.values(this.design.tokens.colors).slice(1, 4),
        typography: Object.entries(this.design.tokens.typography).map(
          ([name, t]) => `${name}: ${t.fontSize}px ${t.fontWeight}`
        ),
        spacing: `${this.design.tokens.spacing.sm}px base grid`,
      },
      interactiveElements: interactiveElements.map(el => ({
        id: el.id,
        type: el.semantic || el.type,
        name: el.name || el.id,
        action: el.action,
      })),
    };
  }

  private generateHierarchyTree(elements: DesignElement[] = this.design.elements, indent: string = ''): string {
    let tree = '';
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const isLast = i === elements.length - 1;
      const prefix = isLast ? '└── ' : '├── ';
      const childIndent = indent + (isLast ? '    ' : '│   ');

      tree += `${indent}${prefix}${el.name || el.semantic || el.type} (${el.type})\n`;

      if (el.children && el.children.length > 0) {
        tree += this.generateHierarchyTree(el.children, childIndent);
      }
    }
    return tree;
  }

  private identifyMainSections(): string[] {
    const sections: string[] = [];
    for (const el of this.design.elements) {
      if (el.semantic) {
        sections.push(el.semantic);
      } else if (el.name) {
        sections.push(el.name);
      }
    }
    return sections;
  }

  // ========== Utilities ==========

  private generateId(): string {
    return 'el-' + Math.random().toString(36).slice(2, 9);
  }

  // ========== Event Listeners ==========

  subscribe(listener: (design: DesignDocument) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.design);
    }
  }
}

// Singleton instance
export const designStore = new DesignStore();
