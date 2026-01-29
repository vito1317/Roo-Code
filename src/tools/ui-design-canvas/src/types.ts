/**
 * UI Design Canvas - AI-Optimized Design Format
 *
 * This format is designed to be:
 * 1. Human-readable and AI-friendly
 * 2. Semantic - describes WHAT elements are, not just how they look
 * 3. Token-based - uses named design tokens for consistency
 * 4. Hierarchical - clear parent-child relationships
 */

// ========== Design Tokens ==========

export interface DesignTokens {
  colors: Record<string, string>;      // Named colors: { primary: "#007AFF", ... }
  spacing: Record<string, number>;     // Named spacing: { sm: 8, md: 16, ... }
  radius: Record<string, number>;      // Border radius: { sm: 8, md: 12, ... }
  typography: Record<string, TypographyToken>;
  shadows: Record<string, ShadowToken>;
}

export interface TypographyToken {
  fontSize: number;
  fontWeight: 'normal' | 'medium' | 'semibold' | 'bold';
  lineHeight?: number;
  letterSpacing?: number;
  fontFamily?: string;
}

export interface ShadowToken {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread?: number;
  color: string;
}

// ========== Semantic Types ==========
// These tell AI WHAT an element is, not just what it looks like

export type SemanticType =
  // Layout
  | 'screen'        // Full screen container
  | 'header'        // Top navigation/header
  | 'footer'        // Bottom navigation/footer
  | 'sidebar'       // Side navigation
  | 'content'       // Main content area
  | 'section'       // Content section

  // Interactive
  | 'button'        // Clickable button
  | 'link'          // Text link
  | 'input'         // Text input field
  | 'textarea'      // Multi-line input
  | 'checkbox'      // Checkbox
  | 'radio'         // Radio button
  | 'toggle'        // Toggle switch
  | 'dropdown'      // Dropdown/select
  | 'slider'        // Range slider

  // Content
  | 'card'          // Card container
  | 'list'          // List container
  | 'list-item'     // List item
  | 'grid'          // Grid container
  | 'table'         // Table
  | 'modal'         // Modal/dialog
  | 'tooltip'       // Tooltip
  | 'badge'         // Badge/tag
  | 'chip'          // Chip/pill

  // Text
  | 'heading'       // Heading text (h1-h6)
  | 'paragraph'     // Body text
  | 'label'         // Form label
  | 'caption'       // Caption/helper text
  | 'code'          // Code block

  // Media
  | 'image'         // Image
  | 'icon'          // Icon
  | 'avatar'        // User avatar
  | 'video'         // Video player

  // Feedback
  | 'alert'         // Alert/notification
  | 'progress'      // Progress bar
  | 'spinner'       // Loading spinner
  | 'skeleton'      // Skeleton loader

  // Other
  | 'divider'       // Divider line
  | 'spacer'        // Empty space
  | 'container'     // Generic container
  | 'unknown';      // Unknown/custom

// ========== Element Types ==========

export type ElementType =
  | 'frame'         // Container/group
  | 'rectangle'     // Rectangle shape
  | 'ellipse'       // Ellipse/circle
  | 'text'          // Text element
  | 'image'         // Image element
  | 'line'          // Line
  | 'path'          // Vector path
  | 'group';        // Group of elements

// ========== Style Properties ==========

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Fill {
  type: 'solid' | 'gradient' | 'image';
  color?: string;           // Hex color or token reference "$colors.primary"
  opacity?: number;         // 0-1
  gradient?: GradientFill;
  imageUrl?: string;
}

export interface GradientFill {
  type: 'linear' | 'radial';
  angle?: number;           // For linear
  stops: Array<{ color: string; position: number }>;
}

export interface Stroke {
  color: string;            // Hex or token reference
  width: number;
  opacity?: number;
  style?: 'solid' | 'dashed' | 'dotted';
  dashArray?: number[];
}

export interface Shadow {
  type: 'drop' | 'inner';
  offsetX: number;
  offsetY: number;
  blur: number;
  spread?: number;
  color: string;
  opacity?: number;
}

export interface TextStyle {
  fontSize?: number | string;      // Number or token "$typography.h1"
  fontWeight?: string;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textDecoration?: 'none' | 'underline' | 'line-through';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
}

export interface Layout {
  type: 'none' | 'flex' | 'grid';
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  wrap?: boolean;
  gap?: number | string;
  rowGap?: number;
  columnGap?: number;
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
  padding?: number | string | { top?: number; right?: number; bottom?: number; left?: number };

  // Grid specific
  columns?: number | string;
  rows?: number | string;
}

export interface ElementStyle {
  fill?: Fill | string;             // Can be simple color or Fill object
  stroke?: Stroke;
  radius?: number | string | { topLeft?: number; topRight?: number; bottomLeft?: number; bottomRight?: number };
  opacity?: number;
  shadow?: Shadow | Shadow[];
  blur?: number;

  // Text specific
  text?: TextStyle;

  // Layout
  layout?: Layout;

  // Overflow
  overflow?: 'visible' | 'hidden' | 'scroll';

  // Position
  position?: 'relative' | 'absolute';
  zIndex?: number;
}

// ========== Design Element ==========

export interface DesignElement {
  id: string;
  type: ElementType;

  // Semantic information (AI-friendly)
  semantic?: SemanticType;
  name?: string;                     // Human-readable name
  description?: string;              // Description of purpose/function

  // Position and size
  bounds: Bounds;

  // Visual style
  style?: ElementStyle;

  // Content
  content?: string;                  // For text elements
  src?: string;                      // For images

  // Hierarchy
  children?: DesignElement[];

  // Interaction hints (for AI)
  interactive?: boolean;
  action?: string;                   // What happens on click
  state?: 'default' | 'hover' | 'active' | 'disabled' | 'focused';

  // Data binding hints
  dataBinding?: string;              // e.g., "user.name", "items[0].title"

  // Responsive
  responsive?: {
    mobile?: Partial<DesignElement>;
    tablet?: Partial<DesignElement>;
    desktop?: Partial<DesignElement>;
  };

  // Constraints
  constraints?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    aspectRatio?: number;
  };

  // Metadata
  locked?: boolean;
  hidden?: boolean;
  exportable?: boolean;
}

// ========== Design Document ==========

export interface DesignDocument {
  // Document info
  id: string;
  name: string;
  version: string;
  createdAt: string;
  updatedAt: string;

  // Canvas settings
  canvas: {
    width: number;
    height: number;
    backgroundColor?: string;
    device?: string;                // e.g., "iPhone 14 Pro", "Desktop 1920x1080"
  };

  // Design tokens (reusable values)
  tokens: DesignTokens;

  // Element tree
  elements: DesignElement[];

  // AI context (helps AI understand the design)
  context?: {
    appType?: string;               // e.g., "mobile app", "web dashboard", "landing page"
    industry?: string;              // e.g., "fintech", "healthcare", "e-commerce"
    style?: string;                 // e.g., "minimal", "playful", "corporate"
    targetAudience?: string;        // e.g., "young adults", "professionals"
    designSystem?: string;          // e.g., "Material Design", "iOS Human Interface"
    notes?: string;                 // Additional context for AI
  };

  // Component library (reusable components)
  components?: {
    id: string;
    name: string;
    description?: string;
    element: DesignElement;
  }[];
}

// ========== AI Summary Format ==========
// A simplified format for AI to quickly understand the design

export interface DesignSummary {
  id: string;
  name: string;
  description: string;
  canvasSize: { width: number; height: number };

  // High-level structure
  structure: {
    totalElements: number;
    hierarchy: string;               // ASCII tree representation
    mainSections: string[];          // ["header", "content", "footer"]
  };

  // Design system summary
  designSystem: {
    primaryColor: string;
    secondaryColors: string[];
    typography: string[];            // ["h1: 34px bold", "body: 17px regular"]
    spacing: string;                 // "8px grid system"
  };

  // Interactive elements
  interactiveElements: {
    id: string;
    type: string;
    name: string;
    action?: string;
  }[];

  // Issues/suggestions
  issues?: string[];
  suggestions?: string[];
}
