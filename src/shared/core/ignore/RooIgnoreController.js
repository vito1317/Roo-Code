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
exports.RooIgnoreController = exports.LOCK_TEXT_SYMBOL = void 0;
var path_1 = require("path");
var fs_1 = require("../../utils/fs");
var promises_1 = require("fs/promises");
var fs_2 = require("fs");
var ignore_1 = require("ignore");
var vscode = require("vscode");
exports.LOCK_TEXT_SYMBOL = "\uD83D\uDD12";
/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .rooignore files.
 */
var RooIgnoreController = /** @class */ (function () {
    function RooIgnoreController(cwd) {
        this.disposables = [];
        this.cwd = cwd;
        this.ignoreInstance = (0, ignore_1.default)();
        this.rooIgnoreContent = undefined;
        // Set up file watcher for .rooignore
        this.setupFileWatcher();
    }
    /**
     * Initialize the controller by loading custom patterns
     * Must be called after construction and before using the controller
     */
    RooIgnoreController.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.loadRooIgnore()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Set up the file watcher for .rooignore changes
     */
    RooIgnoreController.prototype.setupFileWatcher = function () {
        var _this = this;
        var rooignorePattern = new vscode.RelativePattern(this.cwd, ".rooignore");
        var fileWatcher = vscode.workspace.createFileSystemWatcher(rooignorePattern);
        // Watch for changes and updates
        this.disposables.push(fileWatcher.onDidChange(function () {
            _this.loadRooIgnore();
        }), fileWatcher.onDidCreate(function () {
            _this.loadRooIgnore();
        }), fileWatcher.onDidDelete(function () {
            _this.loadRooIgnore();
        }));
        // Add fileWatcher itself to disposables
        this.disposables.push(fileWatcher);
    };
    /**
     * Load custom patterns from .rooignore if it exists
     */
    RooIgnoreController.prototype.loadRooIgnore = function () {
        return __awaiter(this, void 0, void 0, function () {
            var ignorePath, content, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 5, , 6]);
                        // Reset ignore instance to prevent duplicate patterns
                        this.ignoreInstance = (0, ignore_1.default)();
                        ignorePath = path_1.default.join(this.cwd, ".rooignore");
                        return [4 /*yield*/, (0, fs_1.fileExistsAtPath)(ignorePath)];
                    case 1:
                        if (!_a.sent()) return [3 /*break*/, 3];
                        return [4 /*yield*/, promises_1.default.readFile(ignorePath, "utf8")];
                    case 2:
                        content = _a.sent();
                        this.rooIgnoreContent = content;
                        this.ignoreInstance.add(content);
                        this.ignoreInstance.add(".rooignore");
                        return [3 /*break*/, 4];
                    case 3:
                        this.rooIgnoreContent = undefined;
                        _a.label = 4;
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        error_1 = _a.sent();
                        // Should never happen: reading file failed even though it exists
                        console.error("Unexpected error loading .rooignore:", error_1);
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check if a file should be accessible to the LLM
     * Automatically resolves symlinks
     * @param filePath - Path to check (relative to cwd)
     * @returns true if file is accessible, false if ignored
     */
    RooIgnoreController.prototype.validateAccess = function (filePath) {
        // Always allow access if .rooignore does not exist
        if (!this.rooIgnoreContent) {
            return true;
        }
        try {
            var absolutePath = path_1.default.resolve(this.cwd, filePath);
            // Follow symlinks to get the real path
            var realPath = void 0;
            try {
                realPath = fs_2.default.realpathSync(absolutePath);
            }
            catch (_a) {
                // If realpath fails (file doesn't exist, broken symlink, etc.),
                // use the original path
                realPath = absolutePath;
            }
            // Convert real path to relative for .rooignore checking
            var relativePath = path_1.default.relative(this.cwd, realPath).toPosix();
            // Check if the real path is ignored
            return !this.ignoreInstance.ignores(relativePath);
        }
        catch (error) {
            // Allow access to files outside cwd or on errors (backward compatibility)
            return true;
        }
    };
    /**
     * Check if a terminal command should be allowed to execute based on file access patterns
     * @param command - Terminal command to validate
     * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
     */
    RooIgnoreController.prototype.validateCommand = function (command) {
        // Always allow if no .rooignore exists
        if (!this.rooIgnoreContent) {
            return undefined;
        }
        // Split command into parts and get the base command
        var parts = command.trim().split(/\s+/);
        var baseCommand = parts[0].toLowerCase();
        // Commands that read file contents
        var fileReadingCommands = [
            // Unix commands
            "cat",
            "less",
            "more",
            "head",
            "tail",
            "grep",
            "awk",
            "sed",
            // PowerShell commands and aliases
            "get-content",
            "gc",
            "type",
            "select-string",
            "sls",
        ];
        if (fileReadingCommands.includes(baseCommand)) {
            // Check each argument that could be a file path
            for (var i = 1; i < parts.length; i++) {
                var arg = parts[i];
                // Skip command flags/options (both Unix and PowerShell style)
                if (arg.startsWith("-") || arg.startsWith("/")) {
                    continue;
                }
                // Ignore PowerShell parameter names
                if (arg.includes(":")) {
                    continue;
                }
                // Validate file access
                if (!this.validateAccess(arg)) {
                    return arg;
                }
            }
        }
        return undefined;
    };
    /**
     * Filter an array of paths, removing those that should be ignored
     * @param paths - Array of paths to filter (relative to cwd)
     * @returns Array of allowed paths
     */
    RooIgnoreController.prototype.filterPaths = function (paths) {
        var _this = this;
        try {
            return paths
                .map(function (p) { return ({
                path: p,
                allowed: _this.validateAccess(p),
            }); })
                .filter(function (x) { return x.allowed; })
                .map(function (x) { return x.path; });
        }
        catch (error) {
            console.error("Error filtering paths:", error);
            return []; // Fail closed for security
        }
    };
    /**
     * Clean up resources when the controller is no longer needed
     */
    RooIgnoreController.prototype.dispose = function () {
        this.disposables.forEach(function (d) { return d.dispose(); });
        this.disposables = [];
    };
    /**
     * Get formatted instructions about the .rooignore file for the LLM
     * @returns Formatted instructions or undefined if .rooignore doesn't exist
     */
    RooIgnoreController.prototype.getInstructions = function () {
        if (!this.rooIgnoreContent) {
            return undefined;
        }
        return "# .rooignore\n\n(The following is provided by a root-level .rooignore file where the user has specified files and directories that should not be accessed. When using list_files, you'll notice a ".concat(exports.LOCK_TEXT_SYMBOL, " next to files that are blocked. Attempting to access the file's contents e.g. through read_file will result in an error.)\n\n").concat(this.rooIgnoreContent, "\n.rooignore");
    };
    return RooIgnoreController;
}());
exports.RooIgnoreController = RooIgnoreController;
