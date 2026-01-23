/**
 * Parallel UI Tasks Tool Description
 *
 * Provides the prompt description for the parallel_ui_tasks tool.
 */

export function getParallelUITasksDescription(): string {
	return `## parallel_ui_tasks

Description: Execute multiple UI drawing tasks in parallel using separate AI agents. Each agent independently draws a specific UI component or section in Figma. This tool is useful when you need to create complex UIs with multiple components that can be drawn simultaneously.

Parameters:
- tasks: (required) A JSON array of task definitions. Each task should have:
  - id: (required) Unique identifier for the task
  - description: (required) Description of what UI element to create
  - targetFrame: (optional) Name of the target frame in Figma
  - position: (optional) Position offset { x: number, y: number } for the task's elements
  - designSpec: (optional) Design specifications:
    - width: Width in pixels
    - height: Height in pixels
    - style: Style description (e.g., "modern", "minimal")
    - colors: Array of hex color codes to use

Usage:
<parallel_ui_tasks>
<tasks>
[
  {
    "id": "header",
    "description": "Create a navigation header with logo and menu items",
    "position": { "x": 0, "y": 0 },
    "designSpec": { "width": 1440, "height": 80, "style": "modern" }
  },
  {
    "id": "hero",
    "description": "Create a hero section with headline and CTA button",
    "position": { "x": 0, "y": 80 },
    "designSpec": { "width": 1440, "height": 600, "colors": ["#0EA5E9", "#1E293B"] }
  },
  {
    "id": "features",
    "description": "Create a 3-column feature grid with icons",
    "position": { "x": 0, "y": 680 },
    "designSpec": { "width": 1440, "height": 400 }
  }
]
</tasks>
</parallel_ui_tasks>

Benefits:
1. **Speed**: Multiple components are drawn simultaneously, reducing total time
2. **Scalability**: Handle complex UIs by dividing work among agents
3. **Independence**: Each agent works on its section without conflicts

Best Practices:
- Assign clear position offsets to prevent overlapping
- Keep task descriptions specific and focused
- Use design specs to ensure consistency across components
- Group related elements into logical tasks`
}
