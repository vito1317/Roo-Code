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
			// 如果檔案已存在，顯示保護警告
			if (status.requirementsExists) {
				return (
					header +
					`
## 📋 PHASE 1: Requirements (⚠️ Already Exists)

**⚠️ WARNING: \`.specs/requirements.md\` already exists!**

**DO NOT** overwrite the existing file. Instead:
1. **Read the current content** first using \`read_file\`
2. **Review** what's already documented
3. **Update or append** new requirements if needed
4. **Ask user to confirm** before any changes

If the user explicitly wants to start fresh, they must confirm this action.
Otherwise, preserve the existing content!
`
				)
			}
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
			// 如果 design.md 已存在，顯示保護警告
			if (status.designExists) {
				return (
					header +
					`
## 🎨 PHASE 2: Design (⚠️ Already Exists)

**⚠️ WARNING: \`.specs/design.md\` already exists!**

**DO NOT** overwrite the existing file. Instead:
1. **Read the current content** first using \`read_file\`
2. **Review** what's already designed
3. **Update or append** new design elements if needed
4. **Ask user to confirm** before any changes

If the user explicitly wants to redesign from scratch, they must confirm.
`
				)
			}
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
			// 如果 tasks.md 已存在，顯示保護警告
			if (status.tasksExists) {
				return (
					header +
					`
## ✅ PHASE 3: Task Breakdown (⚠️ Already Exists)

**⚠️ WARNING: \`.specs/tasks.md\` already exists!**

**DO NOT** overwrite the existing file. Instead:
1. **Read the current content** first using \`read_file\`
2. **Review** what tasks are already defined and their status
3. **Update** task statuses or add new tasks if needed
4. **Ask user to confirm** before any changes

**Task Status Legend:**
- \`[ ]\` = pending
- \`[/]\` = in progress  
- \`[x]\` = completed

If the user explicitly wants to redefine tasks, they must confirm.
`
				)
			}
			return (
				header +
				`
## ✅ PHASE 3: Task Breakdown

You are in the **Task Breakdown Phase**. Requirements and Design are complete.

1. **Read \`.specs/requirements.md\`** and **\`.specs/design.md\`**
2. **Create \`.specs/tasks.md\`** with **DETAILED** task list:

**🚨 CRITICAL: Create GRANULAR tasks with FULL details!**

**Task Format (MUST follow exactly):**
\`\`\`markdown
# [Project Name] 專案任務清單

## Phase 1: [Phase Name]

### TASK-001: [Clear, specific task title] (complexity: low)

**描述:**
[2-3 sentences explaining WHAT this task does and WHY]

**涉及檔案:**
- \`path/to/file1.ext\` - [purpose]
- \`path/to/file2.ext\` - [purpose]

**驗收標準:**
- [ ] [Specific, testable criterion 1]
- [ ] [Specific, testable criterion 2]
- [ ] [Specific, testable criterion 3]

**依賴:** [TASK-XXX or "無"]
**負責:** Builder

---

### TASK-002: [Next task...] (complexity: medium)
...
\`\`\`

3. **Ask user to confirm** tasks before execution

**🎯 TASK GRANULARITY RULES:**
- Each task should take **15-60 minutes** to complete
- Each task should modify **1-5 files** maximum
- If a task affects more than 5 files, **SPLIT IT**
- Every CRUD operation is a separate task
- Configuration and implementation are separate tasks

**EXAMPLE - Wrong vs Right:**
❌ "Set up user authentication" (too broad)
✅ Split into:
  - TASK-001: Create User model and migration
  - TASK-002: Create UserController with index/store methods
  - TASK-003: Add authentication middleware
  - TASK-004: Create login/register views
  - TASK-005: Add authentication routes
  - TASK-006: Write authentication tests
`
			)

		case "execution":
			return (
				header +
				`
## 🚀 PHASE 4: Task Execution

All spec files are ready. Execute tasks **IN STRICT SEQUENCE**.

---

### 🚨 CRITICAL: SEQUENTIAL TASK EXECUTION RULES

**❌ NEVER skip tasks or work out of order!**

1. **ALWAYS read \`.specs/tasks.md\` FIRST** to check current status
2. **Find the FIRST task with \`[ ]\` status** - that is your ONLY focus
3. **DO NOT start TASK-002 until TASK-001 is marked \`[x]\`**
4. **Verify task dependencies** - if TASK-002 depends on TASK-001, TASK-001 MUST be completed first

---

### 📋 TASK EXECUTION FLOW

\`\`\`
1. Read tasks.md           → Identify first [ ] task
2. Check dependencies      → Verify all prerequisite tasks are [x]
3. Execute ONLY that task  → Focus on one task at a time
4. Verify acceptance       → All criteria must pass
5. Update status to [x]    → Mark complete in tasks.md
6. Move to next task       → Repeat from step 1
\`\`\`

---

### ⚠️ DEPENDENCY ENFORCEMENT

**Before executing ANY task, ask yourself:**
- Does this task require a project structure? → Is the project created?
- Does this task create migrations? → Does the framework/project exist?
- Does this task modify files? → Do those files exist?

**Example - WRONG:**
\`\`\`
TASK-001: 建立 Laravel 12 專案 [ ]
TASK-002: 建立 User 遷移檔 [ ]

❌ Agent creates migration without Laravel → ERROR!
\`\`\`

**Example - CORRECT:**
\`\`\`
TASK-001: 建立 Laravel 12 專案 [ ] ← Must complete this FIRST
       ↓ After TASK-001 is [x]
TASK-002: 建立 User 遷移檔 [ ] ← Only then work on this
\`\`\`

---

### Task Status in tasks.md:
- \`[ ]\` = pending (next to execute)
- \`[/]\` = in progress (currently working)
- \`[x]\` = completed (verified done)

**Each task will go through the Sentinel Pipeline:**
Architect → Designer → Builder → QA → Security → Final Review
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
