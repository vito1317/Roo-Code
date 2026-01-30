/**
 * Specs Manager - Kiro-style Spec-driven Development
 *
 * Manages structured specification files:
 * - requirements.md: User requirements and business context
 * - design.md: Technical design and architecture
 * - tasks.md: Task breakdown with dependencies
 */

import * as fs from "fs/promises"
import * as path from "path"

/**
 * Configuration for specs files
 */
export interface SpecsConfig {
	/** Directory for specs files (default: .specs/) */
	specsDir: string
	/** Requirements file name */
	requirementsFile: string
	/** Design file name */
	designFile: string
	/** Tasks file name */
	tasksFile: string
}

/**
 * Default specs configuration
 */
export const DEFAULT_SPECS_CONFIG: SpecsConfig = {
	specsDir: ".specs",
	requirementsFile: "requirements.md",
	designFile: "design.md",
	tasksFile: "tasks.md",
}

/**
 * Parsed requirements structure
 */
export interface RequirementsSpec {
	vision?: string
	personas?: string[]
	userJourneys?: string[]
	successMetrics?: string[]
	constraints?: string[]
}

/**
 * Parsed design structure
 */
export interface DesignSpec {
	architectureOverview?: string
	components?: Array<{
		name: string
		description: string
		dependencies?: string[]
	}>
	dataFlow?: string
	apiDefinitions?: string
	uiConsiderations?: string
}

/**
 * Task item structure
 */
export interface TaskItem {
	id: string
	title: string
	description?: string
	status: "todo" | "in-progress" | "done"
	dependencies?: string[]
	complexity?: "low" | "medium" | "high"
	assignedAgent?: string
	acceptanceCriteria?: string[]
}

/**
 * Parsed tasks structure
 */
export interface TasksSpec {
	tasks: TaskItem[]
}

/**
 * Full specs data
 */
export interface SpecsData {
	requirements?: RequirementsSpec
	design?: DesignSpec
	tasks?: TasksSpec
	raw?: {
		requirements?: string
		design?: string
		tasks?: string
	}
}

/**
 * Specs Manager class
 * Handles creation, reading, and updating of specs files
 */
export class SpecsManager {
	private config: SpecsConfig
	private workspaceRoot: string

	constructor(workspaceRoot: string, config: Partial<SpecsConfig> = {}) {
		this.workspaceRoot = workspaceRoot
		this.config = { ...DEFAULT_SPECS_CONFIG, ...config }
	}

	/**
	 * Get the full path to the specs directory
	 */
	getSpecsPath(): string {
		return path.join(this.workspaceRoot, this.config.specsDir)
	}

	/**
	 * Get path to a specific specs file
	 */
	getFilePath(fileType: "requirements" | "design" | "tasks"): string {
		const fileMap = {
			requirements: this.config.requirementsFile,
			design: this.config.designFile,
			tasks: this.config.tasksFile,
		}
		return path.join(this.getSpecsPath(), fileMap[fileType])
	}

	/**
	 * Check if specs directory exists
	 */
	async specsExists(): Promise<boolean> {
		try {
			await fs.access(this.getSpecsPath())
			return true
		} catch {
			return false
		}
	}

	/**
	 * Check if a specific specs file exists
	 */
	async fileExists(fileType: "requirements" | "design" | "tasks"): Promise<boolean> {
		try {
			await fs.access(this.getFilePath(fileType))
			return true
		} catch {
			return false
		}
	}

	/**
	 * Initialize specs directory with template files
	 */
	async initializeSpecs(projectName: string, description?: string): Promise<void> {
		const specsPath = this.getSpecsPath()

		// Create specs directory
		await fs.mkdir(specsPath, { recursive: true })

		// Create requirements.md
		const requirementsContent = this.generateRequirementsTemplate(projectName, description)
		await fs.writeFile(this.getFilePath("requirements"), requirementsContent, "utf-8")

		// Create design.md (empty template)
		const designContent = this.generateDesignTemplate(projectName)
		await fs.writeFile(this.getFilePath("design"), designContent, "utf-8")

		// Create tasks.md (empty template)
		const tasksContent = this.generateTasksTemplate(projectName)
		await fs.writeFile(this.getFilePath("tasks"), tasksContent, "utf-8")
	}

	/**
	 * Generate requirements.md template
	 */
	private generateRequirementsTemplate(projectName: string, description?: string): string {
		return `# ${projectName} - Requirements

## Vision Statement

${description || "<!-- Describe the core objective and vision of this project -->"}

## User Personas

<!-- Define who will use this application -->

- **Primary User**: 
  - Role: 
  - Goals: 
  - Pain Points: 

## Core User Journeys

<!-- Step-by-step flows for key features -->

### Journey 1: [Name]

1. User [action]
2. System [response]
3. User [action]

## Success Metrics

<!-- How will we measure success? -->

- [ ] Metric 1: 
- [ ] Metric 2: 

## Constraints & Assumptions

<!-- Technical or business constraints -->

- **Technical**: 
- **Timeline**: 
- **Budget**: 

---

*Last updated: ${new Date().toISOString().split("T")[0]}*
`
	}

	/**
	 * Generate design.md template
	 */
	private generateDesignTemplate(projectName: string): string {
		return `# ${projectName} - Design

## Architecture Overview

\`\`\`mermaid
graph TD
    A[Client] --> B[Application]
    B --> C[Database]
\`\`\`

## Component Breakdown

### Component 1: [Name]

- **Purpose**: 
- **Dependencies**: 
- **Interface**: 

## Data Flow

<!-- Describe how data moves through the system -->

## API Definitions

<!-- Link to OpenAPI specs or GraphQL schemas -->

## UI/UX Considerations

<!-- Key design decisions for the user interface -->

---

*Last updated: ${new Date().toISOString().split("T")[0]}*
`
	}

	/**
	 * Generate tasks.md template
	 */
	private generateTasksTemplate(projectName: string): string {
		return `# ${projectName} - Tasks

## Task Breakdown

### Phase 1: Setup

- [ ] **TASK-001**: Project initialization
  - Complexity: Low
  - Agent: Builder
  - Criteria: Project structure created

### Phase 2: Core Features

- [ ] **TASK-002**: [Feature name]
  - Complexity: Medium
  - Agent: Builder
  - Depends on: TASK-001
  - Criteria: 

### Phase 3: Testing & Polish

- [ ] **TASK-003**: Unit tests
  - Complexity: Medium
  - Agent: QA
  - Depends on: TASK-002

## Progress Summary

| Status | Count |
|--------|-------|
| ✅ Done | 0 |
| 🔄 In Progress | 0 |
| ⏳ Todo | 3 |

---

*Last updated: ${new Date().toISOString().split("T")[0]}*
`
	}

	/**
	 * Read a specs file
	 */
	async readFile(fileType: "requirements" | "design" | "tasks"): Promise<string | null> {
		try {
			const content = await fs.readFile(this.getFilePath(fileType), "utf-8")
			return content
		} catch {
			return null
		}
	}

	/**
	 * Write to a specs file
	 */
	async writeFile(fileType: "requirements" | "design" | "tasks", content: string): Promise<void> {
		const filePath = this.getFilePath(fileType)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content, "utf-8")
	}

	/**
	 * Read all specs files
	 */
	async readAllSpecs(): Promise<SpecsData> {
		const [requirements, design, tasks] = await Promise.all([
			this.readFile("requirements"),
			this.readFile("design"),
			this.readFile("tasks"),
		])

		return {
			raw: {
				requirements: requirements ?? undefined,
				design: design ?? undefined,
				tasks: tasks ?? undefined,
			},
			requirements: requirements ? this.parseRequirements(requirements) : undefined,
			design: design ? this.parseDesign(design) : undefined,
			tasks: tasks ? this.parseTasks(tasks) : undefined,
		}
	}

	/**
	 * Parse requirements.md content
	 */
	private parseRequirements(content: string): RequirementsSpec {
		const spec: RequirementsSpec = {}

		// Extract vision (content after "## Vision Statement")
		const visionMatch = content.match(/## Vision Statement\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (visionMatch) {
			spec.vision = visionMatch[1].trim().replace(/<!--.*?-->/g, "").trim()
		}

		// Extract personas
		const personasMatch = content.match(/## User Personas\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (personasMatch) {
			spec.personas = personasMatch[1]
				.split(/\n-\s+\*\*/)
				.filter((p) => p.trim())
				.map((p) => p.replace(/\*\*/g, "").trim())
		}

		// Extract success metrics
		const metricsMatch = content.match(/## Success Metrics\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (metricsMatch) {
			spec.successMetrics = metricsMatch[1]
				.split(/\n-\s+\[.\]\s+/)
				.filter((m) => m.trim())
				.map((m) => m.trim())
		}

		return spec
	}

	/**
	 * Parse design.md content
	 */
	private parseDesign(content: string): DesignSpec {
		const spec: DesignSpec = {}

		// Extract architecture overview
		const archMatch = content.match(/## Architecture Overview\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (archMatch) {
			spec.architectureOverview = archMatch[1].trim()
		}

		// Extract UI considerations
		const uiMatch = content.match(/## UI\/UX Considerations\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (uiMatch) {
			spec.uiConsiderations = uiMatch[1].trim()
		}

		return spec
	}

	/**
	 * Parse tasks.md content
	 */
	private parseTasks(content: string): TasksSpec {
		const tasks: TaskItem[] = []

		// Match task lines: - [ ] **TASK-XXX**: Title or - [x] **TASK-XXX**: Title
		const taskRegex = /- \[([ xX/])\] \*\*([A-Z]+-\d+)\*\*:\s*([^\n]+)/g
		let match

		while ((match = taskRegex.exec(content)) !== null) {
			const statusChar = match[1].toLowerCase()
			const status: TaskItem["status"] =
				statusChar === "x" ? "done" : statusChar === "/" ? "in-progress" : "todo"

			tasks.push({
				id: match[2],
				title: match[3].trim(),
				status,
			})
		}

		return { tasks }
	}

	/**
	 * Update task status in tasks.md
	 */
	async updateTaskStatus(taskId: string, status: TaskItem["status"]): Promise<void> {
		const content = await this.readFile("tasks")
		if (!content) return

		const statusChar = status === "done" ? "x" : status === "in-progress" ? "/" : " "
		const updated = content.replace(
			new RegExp(`- \\[[ xX/]\\] \\*\\*${taskId}\\*\\*:`, "g"),
			`- [${statusChar}] **${taskId}**:`
		)

		await this.writeFile("tasks", updated)
	}

	/**
	 * Convert specs to handoff context format
	 */
	async toHandoffContext(): Promise<Record<string, unknown>> {
		const specs = await this.readAllSpecs()

		return {
			specsPath: this.getSpecsPath(),
			hasSpecs: await this.specsExists(),
			requirementsSummary: specs.requirements?.vision,
			designDecisions: specs.design?.architectureOverview,
			taskCount: specs.tasks?.tasks.length ?? 0,
			tasksDone: specs.tasks?.tasks.filter((t) => t.status === "done").length ?? 0,
			tasksInProgress: specs.tasks?.tasks.filter((t) => t.status === "in-progress").length ?? 0,
		}
	}
}

export default SpecsManager
