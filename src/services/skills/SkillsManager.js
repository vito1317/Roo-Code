import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import matter from "gray-matter";
import { getGlobalRooDirectory } from "../roo-config";
import { directoryExists, fileExists } from "../roo-config";
import { modes, getAllModes } from "../../shared/modes";
export class SkillsManager {
    skills = new Map();
    providerRef;
    disposables = [];
    isDisposed = false;
    constructor(provider) {
        this.providerRef = new WeakRef(provider);
    }
    async initialize() {
        await this.discoverSkills();
        await this.setupFileWatchers();
    }
    /**
     * Discover all skills from global and project directories.
     * Supports both generic skills (skills/) and mode-specific skills (skills-{mode}/).
     * Also supports symlinks:
     * - .roo/skills can be a symlink to a directory containing skill subdirectories
     * - .roo/skills/[dirname] can be a symlink to a skill directory
     */
    async discoverSkills() {
        this.skills.clear();
        const skillsDirs = await this.getSkillsDirectories();
        for (const { dir, source, mode } of skillsDirs) {
            await this.scanSkillsDirectory(dir, source, mode);
        }
    }
    /**
     * Scan a skills directory for skill subdirectories.
     * Handles two symlink cases:
     * 1. The skills directory itself is a symlink (resolved by directoryExists using realpath)
     * 2. Individual skill subdirectories are symlinks
     */
    async scanSkillsDirectory(dirPath, source, mode) {
        if (!(await directoryExists(dirPath))) {
            return;
        }
        try {
            // Get the real path (resolves if dirPath is a symlink)
            const realDirPath = await fs.realpath(dirPath);
            // Read directory entries
            const entries = await fs.readdir(realDirPath);
            for (const entryName of entries) {
                const entryPath = path.join(realDirPath, entryName);
                // Check if this entry is a directory (follows symlinks automatically)
                const stats = await fs.stat(entryPath).catch(() => null);
                if (!stats?.isDirectory())
                    continue;
                // Load skill metadata - the skill name comes from the entry name (symlink name if symlinked)
                await this.loadSkillMetadata(entryPath, source, mode, entryName);
            }
        }
        catch {
            // Directory doesn't exist or can't be read - this is fine
        }
    }
    /**
     * Load skill metadata from a skill directory.
     * @param skillDir - The resolved path to the skill directory (target of symlink if symlinked)
     * @param source - Whether this is a global or project skill
     * @param mode - The mode this skill is specific to (undefined for generic skills)
     * @param skillName - The skill name (from symlink name if symlinked, otherwise from directory name)
     */
    async loadSkillMetadata(skillDir, source, mode, skillName) {
        const skillMdPath = path.join(skillDir, "SKILL.md");
        if (!(await fileExists(skillMdPath)))
            return;
        try {
            const fileContent = await fs.readFile(skillMdPath, "utf-8");
            // Use gray-matter to parse frontmatter
            const { data: frontmatter, content: body } = matter(fileContent);
            // Validate required fields (only name and description for now)
            if (!frontmatter.name || typeof frontmatter.name !== "string") {
                console.error(`Skill at ${skillDir} is missing required 'name' field`);
                return;
            }
            if (!frontmatter.description || typeof frontmatter.description !== "string") {
                console.error(`Skill at ${skillDir} is missing required 'description' field`);
                return;
            }
            // Validate that frontmatter name matches the skill name (directory name or symlink name)
            // Per the Agent Skills spec: "name field must match the parent directory name"
            const effectiveSkillName = skillName || path.basename(skillDir);
            if (frontmatter.name !== effectiveSkillName) {
                console.error(`Skill name "${frontmatter.name}" doesn't match directory "${effectiveSkillName}"`);
                return;
            }
            // Strict spec validation (https://agentskills.io/specification)
            // Name constraints:
            // - 1-64 chars
            // - lowercase letters/numbers/hyphens only
            // - must not start/end with hyphen
            // - must not contain consecutive hyphens
            if (effectiveSkillName.length < 1 || effectiveSkillName.length > 64) {
                console.error(`Skill name "${effectiveSkillName}" is invalid: name must be 1-64 characters (got ${effectiveSkillName.length})`);
                return;
            }
            const nameFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
            if (!nameFormat.test(effectiveSkillName)) {
                console.error(`Skill name "${effectiveSkillName}" is invalid: must be lowercase letters/numbers/hyphens only (no leading/trailing hyphen, no consecutive hyphens)`);
                return;
            }
            // Description constraints:
            // - 1-1024 chars
            // - non-empty (after trimming)
            const description = frontmatter.description.trim();
            if (description.length < 1 || description.length > 1024) {
                console.error(`Skill "${effectiveSkillName}" has an invalid description length: must be 1-1024 characters (got ${description.length})`);
                return;
            }
            // Create unique key combining name, source, and mode for override resolution
            const skillKey = this.getSkillKey(effectiveSkillName, source, mode);
            this.skills.set(skillKey, {
                name: effectiveSkillName,
                description,
                path: skillMdPath,
                source,
                mode, // undefined for generic skills, string for mode-specific
            });
        }
        catch (error) {
            console.error(`Failed to load skill at ${skillDir}:`, error);
        }
    }
    /**
     * Get skills available for the current mode.
     * Resolves overrides: project > global, mode-specific > generic.
     *
     * @param currentMode - The current mode slug (e.g., 'code', 'architect')
     */
    getSkillsForMode(currentMode) {
        const resolvedSkills = new Map();
        for (const skill of this.skills.values()) {
            // Skip mode-specific skills that don't match current mode
            if (skill.mode && skill.mode !== currentMode)
                continue;
            const existingSkill = resolvedSkills.get(skill.name);
            if (!existingSkill) {
                resolvedSkills.set(skill.name, skill);
                continue;
            }
            // Apply override rules
            const shouldOverride = this.shouldOverrideSkill(existingSkill, skill);
            if (shouldOverride) {
                resolvedSkills.set(skill.name, skill);
            }
        }
        return Array.from(resolvedSkills.values());
    }
    /**
     * Determine if newSkill should override existingSkill based on priority rules.
     * Priority: project > global, mode-specific > generic
     */
    shouldOverrideSkill(existing, newSkill) {
        // Project always overrides global
        if (newSkill.source === "project" && existing.source === "global")
            return true;
        if (newSkill.source === "global" && existing.source === "project")
            return false;
        // Same source: mode-specific overrides generic
        if (newSkill.mode && !existing.mode)
            return true;
        if (!newSkill.mode && existing.mode)
            return false;
        // Same source and same mode-specificity: keep existing (first wins)
        return false;
    }
    /**
     * Get all skills (for UI display, debugging, etc.)
     */
    getAllSkills() {
        return Array.from(this.skills.values());
    }
    async getSkillContent(name, currentMode) {
        // If mode is provided, try to find the best matching skill
        let skill;
        if (currentMode) {
            const modeSkills = this.getSkillsForMode(currentMode);
            skill = modeSkills.find((s) => s.name === name);
        }
        else {
            // Fall back to any skill with this name
            skill = Array.from(this.skills.values()).find((s) => s.name === name);
        }
        if (!skill)
            return null;
        const fileContent = await fs.readFile(skill.path, "utf-8");
        const { content: body } = matter(fileContent);
        return {
            ...skill,
            instructions: body.trim(),
        };
    }
    /**
     * Get all skills directories to scan, including mode-specific directories.
     */
    async getSkillsDirectories() {
        const dirs = [];
        const globalRooDir = getGlobalRooDirectory();
        const provider = this.providerRef.deref();
        const projectRooDir = provider?.cwd ? path.join(provider.cwd, ".roo") : null;
        // Get list of modes to check for mode-specific skills
        const modesList = await this.getAvailableModes();
        // Global directories
        dirs.push({ dir: path.join(globalRooDir, "skills"), source: "global" });
        for (const mode of modesList) {
            dirs.push({ dir: path.join(globalRooDir, `skills-${mode}`), source: "global", mode });
        }
        // Project directories
        if (projectRooDir) {
            dirs.push({ dir: path.join(projectRooDir, "skills"), source: "project" });
            for (const mode of modesList) {
                dirs.push({ dir: path.join(projectRooDir, `skills-${mode}`), source: "project", mode });
            }
        }
        return dirs;
    }
    /**
     * Get list of available modes (built-in + custom)
     */
    async getAvailableModes() {
        const provider = this.providerRef.deref();
        const builtInModeSlugs = modes.map((m) => m.slug);
        if (!provider) {
            return builtInModeSlugs;
        }
        try {
            const customModes = await provider.customModesManager.getCustomModes();
            const allModes = getAllModes(customModes);
            return allModes.map((m) => m.slug);
        }
        catch {
            return builtInModeSlugs;
        }
    }
    getSkillKey(name, source, mode) {
        return `${source}:${mode || "generic"}:${name}`;
    }
    async setupFileWatchers() {
        // Skip if test environment is detected or VSCode APIs are not available
        if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
            return;
        }
        const provider = this.providerRef.deref();
        if (!provider?.cwd)
            return;
        // Watch for changes in skills directories
        const globalSkillsDir = path.join(getGlobalRooDirectory(), "skills");
        const projectSkillsDir = path.join(provider.cwd, ".roo", "skills");
        // Watch global skills directory
        this.watchDirectory(globalSkillsDir);
        // Watch project skills directory
        this.watchDirectory(projectSkillsDir);
        // Watch mode-specific directories for all available modes
        const modesList = await this.getAvailableModes();
        for (const mode of modesList) {
            this.watchDirectory(path.join(getGlobalRooDirectory(), `skills-${mode}`));
            this.watchDirectory(path.join(provider.cwd, ".roo", `skills-${mode}`));
        }
    }
    watchDirectory(dirPath) {
        if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
            return;
        }
        const pattern = new vscode.RelativePattern(dirPath, "**/SKILL.md");
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidChange(async (uri) => {
            if (this.isDisposed)
                return;
            await this.discoverSkills();
        });
        watcher.onDidCreate(async (uri) => {
            if (this.isDisposed)
                return;
            await this.discoverSkills();
        });
        watcher.onDidDelete(async (uri) => {
            if (this.isDisposed)
                return;
            await this.discoverSkills();
        });
        this.disposables.push(watcher);
    }
    async dispose() {
        this.isDisposed = true;
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.skills.clear();
    }
}
//# sourceMappingURL=SkillsManager.js.map