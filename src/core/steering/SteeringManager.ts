/**
 * Steering Manager - Kiro-style Project Steering Files
 *
 * Manages project-level steering files that guide AI behavior:
 * - product.md: Business context, user personas, success metrics
 * - structure.md: Technical architecture, dependency graph, API specs
 */

import * as fs from "fs/promises"
import * as path from "path"

/**
 * Configuration for steering files
 */
export interface SteeringConfig {
	/** Product file name */
	productFile: string
	/** Structure file name */
	structureFile: string
}

/**
 * Default steering configuration
 */
export const DEFAULT_STEERING_CONFIG: SteeringConfig = {
	productFile: "product.md",
	structureFile: "structure.md",
}

/**
 * Parsed product.md content
 */
export interface ProductContext {
	/** Application/project name */
	name?: string
	/** Vision statement */
	vision?: string
	/** Target audience */
	audience?: string[]
	/** User personas */
	personas?: Array<{
		name: string
		description: string
		goals?: string[]
	}>
	/** Key features */
	features?: string[]
	/** Success metrics */
	successMetrics?: string[]
	/** AWS/Cloud services used */
	awsServices?: string[]
}

/**
 * Parsed structure.md content
 */
export interface StructureContext {
	/** Repository structure */
	directoryMap?: string
	/** Key dependencies */
	dependencies?: Array<{
		name: string
		version?: string
		purpose?: string
	}>
	/** State management approach */
	stateManagement?: string
	/** API definitions */
	apiDefinitions?: string
	/** Deployment pipeline */
	deploymentPipeline?: string
	/** Tech stack */
	techStack?: {
		frontend?: string[]
		backend?: string[]
		database?: string
		testing?: string[]
	}
}

/**
 * Full steering context
 */
export interface SteeringContext {
	product?: ProductContext
	structure?: StructureContext
	raw?: {
		product?: string
		structure?: string
	}
}

/**
 * Steering Manager class
 * Handles reading and applying project steering files
 */
export class SteeringManager {
	private config: SteeringConfig
	private workspaceRoot: string

	constructor(workspaceRoot: string, config: Partial<SteeringConfig> = {}) {
		this.workspaceRoot = workspaceRoot
		this.config = { ...DEFAULT_STEERING_CONFIG, ...config }
	}

	/**
	 * Get path to product.md
	 */
	getProductPath(): string {
		return path.join(this.workspaceRoot, this.config.productFile)
	}

	/**
	 * Get path to structure.md
	 */
	getStructurePath(): string {
		return path.join(this.workspaceRoot, this.config.structureFile)
	}

	/**
	 * Check if product.md exists
	 */
	async hasProduct(): Promise<boolean> {
		try {
			await fs.access(this.getProductPath())
			return true
		} catch {
			return false
		}
	}

	/**
	 * Check if structure.md exists
	 */
	async hasStructure(): Promise<boolean> {
		try {
			await fs.access(this.getStructurePath())
			return true
		} catch {
			return false
		}
	}

	/**
	 * Read product.md
	 */
	async readProduct(): Promise<string | null> {
		try {
			return await fs.readFile(this.getProductPath(), "utf-8")
		} catch {
			return null
		}
	}

	/**
	 * Read structure.md
	 */
	async readStructure(): Promise<string | null> {
		try {
			return await fs.readFile(this.getStructurePath(), "utf-8")
		} catch {
			return null
		}
	}

	/**
	 * Parse product.md content
	 */
	private parseProduct(content: string): ProductContext {
		const context: ProductContext = {}

		// Extract name from first heading
		const nameMatch = content.match(/^#\s+(.+?)(?:\s*-|$)/m)
		if (nameMatch) {
			context.name = nameMatch[1].trim()
		}

		// Extract vision
		const visionMatch = content.match(/## Vision(?: Statement)?\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (visionMatch) {
			context.vision = visionMatch[1].trim().replace(/<!--.*?-->/g, "").trim()
		}

		// Extract features
		const featuresMatch = content.match(/## (?:Key )?Features?\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (featuresMatch) {
			context.features = featuresMatch[1]
				.split(/\n-\s+/)
				.filter((f) => f.trim())
				.map((f) => f.replace(/\*\*/g, "").trim())
		}

		// Extract success metrics
		const metricsMatch = content.match(/## Success Metrics\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (metricsMatch) {
			context.successMetrics = metricsMatch[1]
				.split(/\n-\s+/)
				.filter((m) => m.trim())
				.map((m) => m.trim())
		}

		// Extract AWS services
		const awsMatch = content.match(/## AWS(?: Service)?(?: Map)?\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (awsMatch) {
			context.awsServices = awsMatch[1]
				.split(/\n-\s+/)
				.filter((s) => s.trim())
				.map((s) => s.trim())
		}

		return context
	}

	/**
	 * Parse structure.md content
	 */
	private parseStructure(content: string): StructureContext {
		const context: StructureContext = {}

		// Extract directory map
		const dirMatch = content.match(/## Directory(?: Map)?\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (dirMatch) {
			context.directoryMap = dirMatch[1].trim()
		}

		// Extract state management
		const stateMatch = content.match(/## State Management\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (stateMatch) {
			context.stateManagement = stateMatch[1].trim()
		}

		// Extract API definitions
		const apiMatch = content.match(/## API(?: Definitions?)?\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (apiMatch) {
			context.apiDefinitions = apiMatch[1].trim()
		}

		// Extract deployment pipeline
		const deployMatch = content.match(/## Deployment(?: Pipeline)?\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (deployMatch) {
			context.deploymentPipeline = deployMatch[1].trim()
		}

		// Extract tech stack
		const techMatch = content.match(/## Tech(?: Stack)?\s*\n+([\s\S]*?)(?=\n## |$)/i)
		if (techMatch) {
			const techContent = techMatch[1]
			context.techStack = {}

			const frontendMatch = techContent.match(/Frontend:\s*([^\n]+)/i)
			if (frontendMatch) {
				context.techStack.frontend = frontendMatch[1].split(",").map((t) => t.trim())
			}

			const backendMatch = techContent.match(/Backend:\s*([^\n]+)/i)
			if (backendMatch) {
				context.techStack.backend = backendMatch[1].split(",").map((t) => t.trim())
			}

			const dbMatch = techContent.match(/Database:\s*([^\n]+)/i)
			if (dbMatch) {
				context.techStack.database = dbMatch[1].trim()
			}
		}

		return context
	}

	/**
	 * Read all steering files and parse
	 */
	async getSteeringContext(): Promise<SteeringContext> {
		const [productRaw, structureRaw] = await Promise.all([this.readProduct(), this.readStructure()])

		return {
			raw: {
				product: productRaw ?? undefined,
				structure: structureRaw ?? undefined,
			},
			product: productRaw ? this.parseProduct(productRaw) : undefined,
			structure: structureRaw ? this.parseStructure(structureRaw) : undefined,
		}
	}

	/**
	 * Generate system prompt injection from steering context
	 */
	async generatePromptInjection(): Promise<string> {
		const context = await this.getSteeringContext()

		const parts: string[] = []

		if (context.product) {
			parts.push("## Project Context (from product.md)")
			if (context.product.name) {
				parts.push(`**Project:** ${context.product.name}`)
			}
			if (context.product.vision) {
				parts.push(`**Vision:** ${context.product.vision}`)
			}
			if (context.product.features && context.product.features.length > 0) {
				parts.push(`**Key Features:** ${context.product.features.join(", ")}`)
			}
		}

		if (context.structure) {
			parts.push("\n## Technical Context (from structure.md)")
			if (context.structure.techStack) {
				const stack = context.structure.techStack
				if (stack.frontend) parts.push(`**Frontend:** ${stack.frontend.join(", ")}`)
				if (stack.backend) parts.push(`**Backend:** ${stack.backend.join(", ")}`)
				if (stack.database) parts.push(`**Database:** ${stack.database}`)
			}
			if (context.structure.stateManagement) {
				parts.push(`**State Management:** ${context.structure.stateManagement}`)
			}
		}

		return parts.length > 0 ? parts.join("\n") : ""
	}

	/**
	 * Create template product.md
	 */
	async createProductTemplate(projectName: string): Promise<void> {
		const template = `# ${projectName} - Product

## Vision

<!-- The core objective of this application -->

## Target Audience

<!-- Who will use this application? -->

## Key Features

- Feature 1
- Feature 2
- Feature 3

## Success Metrics

- Metric 1: Target value
- Metric 2: Target value

## Constraints

- Technical: 
- Timeline: 
- Budget: 

---

*Last updated: ${new Date().toISOString().split("T")[0]}*
`
		await fs.writeFile(this.getProductPath(), template, "utf-8")
	}

	/**
	 * Create template structure.md
	 */
	async createStructureTemplate(projectName: string): Promise<void> {
		const template = `# ${projectName} - Structure

## Directory Map

\`\`\`
${projectName}/
├── src/
│   ├── components/
│   ├── services/
│   └── utils/
├── tests/
└── docs/
\`\`\`

## Tech Stack

- Frontend: React, TypeScript
- Backend: Node.js
- Database: PostgreSQL
- Testing: Jest, Playwright

## State Management

<!-- How data flows through the application -->

## API Definitions

<!-- Links to OpenAPI specs or GraphQL schemas -->

## Deployment Pipeline

1. Push to main branch
2. Run CI tests
3. Build artifacts
4. Deploy to staging
5. Deploy to production

---

*Last updated: ${new Date().toISOString().split("T")[0]}*
`
		await fs.writeFile(this.getStructurePath(), template, "utf-8")
	}
}

export default SteeringManager
