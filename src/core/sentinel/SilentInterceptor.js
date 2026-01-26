/**
 * Sentinel Edition - Silent Interceptor
 *
 * Automatically answers common environment questions without user interaction.
 * This prevents the AI from asking users about information that can be
 * programmatically determined from the project files.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
/**
 * Silent Interceptor
 *
 * Intercepts common "ask" questions and provides automatic answers
 * by analyzing the project structure and configuration files.
 */
export class SilentInterceptor {
    patterns;
    packageJsonCache = new Map();
    constructor() {
        this.patterns = [
            // Framework detection
            {
                regex: /什麼框架|which framework|what framework|使用.*框架/i,
                resolver: async (cwd) => this.detectFramework(cwd),
                description: "Detect project framework",
            },
            // Node version
            {
                regex: /node\s*version|node\s*版本|nodejs.*版本/i,
                resolver: async () => this.getNodeVersion(),
                description: "Get Node.js version",
            },
            // Package manager
            {
                regex: /package\s*manager|套件管理|npm.*yarn.*pnpm/i,
                resolver: async (cwd) => this.detectPackageManager(cwd),
                description: "Detect package manager",
            },
            // Project structure
            {
                regex: /專案結構|project\s*structure|目錄結構|folder\s*structure/i,
                resolver: async (cwd) => this.generateProjectTree(cwd),
                description: "Generate project structure",
            },
            // Available scripts
            {
                regex: /可用.*scripts?|available\s*scripts?|npm\s*scripts?|可以執行/i,
                resolver: async (cwd) => this.getAvailableScripts(cwd),
                description: "Get available npm scripts",
            },
            // Database type
            {
                regex: /資料庫|database|db\s*type|使用.*db/i,
                resolver: async (cwd) => this.detectDatabase(cwd),
                description: "Detect database type",
            },
            // Test framework
            {
                regex: /測試框架|test\s*framework|testing\s*library/i,
                resolver: async (cwd) => this.detectTestFramework(cwd),
                description: "Detect test framework",
            },
            // TypeScript config
            {
                regex: /typescript.*config|tsconfig|ts設定/i,
                resolver: async (cwd) => this.getTsConfig(cwd),
                description: "Get TypeScript configuration",
            },
            // Port/URL questions
            {
                regex: /什麼port|which\s*port|dev\s*server.*port|開發.*port/i,
                resolver: async (cwd) => this.detectDevPort(cwd),
                description: "Detect development server port",
            },
            // Entry point
            {
                regex: /entry\s*point|main\s*file|進入點|主程式/i,
                resolver: async (cwd) => this.getEntryPoint(cwd),
                description: "Get project entry point",
            },
        ];
    }
    /**
     * Attempt to intercept and auto-answer a question
     * Returns null if no pattern matched
     */
    async interceptAsk(question, cwd) {
        for (const pattern of this.patterns) {
            if (pattern.regex.test(question)) {
                try {
                    const answer = await pattern.resolver(cwd);
                    console.log(`[SilentInterceptor] Auto-answered: ${pattern.description}`);
                    return answer;
                }
                catch (error) {
                    console.warn(`[SilentInterceptor] Failed to resolve: ${pattern.description}`, error);
                    // Continue to check other patterns
                }
            }
        }
        return null;
    }
    /**
     * Read and cache package.json
     */
    async readPackageJson(cwd) {
        if (this.packageJsonCache.has(cwd)) {
            return this.packageJsonCache.get(cwd);
        }
        try {
            const pkgPath = path.join(cwd, "package.json");
            const content = await fs.readFile(pkgPath, "utf-8");
            const pkg = JSON.parse(content);
            this.packageJsonCache.set(cwd, pkg);
            return pkg;
        }
        catch {
            return null;
        }
    }
    /**
     * Detect the primary framework used in the project
     */
    async detectFramework(cwd) {
        const pkg = await this.readPackageJson(cwd);
        if (!pkg) {
            return "Unable to detect framework - no package.json found";
        }
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const frameworks = [];
        // Frontend frameworks
        if (deps["next"])
            frameworks.push(`Next.js ${deps["next"]}`);
        else if (deps["nuxt"])
            frameworks.push(`Nuxt ${deps["nuxt"]}`);
        else if (deps["@angular/core"])
            frameworks.push(`Angular ${deps["@angular/core"]}`);
        else if (deps["vue"])
            frameworks.push(`Vue.js ${deps["vue"]}`);
        else if (deps["react"])
            frameworks.push(`React ${deps["react"]}`);
        else if (deps["svelte"])
            frameworks.push(`Svelte ${deps["svelte"]}`);
        // Backend frameworks
        if (deps["express"])
            frameworks.push(`Express ${deps["express"]}`);
        if (deps["fastify"])
            frameworks.push(`Fastify ${deps["fastify"]}`);
        if (deps["koa"])
            frameworks.push(`Koa ${deps["koa"]}`);
        if (deps["@nestjs/core"])
            frameworks.push(`NestJS ${deps["@nestjs/core"]}`);
        if (deps["hono"])
            frameworks.push(`Hono ${deps["hono"]}`);
        // Full-stack
        if (deps["@remix-run/react"])
            frameworks.push("Remix");
        if (deps["astro"])
            frameworks.push(`Astro ${deps["astro"]}`);
        // Mobile
        if (deps["react-native"])
            frameworks.push(`React Native ${deps["react-native"]}`);
        if (deps["expo"])
            frameworks.push(`Expo ${deps["expo"]}`);
        if (frameworks.length === 0) {
            return "No major framework detected - appears to be a vanilla JavaScript/TypeScript project";
        }
        return `Detected frameworks: ${frameworks.join(", ")}`;
    }
    /**
     * Get Node.js version
     */
    async getNodeVersion() {
        try {
            const version = execSync("node --version", { encoding: "utf-8" }).trim();
            const npmVersion = execSync("npm --version", { encoding: "utf-8" }).trim();
            return `Node.js ${version}, npm ${npmVersion}`;
        }
        catch {
            return "Unable to determine Node.js version";
        }
    }
    /**
     * Detect which package manager is used
     */
    async detectPackageManager(cwd) {
        const checks = [
            { file: "pnpm-lock.yaml", name: "pnpm" },
            { file: "yarn.lock", name: "yarn" },
            { file: "bun.lockb", name: "bun" },
            { file: "package-lock.json", name: "npm" },
        ];
        for (const check of checks) {
            try {
                await fs.access(path.join(cwd, check.file));
                return `Package manager: ${check.name} (detected from ${check.file})`;
            }
            catch {
                // Continue checking
            }
        }
        return "Package manager: npm (default, no lockfile detected)";
    }
    /**
     * Generate a simplified project directory tree
     */
    async generateProjectTree(cwd, depth = 2) {
        const lines = ["Project structure:"];
        const walk = async (dir, prefix, currentDepth) => {
            if (currentDepth > depth)
                return;
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                const filtered = entries.filter((e) => !e.name.startsWith(".") && !["node_modules", "dist", "build", ".git"].includes(e.name));
                for (let i = 0; i < filtered.length; i++) {
                    const entry = filtered[i];
                    const isLast = i === filtered.length - 1;
                    const connector = isLast ? "└── " : "├── ";
                    const newPrefix = isLast ? "    " : "│   ";
                    if (entry.isDirectory()) {
                        lines.push(`${prefix}${connector}${entry.name}/`);
                        await walk(path.join(dir, entry.name), prefix + newPrefix, currentDepth + 1);
                    }
                    else {
                        lines.push(`${prefix}${connector}${entry.name}`);
                    }
                }
            }
            catch {
                // Permission or access error
            }
        };
        await walk(cwd, "", 0);
        return lines.join("\n");
    }
    /**
     * Get available npm scripts
     */
    async getAvailableScripts(cwd) {
        const pkg = await this.readPackageJson(cwd);
        if (!pkg?.scripts) {
            return "No npm scripts found in package.json";
        }
        const lines = ["Available npm scripts:"];
        for (const [name, command] of Object.entries(pkg.scripts)) {
            lines.push(`  - ${name}: ${command}`);
        }
        return lines.join("\n");
    }
    /**
     * Detect database type from dependencies
     */
    async detectDatabase(cwd) {
        const pkg = await this.readPackageJson(cwd);
        if (!pkg) {
            return "Unable to detect database - no package.json found";
        }
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const databases = [];
        // ORMs and query builders
        if (deps["prisma"] || deps["@prisma/client"])
            databases.push("Prisma ORM");
        if (deps["typeorm"])
            databases.push("TypeORM");
        if (deps["sequelize"])
            databases.push("Sequelize");
        if (deps["drizzle-orm"])
            databases.push("Drizzle ORM");
        if (deps["mongoose"])
            databases.push("MongoDB (Mongoose)");
        if (deps["knex"])
            databases.push("Knex.js");
        // Direct database drivers
        if (deps["pg"])
            databases.push("PostgreSQL");
        if (deps["mysql2"] || deps["mysql"])
            databases.push("MySQL");
        if (deps["better-sqlite3"] || deps["sqlite3"])
            databases.push("SQLite");
        if (deps["mongodb"])
            databases.push("MongoDB");
        if (deps["redis"] || deps["ioredis"])
            databases.push("Redis");
        if (databases.length === 0) {
            return "No database dependencies detected";
        }
        return `Detected databases/ORMs: ${databases.join(", ")}`;
    }
    /**
     * Detect test framework
     */
    async detectTestFramework(cwd) {
        const pkg = await this.readPackageJson(cwd);
        if (!pkg) {
            return "Unable to detect test framework - no package.json found";
        }
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const frameworks = [];
        if (deps["vitest"])
            frameworks.push(`Vitest ${deps["vitest"]}`);
        if (deps["jest"])
            frameworks.push(`Jest ${deps["jest"]}`);
        if (deps["mocha"])
            frameworks.push(`Mocha ${deps["mocha"]}`);
        if (deps["playwright"])
            frameworks.push(`Playwright ${deps["playwright"]}`);
        if (deps["cypress"])
            frameworks.push(`Cypress ${deps["cypress"]}`);
        if (deps["@testing-library/react"])
            frameworks.push("React Testing Library");
        if (frameworks.length === 0) {
            return "No test framework detected";
        }
        return `Test frameworks: ${frameworks.join(", ")}`;
    }
    /**
     * Get TypeScript configuration summary
     */
    async getTsConfig(cwd) {
        try {
            const tsconfigPath = path.join(cwd, "tsconfig.json");
            const content = await fs.readFile(tsconfigPath, "utf-8");
            const tsconfig = JSON.parse(content);
            const options = tsconfig.compilerOptions || {};
            const summary = [
                "TypeScript configuration:",
                `  Target: ${options.target || "not specified"}`,
                `  Module: ${options.module || "not specified"}`,
                `  Strict: ${options.strict ?? "not specified"}`,
                `  outDir: ${options.outDir || "not specified"}`,
                `  rootDir: ${options.rootDir || "not specified"}`,
            ];
            return summary.join("\n");
        }
        catch {
            return "No tsconfig.json found";
        }
    }
    /**
     * Detect development server port
     */
    async detectDevPort(cwd) {
        const pkg = await this.readPackageJson(cwd);
        if (!pkg?.scripts) {
            return "Unable to determine dev port - check start/dev script";
        }
        // Common dev script patterns
        const devScript = pkg.scripts.dev || pkg.scripts.start || "";
        // Look for port in script
        const portMatch = devScript.match(/-p\s*(\d+)|--port\s*(\d+)|PORT=(\d+)|:(\d+)/);
        if (portMatch) {
            const port = portMatch[1] || portMatch[2] || portMatch[3] || portMatch[4];
            return `Development server port: ${port}`;
        }
        // Default ports by framework
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps["next"])
            return "Development port: 3000 (Next.js default)";
        if (deps["vite"])
            return "Development port: 5173 (Vite default)";
        if (deps["@angular/core"])
            return "Development port: 4200 (Angular default)";
        if (deps["vue"])
            return "Development port: 5173 (Vue/Vite default) or 8080 (Vue CLI)";
        if (deps["react-scripts"])
            return "Development port: 3000 (Create React App default)";
        return "Unable to determine dev port - likely 3000 or check package.json scripts";
    }
    /**
     * Get project entry point
     */
    async getEntryPoint(cwd) {
        const pkg = await this.readPackageJson(cwd);
        if (pkg?.main) {
            return `Entry point: ${pkg.main}`;
        }
        // Check common entry points
        const candidates = ["src/index.ts", "src/index.js", "src/main.ts", "src/main.js", "index.ts", "index.js"];
        for (const candidate of candidates) {
            try {
                await fs.access(path.join(cwd, candidate));
                return `Entry point: ${candidate}`;
            }
            catch {
                // Continue checking
            }
        }
        return "Unable to determine entry point - no main field in package.json and no common entry files found";
    }
    /**
     * Clear cached data
     */
    clearCache() {
        this.packageJsonCache.clear();
    }
}
/**
 * Global singleton instance
 */
let interceptorInstance = null;
/**
 * Get or create the singleton silent interceptor
 */
export function getSilentInterceptor() {
    if (!interceptorInstance) {
        interceptorInstance = new SilentInterceptor();
    }
    return interceptorInstance;
}
//# sourceMappingURL=SilentInterceptor.js.map