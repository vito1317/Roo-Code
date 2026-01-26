"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRooConfiguration = void 0;
exports.getGlobalRooDirectory = getGlobalRooDirectory;
exports.getProjectRooDirectoryForCwd = getProjectRooDirectoryForCwd;
exports.directoryExists = directoryExists;
exports.fileExists = fileExists;
exports.readFileIfExists = readFileIfExists;
exports.discoverSubfolderRooDirectories = discoverSubfolderRooDirectories;
exports.getRooDirectoriesForCwd = getRooDirectoriesForCwd;
exports.getAllRooDirectoriesForCwd = getAllRooDirectoriesForCwd;
exports.getAgentsDirectoriesForCwd = getAgentsDirectoriesForCwd;
exports.loadConfiguration = loadConfiguration;
var path = require("path");
var os = require("os");
var promises_1 = require("fs/promises");
/**
 * Gets the global .roo directory path based on the current platform
 *
 * @returns The absolute path to the global .roo directory
 *
 * @example Platform-specific paths:
 * ```
 * // macOS/Linux: ~/.roo/
 * // Example: /Users/john/.roo
 *
 * // Windows: %USERPROFILE%\.roo\
 * // Example: C:\Users\john\.roo
 * ```
 *
 * @example Usage:
 * ```typescript
 * const globalDir = getGlobalRooDirectory()
 * // Returns: "/Users/john/.roo" (on macOS/Linux)
 * // Returns: "C:\\Users\\john\\.roo" (on Windows)
 * ```
 */
function getGlobalRooDirectory() {
    var homeDir = os.homedir();
    return path.join(homeDir, ".roo");
}
/**
 * Gets the project-local .roo directory path for a given cwd
 *
 * @param cwd - Current working directory (project path)
 * @returns The absolute path to the project-local .roo directory
 *
 * @example
 * ```typescript
 * const projectDir = getProjectRooDirectoryForCwd('/Users/john/my-project')
 * // Returns: "/Users/john/my-project/.roo"
 *
 * const windowsProjectDir = getProjectRooDirectoryForCwd('C:\\Users\\john\\my-project')
 * // Returns: "C:\\Users\\john\\my-project\\.roo"
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/my-project/
 * ├── .roo/                    # Project-local configuration directory
 * │   ├── rules/
 * │   │   └── rules.md
 * │   ├── custom-instructions.md
 * │   └── config/
 * │       └── settings.json
 * ├── src/
 * │   └── index.ts
 * └── package.json
 * ```
 */
function getProjectRooDirectoryForCwd(cwd) {
    return path.join(cwd, ".roo");
}
/**
 * Checks if a directory exists
 */
function directoryExists(dirPath) {
    return __awaiter(this, void 0, void 0, function () {
        var stat, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, promises_1.default.stat(dirPath)];
                case 1:
                    stat = _a.sent();
                    return [2 /*return*/, stat.isDirectory()];
                case 2:
                    error_1 = _a.sent();
                    // Only catch expected "not found" errors
                    if (error_1.code === "ENOENT" || error_1.code === "ENOTDIR") {
                        return [2 /*return*/, false];
                    }
                    // Re-throw unexpected errors (permission, I/O, etc.)
                    throw error_1;
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Checks if a file exists
 */
function fileExists(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var stat, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, promises_1.default.stat(filePath)];
                case 1:
                    stat = _a.sent();
                    return [2 /*return*/, stat.isFile()];
                case 2:
                    error_2 = _a.sent();
                    // Only catch expected "not found" errors
                    if (error_2.code === "ENOENT" || error_2.code === "ENOTDIR") {
                        return [2 /*return*/, false];
                    }
                    // Re-throw unexpected errors (permission, I/O, etc.)
                    throw error_2;
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Reads a file safely, returning null if it doesn't exist
 */
function readFileIfExists(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, promises_1.default.readFile(filePath, "utf-8")];
                case 1: return [2 /*return*/, _a.sent()];
                case 2:
                    error_3 = _a.sent();
                    // Only catch expected "not found" errors
                    if (error_3.code === "ENOENT" || error_3.code === "ENOTDIR" || error_3.code === "EISDIR") {
                        return [2 /*return*/, null];
                    }
                    // Re-throw unexpected errors (permission, I/O, etc.)
                    throw error_3;
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Discovers all .roo directories in subdirectories of the workspace
 *
 * @param cwd - Current working directory (workspace root)
 * @returns Array of absolute paths to .roo directories found in subdirectories,
 *          sorted alphabetically. Does not include the root .roo directory.
 *
 * @example
 * ```typescript
 * const subfolderRoos = await discoverSubfolderRooDirectories('/Users/john/monorepo')
 * // Returns:
 * // [
 * //   '/Users/john/monorepo/package-a/.roo',
 * //   '/Users/john/monorepo/package-b/.roo',
 * //   '/Users/john/monorepo/packages/shared/.roo'
 * // ]
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/monorepo/
 * ├── .roo/                    # Root .roo (NOT included - use getProjectRooDirectoryForCwd)
 * ├── package-a/
 * │   └── .roo/                # Included
 * │       └── rules/
 * ├── package-b/
 * │   └── .roo/                # Included
 * │       └── rules-code/
 * └── packages/
 *     └── shared/
 *         └── .roo/            # Included (nested)
 *             └── rules/
 * ```
 */
function discoverSubfolderRooDirectories(cwd) {
    return __awaiter(this, void 0, void 0, function () {
        var executeRipgrep, args, results, rooDirs, rootRooDir, _i, results_1, result, match, rooDir, error_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("../search/file-search"); })];
                case 1:
                    executeRipgrep = (_a.sent()).executeRipgrep;
                    args = [
                        "--files",
                        "--hidden",
                        "--follow",
                        "-g",
                        "**/.roo/**",
                        "-g",
                        "!node_modules/**",
                        "-g",
                        "!.git/**",
                        cwd,
                    ];
                    return [4 /*yield*/, executeRipgrep({ args: args, workspacePath: cwd })
                        // Extract unique .roo directory paths
                    ];
                case 2:
                    results = _a.sent();
                    rooDirs = new Set();
                    rootRooDir = path.join(cwd, ".roo");
                    for (_i = 0, results_1 = results; _i < results_1.length; _i++) {
                        result = results_1[_i];
                        match = result.path.match(/^(.+?)[/\\]\.roo[/\\]/);
                        if (match) {
                            rooDir = path.join(cwd, match[1], ".roo");
                            // Exclude the root .roo directory (already handled by getProjectRooDirectoryForCwd)
                            if (rooDir !== rootRooDir) {
                                rooDirs.add(rooDir);
                            }
                        }
                    }
                    // Return sorted alphabetically
                    return [2 /*return*/, Array.from(rooDirs).sort()];
                case 3:
                    error_4 = _a.sent();
                    // If discovery fails (e.g., ripgrep not available), return empty array
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Gets the ordered list of .roo directories to check (global first, then project-local)
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of directory paths to check in order [global, project-local]
 *
 * @example
 * ```typescript
 * // For a project at /Users/john/my-project
 * const directories = getRooDirectoriesForCwd('/Users/john/my-project')
 * // Returns:
 * // [
 * //   '/Users/john/.roo',           // Global directory
 * //   '/Users/john/my-project/.roo' // Project-local directory
 * // ]
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/
 * ├── .roo/                    # Global configuration
 * │   ├── rules/
 * │   │   └── rules.md
 * │   └── custom-instructions.md
 * └── my-project/
 *     ├── .roo/                # Project-specific configuration
 *     │   ├── rules/
 *     │   │   └── rules.md     # Overrides global rules
 *     │   └── project-notes.md
 *     └── src/
 *         └── index.ts
 * ```
 */
function getRooDirectoriesForCwd(cwd) {
    var directories = [];
    // Add global directory first
    directories.push(getGlobalRooDirectory());
    // Add project-local directory second
    directories.push(getProjectRooDirectoryForCwd(cwd));
    return directories;
}
/**
 * Gets the ordered list of all .roo directories including subdirectories
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of directory paths in order: [global, project-local, ...subfolders (alphabetically)]
 *
 * @example
 * ```typescript
 * // For a monorepo at /Users/john/monorepo with .roo in subfolders
 * const directories = await getAllRooDirectoriesForCwd('/Users/john/monorepo')
 * // Returns:
 * // [
 * //   '/Users/john/.roo',                    // Global directory
 * //   '/Users/john/monorepo/.roo',           // Project-local directory
 * //   '/Users/john/monorepo/package-a/.roo', // Subfolder (alphabetical)
 * //   '/Users/john/monorepo/package-b/.roo'  // Subfolder (alphabetical)
 * // ]
 * ```
 */
function getAllRooDirectoriesForCwd(cwd) {
    return __awaiter(this, void 0, void 0, function () {
        var directories, subfolderDirs;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    directories = [];
                    // Add global directory first
                    directories.push(getGlobalRooDirectory());
                    // Add project-local directory second
                    directories.push(getProjectRooDirectoryForCwd(cwd));
                    return [4 /*yield*/, discoverSubfolderRooDirectories(cwd)];
                case 1:
                    subfolderDirs = _a.sent();
                    directories.push.apply(directories, subfolderDirs);
                    return [2 /*return*/, directories];
            }
        });
    });
}
/**
 * Gets parent directories containing .roo folders, in order from root to subfolders
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of parent directory paths (not .roo paths) containing AGENTS.md or .roo
 *
 * @example
 * ```typescript
 * const dirs = await getAgentsDirectoriesForCwd('/Users/john/monorepo')
 * // Returns: ['/Users/john/monorepo', '/Users/john/monorepo/package-a', ...]
 * ```
 */
function getAgentsDirectoriesForCwd(cwd) {
    return __awaiter(this, void 0, void 0, function () {
        var directories, subfolderRooDirs, _i, subfolderRooDirs_1, rooDir, parentDir;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    directories = [];
                    // Always include the root directory
                    directories.push(cwd);
                    return [4 /*yield*/, discoverSubfolderRooDirectories(cwd)
                        // Extract parent directories (remove .roo from path)
                    ];
                case 1:
                    subfolderRooDirs = _a.sent();
                    // Extract parent directories (remove .roo from path)
                    for (_i = 0, subfolderRooDirs_1 = subfolderRooDirs; _i < subfolderRooDirs_1.length; _i++) {
                        rooDir = subfolderRooDirs_1[_i];
                        parentDir = path.dirname(rooDir);
                        directories.push(parentDir);
                    }
                    return [2 /*return*/, directories];
            }
        });
    });
}
/**
 * Loads configuration from multiple .roo directories with project overriding global
 *
 * @param relativePath - The relative path within each .roo directory (e.g., 'rules/rules.md')
 * @param cwd - Current working directory (project path)
 * @returns Object with global and project content, plus merged content
 *
 * @example
 * ```typescript
 * // Load rules configuration for a project
 * const config = await loadConfiguration('rules/rules.md', '/Users/john/my-project')
 *
 * // Returns:
 * // {
 * //   global: "Global rules content...",     // From ~/.roo/rules/rules.md
 * //   project: "Project rules content...",   // From /Users/john/my-project/.roo/rules/rules.md
 * //   merged: "Global rules content...\n\n# Project-specific rules (override global):\n\nProject rules content..."
 * // }
 * ```
 *
 * @example File paths resolved:
 * ```
 * relativePath: 'rules/rules.md'
 * cwd: '/Users/john/my-project'
 *
 * Reads from:
 * - Global: /Users/john/.roo/rules/rules.md
 * - Project: /Users/john/my-project/.roo/rules/rules.md
 *
 * Other common relativePath examples:
 * - 'custom-instructions.md'
 * - 'config/settings.json'
 * - 'templates/component.tsx'
 * ```
 *
 * @example Merging behavior:
 * ```
 * // If only global exists:
 * { global: "content", project: null, merged: "content" }
 *
 * // If only project exists:
 * { global: null, project: "content", merged: "content" }
 *
 * // If both exist:
 * {
 *   global: "global content",
 *   project: "project content",
 *   merged: "global content\n\n# Project-specific rules (override global):\n\nproject content"
 * }
 * ```
 */
function loadConfiguration(relativePath, cwd) {
    return __awaiter(this, void 0, void 0, function () {
        var globalDir, projectDir, globalFilePath, projectFilePath, globalContent, projectContent, merged;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    globalDir = getGlobalRooDirectory();
                    projectDir = getProjectRooDirectoryForCwd(cwd);
                    globalFilePath = path.join(globalDir, relativePath);
                    projectFilePath = path.join(projectDir, relativePath);
                    return [4 /*yield*/, readFileIfExists(globalFilePath)
                        // Read project-local configuration
                    ];
                case 1:
                    globalContent = _a.sent();
                    return [4 /*yield*/, readFileIfExists(projectFilePath)
                        // Merge configurations - project overrides global
                    ];
                case 2:
                    projectContent = _a.sent();
                    merged = "";
                    if (globalContent) {
                        merged += globalContent;
                    }
                    if (projectContent) {
                        if (merged) {
                            merged += "\n\n# Project-specific rules (override global):\n\n";
                        }
                        merged += projectContent;
                    }
                    return [2 /*return*/, {
                            global: globalContent,
                            project: projectContent,
                            merged: merged || "",
                        }];
            }
        });
    });
}
// Export with backward compatibility alias
exports.loadRooConfiguration = loadConfiguration;
