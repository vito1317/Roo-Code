import type OpenAI from "openai"

const PARALLEL_UI_TASKS_DESCRIPTION = `Execute multiple UI drawing tasks in parallel using separate AI agents. Each agent independently draws a specific UI component or section in Figma. Use 'containerFrame' to create all elements inside a specific frame.`

const TASKS_PARAMETER_DESCRIPTION = `A JSON array of task definitions. Each task should have:
- id: (required) Unique identifier for the task
- description: (required) Description of what UI element to create
- targetFrame: (optional) Name of the target frame in Figma
- position: (optional) Position offset { x: number, y: number } for the task's elements
- designSpec: (optional) Design specifications:
  - width: Width in pixels
  - height: Height in pixels
  - style: Style description (e.g., "modern", "minimal")
  - colors: Array of hex color codes [backgroundColor, textColor]
  - cornerRadius: Corner radius in pixels (use width/2 for circular buttons)
  - fontSize: Font size in pixels for text
  - text: Text content to display`

export default {
	type: "function",
	function: {
		name: "parallel_ui_tasks",
		description: PARALLEL_UI_TASKS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				tasks: {
					type: "string",
					description: TASKS_PARAMETER_DESCRIPTION,
				},
				containerFrame: {
					type: "string",
					description: "Parent frame ID to create all elements inside. Get this from create_frame result.",
				},
			},
			required: ["tasks"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
