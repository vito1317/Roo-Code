# General UI Guidelines

## Core Principles

These apply to ALL UI types when no specific guideline exists.

## Layout Hierarchy

1. **Visual Flow**: Left-to-right, top-to-bottom (LTR languages)
2. **Primary Actions**: Prominent placement, accent colors
3. **Secondary Actions**: Less prominent, neutral colors
4. **Destructive Actions**: Separate, warning colors (red)

## Spacing & Alignment

- Consistent padding/margins throughout
- Related elements grouped with whitespace
- Grid-based alignment preferred
- No orphaned elements

## Colors

- Maximum 3-4 colors in palette
- Sufficient contrast (WCAG 2.1 AA minimum)
- Consistent color meanings (red=danger, green=success)
- Dark mode consideration

## Typography

- Maximum 2 font families
- Clear hierarchy (headings, body, captions)
- Readable font sizes (16px minimum for body)

## Interactive States

ALL interactive elements need:

- Default state
- Hover state
- Focus state (keyboard navigation)
- Active/pressed state
- Disabled state (when applicable)

## Premium UI Indicators

A polished UI should have:

- Subtle shadows for depth
- Rounded corners (consistent radius)
- Smooth transitions (200-300ms)
- Micro-interactions on key actions
- Loading states for async operations

## Rejection Triggers

❌ **REJECT** any UI that:

- Uses default browser styling
- Has no hover/focus states
- Uses harsh color contrasts
- Has inconsistent spacing
- Lacks visual hierarchy
- Appears "flat" or "basic"
