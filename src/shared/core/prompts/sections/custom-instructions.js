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
exports.loadRuleFiles = loadRuleFiles;
exports.addCustomInstructions = addCustomInstructions;
var promises_1 = require("fs/promises");
var path_1 = require("path");
var types_1 = require("@roo-code/types");
var language_1 = require("../../../shared/language");
var roo_config_1 = require("../../../services/roo-config");
/**
 * Safely read a file and return its trimmed content
 */
function safeReadFile(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var content, err_1, errorCode;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, promises_1.default.readFile(filePath, "utf-8")];
                case 1:
                    content = _a.sent();
                    return [2 /*return*/, content.trim()];
                case 2:
                    err_1 = _a.sent();
                    errorCode = err_1.code;
                    if (!errorCode || !["ENOENT", "EISDIR"].includes(errorCode)) {
                        throw err_1;
                    }
                    return [2 /*return*/, ""];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Check if a directory exists
 */
function directoryExists(dirPath) {
    return __awaiter(this, void 0, void 0, function () {
        var stats, err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, promises_1.default.stat(dirPath)];
                case 1:
                    stats = _a.sent();
                    return [2 /*return*/, stats.isDirectory()];
                case 2:
                    err_2 = _a.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
var MAX_DEPTH = 5;
/**
 * Recursively resolve directory entries and collect file paths
 */
function resolveDirectoryEntry(entry, dirPath, fileInfo, depth) {
    return __awaiter(this, void 0, void 0, function () {
        var fullPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Avoid cyclic symlinks
                    if (depth > MAX_DEPTH) {
                        return [2 /*return*/];
                    }
                    fullPath = path_1.default.resolve(entry.parentPath || dirPath, entry.name);
                    if (!entry.isFile()) return [3 /*break*/, 1];
                    // Regular file - both original and resolved paths are the same
                    fileInfo.push({ originalPath: fullPath, resolvedPath: fullPath });
                    return [3 /*break*/, 3];
                case 1:
                    if (!entry.isSymbolicLink()) return [3 /*break*/, 3];
                    // Await the resolution of the symbolic link
                    return [4 /*yield*/, resolveSymLink(fullPath, fileInfo, depth + 1)];
                case 2:
                    // Await the resolution of the symbolic link
                    _a.sent();
                    _a.label = 3;
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Recursively resolve a symbolic link and collect file paths
 */
function resolveSymLink(symlinkPath, fileInfo, depth) {
    return __awaiter(this, void 0, void 0, function () {
        var linkTarget, resolvedTarget, stats, anotherEntries, directoryPromises, _i, anotherEntries_1, anotherEntry, err_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Avoid cyclic symlinks
                    if (depth > MAX_DEPTH) {
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 10, , 11]);
                    return [4 /*yield*/, promises_1.default.readlink(symlinkPath)
                        // Resolve the target path (relative to the symlink location)
                    ];
                case 2:
                    linkTarget = _a.sent();
                    resolvedTarget = path_1.default.resolve(path_1.default.dirname(symlinkPath), linkTarget);
                    return [4 /*yield*/, promises_1.default.stat(resolvedTarget)];
                case 3:
                    stats = _a.sent();
                    if (!stats.isFile()) return [3 /*break*/, 4];
                    // For symlinks to files, store the symlink path as original and target as resolved
                    fileInfo.push({
                        originalPath: symlinkPath,
                        resolvedPath: resolvedTarget,
                    });
                    return [3 /*break*/, 9];
                case 4:
                    if (!stats.isDirectory()) return [3 /*break*/, 7];
                    return [4 /*yield*/, promises_1.default.readdir(resolvedTarget, {
                            withFileTypes: true,
                            recursive: true,
                        })
                        // Collect promises for recursive calls within the directory
                    ];
                case 5:
                    anotherEntries = _a.sent();
                    directoryPromises = [];
                    for (_i = 0, anotherEntries_1 = anotherEntries; _i < anotherEntries_1.length; _i++) {
                        anotherEntry = anotherEntries_1[_i];
                        directoryPromises.push(resolveDirectoryEntry(anotherEntry, resolvedTarget, fileInfo, depth + 1));
                    }
                    // Wait for all entries in the resolved directory to be processed
                    return [4 /*yield*/, Promise.all(directoryPromises)];
                case 6:
                    // Wait for all entries in the resolved directory to be processed
                    _a.sent();
                    return [3 /*break*/, 9];
                case 7:
                    if (!stats.isSymbolicLink()) return [3 /*break*/, 9];
                    // Handle nested symlinks by awaiting the recursive call
                    return [4 /*yield*/, resolveSymLink(resolvedTarget, fileInfo, depth + 1)];
                case 8:
                    // Handle nested symlinks by awaiting the recursive call
                    _a.sent();
                    _a.label = 9;
                case 9: return [3 /*break*/, 11];
                case 10:
                    err_3 = _a.sent();
                    return [3 /*break*/, 11];
                case 11: return [2 /*return*/];
            }
        });
    });
}
/**
 * Read all text files from a directory in alphabetical order
 */
function readTextFilesFromDirectory(dirPath) {
    return __awaiter(this, void 0, void 0, function () {
        var entries, fileInfo, initialPromises, _i, entries_1, entry, fileContents, filteredFiles, err_4;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    return [4 /*yield*/, promises_1.default.readdir(dirPath, {
                            withFileTypes: true,
                            recursive: true,
                        })
                        // Process all entries - regular files and symlinks that might point to files
                        // Store both original path (for sorting) and resolved path (for reading)
                    ];
                case 1:
                    entries = _a.sent();
                    fileInfo = [];
                    initialPromises = [];
                    for (_i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                        entry = entries_1[_i];
                        initialPromises.push(resolveDirectoryEntry(entry, dirPath, fileInfo, 0));
                    }
                    // Wait for all asynchronous operations (including recursive ones) to complete
                    return [4 /*yield*/, Promise.all(initialPromises)];
                case 2:
                    // Wait for all asynchronous operations (including recursive ones) to complete
                    _a.sent();
                    return [4 /*yield*/, Promise.all(fileInfo.map(function (_a) { return __awaiter(_this, [_a], void 0, function (_b) {
                            var stats, content, err_5;
                            var originalPath = _b.originalPath, resolvedPath = _b.resolvedPath;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        _c.trys.push([0, 4, , 5]);
                                        return [4 /*yield*/, promises_1.default.stat(resolvedPath)];
                                    case 1:
                                        stats = _c.sent();
                                        if (!stats.isFile()) return [3 /*break*/, 3];
                                        // Filter out cache files and system files that shouldn't be in rules
                                        if (!shouldIncludeRuleFile(resolvedPath)) {
                                            return [2 /*return*/, null];
                                        }
                                        return [4 /*yield*/, safeReadFile(resolvedPath)
                                            // Use resolvedPath for display to maintain existing behavior
                                        ];
                                    case 2:
                                        content = _c.sent();
                                        // Use resolvedPath for display to maintain existing behavior
                                        return [2 /*return*/, { filename: resolvedPath, content: content, sortKey: originalPath }];
                                    case 3: return [2 /*return*/, null];
                                    case 4:
                                        err_5 = _c.sent();
                                        return [2 /*return*/, null];
                                    case 5: return [2 /*return*/];
                                }
                            });
                        }); }))
                        // Filter out null values (directories, failed reads, or excluded files)
                    ];
                case 3:
                    fileContents = _a.sent();
                    filteredFiles = fileContents.filter(function (item) { return item !== null; });
                    // Sort files alphabetically by the original filename (case-insensitive) to ensure consistent order
                    // For symlinks, this will use the symlink name, not the target name
                    return [2 /*return*/, filteredFiles
                            .sort(function (a, b) {
                            var filenameA = path_1.default.basename(a.sortKey).toLowerCase();
                            var filenameB = path_1.default.basename(b.sortKey).toLowerCase();
                            return filenameA.localeCompare(filenameB);
                        })
                            .map(function (_a) {
                            var filename = _a.filename, content = _a.content;
                            return ({ filename: filename, content: content });
                        })];
                case 4:
                    err_4 = _a.sent();
                    return [2 /*return*/, []];
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Format content from multiple files with filenames as headers
 * @param files - Array of files with filename (absolute path) and content
 * @param cwd - Current working directory for computing relative paths
 */
function formatDirectoryContent(files, cwd) {
    if (files.length === 0)
        return "";
    return files
        .map(function (file) {
        // Compute relative path for display
        var displayPath = path_1.default.relative(cwd, file.filename);
        return "# Rules from ".concat(displayPath, ":\n").concat(file.content);
    })
        .join("\n\n");
}
/**
 * Load rule files from global, project-local, and optionally subfolder directories
 * Rules are loaded in order: global first, then project-local, then subfolders (alphabetically)
 *
 * @param cwd - Current working directory (project root)
 * @param enableSubfolderRules - Whether to include rules from subdirectories (default: false)
 */
function loadRuleFiles(cwd_1) {
    return __awaiter(this, arguments, void 0, function (cwd, enableSubfolderRules) {
        var rules, rooDirectories, _a, _i, rooDirectories_1, rooDir, rulesDir, files, content, ruleFiles, _b, ruleFiles_1, file, content;
        if (enableSubfolderRules === void 0) { enableSubfolderRules = false; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    rules = [];
                    if (!enableSubfolderRules) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, roo_config_1.getAllRooDirectoriesForCwd)(cwd)];
                case 1:
                    _a = _c.sent();
                    return [3 /*break*/, 3];
                case 2:
                    _a = (0, roo_config_1.getRooDirectoriesForCwd)(cwd);
                    _c.label = 3;
                case 3:
                    rooDirectories = _a;
                    _i = 0, rooDirectories_1 = rooDirectories;
                    _c.label = 4;
                case 4:
                    if (!(_i < rooDirectories_1.length)) return [3 /*break*/, 8];
                    rooDir = rooDirectories_1[_i];
                    rulesDir = path_1.default.join(rooDir, "rules");
                    return [4 /*yield*/, directoryExists(rulesDir)];
                case 5:
                    if (!_c.sent()) return [3 /*break*/, 7];
                    return [4 /*yield*/, readTextFilesFromDirectory(rulesDir)];
                case 6:
                    files = _c.sent();
                    if (files.length > 0) {
                        content = formatDirectoryContent(files, cwd);
                        rules.push(content);
                    }
                    _c.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 4];
                case 8:
                    // If we found rules in .roo/rules/ directories, return them
                    if (rules.length > 0) {
                        return [2 /*return*/, "\n# Rules from .roo directories:\n\n" + rules.join("\n\n")];
                    }
                    ruleFiles = [".roorules", ".clinerules"];
                    _b = 0, ruleFiles_1 = ruleFiles;
                    _c.label = 9;
                case 9:
                    if (!(_b < ruleFiles_1.length)) return [3 /*break*/, 12];
                    file = ruleFiles_1[_b];
                    return [4 /*yield*/, safeReadFile(path_1.default.join(cwd, file))];
                case 10:
                    content = _c.sent();
                    if (content) {
                        return [2 /*return*/, "\n# Rules from ".concat(file, ":\n").concat(content, "\n")];
                    }
                    _c.label = 11;
                case 11:
                    _b++;
                    return [3 /*break*/, 9];
                case 12: return [2 /*return*/, ""];
            }
        });
    });
}
/**
 * Load AGENTS.md or AGENT.md file from a specific directory
 * Checks for both AGENTS.md (standard) and AGENT.md (alternative) for compatibility
 *
 * @param directory - Directory to check for AGENTS.md
 * @param showPath - Whether to include the directory path in the header
 * @param cwd - Current working directory for computing relative paths (optional)
 */
function loadAgentRulesFileFromDirectory(directory_1) {
    return __awaiter(this, arguments, void 0, function (directory, showPath, cwd) {
        var filenames, _i, filenames_1, filename, agentPath, resolvedPath, stats, fileInfo, err_6, content, displayPath, header, err_7;
        if (showPath === void 0) { showPath = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    filenames = ["AGENTS.md", "AGENT.md"];
                    _i = 0, filenames_1 = filenames;
                    _a.label = 1;
                case 1:
                    if (!(_i < filenames_1.length)) return [3 /*break*/, 12];
                    filename = filenames_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 10, , 11]);
                    agentPath = path_1.default.join(directory, filename);
                    resolvedPath = agentPath;
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 7, , 8]);
                    return [4 /*yield*/, promises_1.default.lstat(agentPath)];
                case 4:
                    stats = _a.sent();
                    if (!stats.isSymbolicLink()) return [3 /*break*/, 6];
                    fileInfo = [];
                    // Use the existing resolveSymLink function to handle symlink resolution
                    return [4 /*yield*/, resolveSymLink(agentPath, fileInfo, 0)
                        // Extract the resolved path from fileInfo
                    ];
                case 5:
                    // Use the existing resolveSymLink function to handle symlink resolution
                    _a.sent();
                    // Extract the resolved path from fileInfo
                    if (fileInfo.length > 0) {
                        resolvedPath = fileInfo[0].resolvedPath;
                    }
                    _a.label = 6;
                case 6: return [3 /*break*/, 8];
                case 7:
                    err_6 = _a.sent();
                    // If lstat fails (file doesn't exist), try next filename
                    return [3 /*break*/, 11];
                case 8: return [4 /*yield*/, safeReadFile(resolvedPath)];
                case 9:
                    content = _a.sent();
                    if (content) {
                        displayPath = cwd ? path_1.default.relative(cwd, directory) : directory;
                        header = showPath
                            ? "# Agent Rules Standard (".concat(filename, ") from ").concat(displayPath, ":")
                            : "# Agent Rules Standard (".concat(filename, "):");
                        return [2 /*return*/, "".concat(header, "\n").concat(content)];
                    }
                    return [3 /*break*/, 11];
                case 10:
                    err_7 = _a.sent();
                    return [3 /*break*/, 11];
                case 11:
                    _i++;
                    return [3 /*break*/, 1];
                case 12: return [2 /*return*/, ""];
            }
        });
    });
}
/**
 * Load AGENTS.md or AGENT.md file from the project root if it exists
 * Checks for both AGENTS.md (standard) and AGENT.md (alternative) for compatibility
 *
 * @deprecated Use loadAllAgentRulesFiles for loading from all directories
 */
function loadAgentRulesFile(cwd) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, loadAgentRulesFileFromDirectory(cwd, false, cwd)];
        });
    });
}
/**
 * Load all AGENTS.md files from project root and optionally subdirectories with .roo folders
 * Returns combined content with clear path headers for each file
 *
 * @param cwd - Current working directory (project root)
 * @param enableSubfolderRules - Whether to include AGENTS.md from subdirectories (default: false)
 * @returns Combined AGENTS.md content from all locations
 */
function loadAllAgentRulesFiles(cwd_1) {
    return __awaiter(this, arguments, void 0, function (cwd, enableSubfolderRules) {
        var agentRules, content, directories, _i, directories_1, directory, showPath, content;
        if (enableSubfolderRules === void 0) { enableSubfolderRules = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    agentRules = [];
                    if (!!enableSubfolderRules) return [3 /*break*/, 2];
                    return [4 /*yield*/, loadAgentRulesFileFromDirectory(cwd, false, cwd)];
                case 1:
                    content = _a.sent();
                    if (content && content.trim()) {
                        agentRules.push(content.trim());
                    }
                    return [2 /*return*/, agentRules.join("\n\n")];
                case 2: return [4 /*yield*/, (0, roo_config_1.getAgentsDirectoriesForCwd)(cwd)];
                case 3:
                    directories = _a.sent();
                    _i = 0, directories_1 = directories;
                    _a.label = 4;
                case 4:
                    if (!(_i < directories_1.length)) return [3 /*break*/, 7];
                    directory = directories_1[_i];
                    showPath = directory !== cwd;
                    return [4 /*yield*/, loadAgentRulesFileFromDirectory(directory, showPath, cwd)];
                case 5:
                    content = _a.sent();
                    if (content && content.trim()) {
                        agentRules.push(content.trim());
                    }
                    _a.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 4];
                case 7: return [2 /*return*/, agentRules.join("\n\n")];
            }
        });
    });
}
function addCustomInstructions(modeCustomInstructions_1, globalCustomInstructions_1, cwd_1, mode_1) {
    return __awaiter(this, arguments, void 0, function (modeCustomInstructions, globalCustomInstructions, cwd, mode, options) {
        var sections, enableSubfolderRules, modeRuleContent, usedRuleFile, modeRules, rooDirectories, _a, _i, rooDirectories_2, rooDir, modeRulesDir, files, content, rooModeRuleFile, clineModeRuleFile, languageName, rules, agentRulesContent, genericRuleContent, joinedSections;
        var _b, _c, _d;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    sections = [];
                    enableSubfolderRules = (_c = (_b = options.settings) === null || _b === void 0 ? void 0 : _b.enableSubfolderRules) !== null && _c !== void 0 ? _c : false;
                    modeRuleContent = "";
                    usedRuleFile = "";
                    if (!mode) return [3 /*break*/, 13];
                    modeRules = [];
                    if (!enableSubfolderRules) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, roo_config_1.getAllRooDirectoriesForCwd)(cwd)];
                case 1:
                    _a = _e.sent();
                    return [3 /*break*/, 3];
                case 2:
                    _a = (0, roo_config_1.getRooDirectoriesForCwd)(cwd);
                    _e.label = 3;
                case 3:
                    rooDirectories = _a;
                    _i = 0, rooDirectories_2 = rooDirectories;
                    _e.label = 4;
                case 4:
                    if (!(_i < rooDirectories_2.length)) return [3 /*break*/, 8];
                    rooDir = rooDirectories_2[_i];
                    modeRulesDir = path_1.default.join(rooDir, "rules-".concat(mode));
                    return [4 /*yield*/, directoryExists(modeRulesDir)];
                case 5:
                    if (!_e.sent()) return [3 /*break*/, 7];
                    return [4 /*yield*/, readTextFilesFromDirectory(modeRulesDir)];
                case 6:
                    files = _e.sent();
                    if (files.length > 0) {
                        content = formatDirectoryContent(files, cwd);
                        modeRules.push(content);
                    }
                    _e.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 4];
                case 8:
                    if (!(modeRules.length > 0)) return [3 /*break*/, 9];
                    modeRuleContent = "\n" + modeRules.join("\n\n");
                    usedRuleFile = "rules-".concat(mode, " directories");
                    return [3 /*break*/, 13];
                case 9:
                    rooModeRuleFile = ".roorules-".concat(mode);
                    return [4 /*yield*/, safeReadFile(path_1.default.join(cwd, rooModeRuleFile))];
                case 10:
                    modeRuleContent = _e.sent();
                    if (!modeRuleContent) return [3 /*break*/, 11];
                    usedRuleFile = rooModeRuleFile;
                    return [3 /*break*/, 13];
                case 11:
                    clineModeRuleFile = ".clinerules-".concat(mode);
                    return [4 /*yield*/, safeReadFile(path_1.default.join(cwd, clineModeRuleFile))];
                case 12:
                    modeRuleContent = _e.sent();
                    if (modeRuleContent) {
                        usedRuleFile = clineModeRuleFile;
                    }
                    _e.label = 13;
                case 13:
                    // Add language preference if provided
                    if (options.language) {
                        languageName = (0, types_1.isLanguage)(options.language) ? language_1.LANGUAGES[options.language] : options.language;
                        sections.push("Language Preference:\nYou should always speak and think in the \"".concat(languageName, "\" (").concat(options.language, ") language unless the user gives you instructions below to do otherwise."));
                    }
                    // Add global instructions first
                    if (typeof globalCustomInstructions === "string" && globalCustomInstructions.trim()) {
                        sections.push("Global Instructions:\n".concat(globalCustomInstructions.trim()));
                    }
                    // Add mode-specific instructions after
                    if (typeof modeCustomInstructions === "string" && modeCustomInstructions.trim()) {
                        sections.push("Mode-specific Instructions:\n".concat(modeCustomInstructions.trim()));
                    }
                    rules = [];
                    // Add mode-specific rules first if they exist
                    if (modeRuleContent && modeRuleContent.trim()) {
                        if (usedRuleFile.includes(path_1.default.join(".roo", "rules-".concat(mode)))) {
                            rules.push(modeRuleContent.trim());
                        }
                        else {
                            rules.push("# Rules from ".concat(usedRuleFile, ":\n").concat(modeRuleContent));
                        }
                    }
                    if (options.rooIgnoreInstructions) {
                        rules.push(options.rooIgnoreInstructions);
                    }
                    if (!(((_d = options.settings) === null || _d === void 0 ? void 0 : _d.useAgentRules) !== false)) return [3 /*break*/, 15];
                    return [4 /*yield*/, loadAllAgentRulesFiles(cwd, enableSubfolderRules)];
                case 14:
                    agentRulesContent = _e.sent();
                    if (agentRulesContent && agentRulesContent.trim()) {
                        rules.push(agentRulesContent.trim());
                    }
                    _e.label = 15;
                case 15: return [4 /*yield*/, loadRuleFiles(cwd, enableSubfolderRules)];
                case 16:
                    genericRuleContent = _e.sent();
                    if (genericRuleContent && genericRuleContent.trim()) {
                        rules.push(genericRuleContent.trim());
                    }
                    if (rules.length > 0) {
                        sections.push("Rules:\n\n".concat(rules.join("\n\n")));
                    }
                    joinedSections = sections.join("\n\n");
                    return [2 /*return*/, joinedSections
                            ? "\n====\n\nUSER'S CUSTOM INSTRUCTIONS\n\nThe following additional instructions are provided by the user, and should be followed to the best of your ability.\n\n".concat(joinedSections, "\n")
                            : ""];
            }
        });
    });
}
/**
 * Check if a file should be included in rule compilation.
 * Excludes cache files and system files that shouldn't be processed as rules.
 */
function shouldIncludeRuleFile(filename) {
    var basename = path_1.default.basename(filename);
    var cachePatterns = [
        "*.DS_Store",
        "*.bak",
        "*.cache",
        "*.crdownload",
        "*.db",
        "*.dmp",
        "*.dump",
        "*.eslintcache",
        "*.lock",
        "*.log",
        "*.old",
        "*.part",
        "*.partial",
        "*.pyc",
        "*.pyo",
        "*.stackdump",
        "*.swo",
        "*.swp",
        "*.temp",
        "*.tmp",
        "Thumbs.db",
    ];
    return !cachePatterns.some(function (pattern) {
        if (pattern.startsWith("*.")) {
            var extension = pattern.slice(1);
            return basename.endsWith(extension);
        }
        else {
            return basename === pattern;
        }
    });
}
