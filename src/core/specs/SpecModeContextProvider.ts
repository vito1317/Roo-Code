/**
 * SpecModeContextProvider - Dynamic prompt injection for Spec Mode
 *
 * This module provides dynamic context for Spec mode by checking which
 * spec files exist and generating appropriate prompts for each workflow phase.
 */

import * as path from "path"
import * as fs from "fs"

export type SpecPhase = "requirements" | "design" | "tasks" | "execution"

export interface SpecFilesStatus {
	requirementsExists: boolean
	designExists: boolean
	tasksExists: boolean
	specsDirectoryExists: boolean
}

export interface SpecModeContext {
	currentPhase: SpecPhase
	filesStatus: SpecFilesStatus
	dynamicPrompt: string
}

/**
 * Check which spec files exist in the workspace
 */
export function checkSpecFilesStatus(workspacePath: string): SpecFilesStatus {
	const specsDir = path.join(workspacePath, ".specs")
	const specsDirectoryExists = fs.existsSync(specsDir)

	return {
		specsDirectoryExists,
		requirementsExists: specsDirectoryExists && fs.existsSync(path.join(specsDir, "requirements.md")),
		designExists: specsDirectoryExists && fs.existsSync(path.join(specsDir, "design.md")),
		tasksExists: specsDirectoryExists && fs.existsSync(path.join(specsDir, "tasks.md")),
	}
}

/**
 * Determine current workflow phase based on file existence
 */
export function determineCurrentPhase(status: SpecFilesStatus): SpecPhase {
	if (!status.requirementsExists) {
		return "requirements"
	}
	if (!status.designExists) {
		return "design"
	}
	if (!status.tasksExists) {
		return "tasks"
	}
	return "execution"
}

/**
 * Generate dynamic prompt based on current phase
 */
export function generateSpecModePrompt(status: SpecFilesStatus): string {
	const phase = determineCurrentPhase(status)

	const statusIndicators = [
		status.requirementsExists ? "✅" : "⬜",
		status.designExists ? "✅" : "⬜",
		status.tasksExists ? "✅" : "⬜",
	]

	const header = `
## 📊 SPEC WORKFLOW STATUS
\`\`\`
${statusIndicators[0]} Requirements  ${status.requirementsExists ? "(.specs/requirements.md)" : "- Not created"}
${statusIndicators[1]} Design        ${status.designExists ? "(.specs/design.md)" : "- Not created"}
${statusIndicators[2]} Tasks         ${status.tasksExists ? "(.specs/tasks.md)" : "- Not created"}
\`\`\`

**Current Phase: ${phase.toUpperCase()}**
`

	switch (phase) {
		case "requirements":
			return (
				header +
				`
## 📋 PHASE 1: Requirements Gathering

You are in the **Requirements Phase**. Your task is to:

1. **Gather project requirements** from the user by asking questions
2. **Create \`.specs/requirements.md\`** with:
   - Business requirements
   - Functional requirements
   - Non-functional requirements (performance, security, etc.)
   - Acceptance criteria
   - Constraints and assumptions

3. **Ask user to confirm** the requirements before proceeding

**IMPORTANT:**
- Do NOT skip this phase
- Do NOT create design.md or tasks.md yet
- Focus on understanding WHAT the user wants to build

**When ready, create the file:**
\`\`\`bash
mkdir -p .specs && touch .specs/requirements.md
\`\`\`
`
			)

		case "design":
			return (
				header +
				`
## 🎨 PHASE 2: Design

You are in the **Design Phase**. Requirements are complete.

1. **Read \`.specs/requirements.md\`** to understand what needs to be built
2. **Create \`.specs/design.md\`** with:
   - Architecture overview (include Mermaid diagram)
   - Component structure
   - Data models / Database schema
   - API design (if applicable)
   - UI/UX considerations (if applicable)
   - Technology stack decisions

3. **Ask user to confirm** the design before proceeding

**IMPORTANT:**
- Base your design on the requirements
- Include visual diagrams where helpful
- Do NOT create tasks.md yet
`
			)

		case "tasks":
			return (
				header +
				`
## ✅ PHASE 3: Task Breakdown

You are in the **Task Breakdown Phase**. Requirements and Design are complete.

1. **Read \`.specs/requirements.md\`** and **\`.specs/design.md\`**
2. **Create \`.specs/tasks.md\`** with task list:

**Task Format:**
\`\`\`markdown
## Task List

### Phase 1: Setup
- [ ] Task 1: Project initialization (complexity: low)
- [ ] Task 2: Database setup (complexity: medium)

### Phase 2: Core Features
- [ ] Task 3: User authentication (complexity: high)
  - Dependencies: Task 1
\`\`\`

3. **Ask user to confirm** tasks before execution

**IMPORTANT:**
- Break down into small, actionable tasks
- Include complexity estimates (low/medium/high)
- Note dependencies between tasks
`
			)

		case "execution":
			return (
				header +
				`
## 🚀 PHASE 4: Task Execution

All spec files are ready. You can now execute tasks.

**Available Commands:**
- Execute next task: Use \`new_task\` with \`mode: "sentinel-architect"\`
- Run all tasks: Use \`run_all_spec_tasks\`

**Each task will go through the Sentinel Pipeline:**
Architect → Designer → Builder → QA → Security → Final Review

**Task Status in tasks.md:**
- \`[ ]\` = pending
- \`[/]\` = in progress
- \`[x]\` = completed

**To start execution:**
1. Read \`.specs/tasks.md\` to see task list
2. Use Sentinel pipeline for each task
3. Status will be auto-updated in tasks.md
`
			)

		default:
			return header
	}
}

/**
 * Get complete Spec Mode context for prompt injection
 */
export function getSpecModeContext(workspacePath: string): SpecModeContext {
	const filesStatus = checkSpecFilesStatus(workspacePath)
	const currentPhase = determineCurrentPhase(filesStatus)
	const dynamicPrompt = generateSpecModePrompt(filesStatus)

	return {
		currentPhase,
		filesStatus,
		dynamicPrompt,
	}
}
