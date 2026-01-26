"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeRipgrep = executeRipgrep;
exports.executeRipgrepForFiles = executeRipgrepForFiles;
exports.searchWorkspaceFiles = searchWorkspaceFiles;
var vscode = require("vscode");
var path = require("path");
var fs = require("fs");
var childProcess = require("child_process");
var readline = require("readline");
var fzf_1 = require("fzf");
var ripgrep_1 = require("../ripgrep");
var package_1 = require("../../shared/package");
function executeRipgrep(_a) {
    return __awaiter(this, arguments, void 0, function (_b) {
        var rgPath;
        var args = _b.args, workspacePath = _b.workspacePath, _c = _b.limit, limit = _c === void 0 ? 500 : _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, (0, ripgrep_1.getBinPath)(vscode.env.appRoot)];
                case 1:
                    rgPath = _d.sent();
                    if (!rgPath) {
                        throw new Error("ripgrep not found: ".concat(rgPath));
                    }
                    return [2 /*return*/, new Promise(function (resolve, reject) {
                            var rgProcess = childProcess.spawn(rgPath, args);
                            var rl = readline.createInterface({ input: rgProcess.stdout, crlfDelay: Infinity });
                            var fileResults = [];
                            var dirSet = new Set(); // Track unique directory paths.
                            var count = 0;
                            rl.on("line", function (line) {
                                if (count < limit) {
                                    try {
                                        var relativePath = path.relative(workspacePath, line);
                                        // Add the file itself.
                                        fileResults.push({ path: relativePath, type: "file", label: path.basename(relativePath) });
                                        // Extract and store all parent directory paths.
                                        var dirPath = path.dirname(relativePath);
                                        while (dirPath && dirPath !== "." && dirPath !== "/") {
                                            dirSet.add(dirPath);
                                            dirPath = path.dirname(dirPath);
                                        }
                                        count++;
                                    }
                                    catch (error) {
                                        // Silently ignore errors processing individual paths.
                                    }
                                }
                                else {
                                    rl.close();
                                    rgProcess.kill();
                                }
                            });
                            var errorOutput = "";
                            rgProcess.stderr.on("data", function (data) {
                                errorOutput += data.toString();
                            });
                            rl.on("close", function () {
                                if (errorOutput && fileResults.length === 0) {
                                    reject(new Error("ripgrep process error: ".concat(errorOutput)));
                                }
                                else {
                                    // Convert directory set to array of directory objects.
                                    var dirResults = Array.from(dirSet).map(function (dirPath) { return ({
                                        path: dirPath,
                                        type: "folder",
                                        label: path.basename(dirPath),
                                    }); });
                                    // Combine files and directories and resolve.
                                    resolve(__spreadArray(__spreadArray([], fileResults, true), dirResults, true));
                                }
                            });
                            rgProcess.on("error", function (error) {
                                reject(new Error("ripgrep process error: ".concat(error.message)));
                            });
                        })];
            }
        });
    });
}
/**
 * Get extra ripgrep arguments based on VSCode search configuration
 */
function getRipgrepSearchOptions() {
    var config = vscode.workspace.getConfiguration("search");
    var extraArgs = [];
    // Respect VSCode's search.useIgnoreFiles setting
    if (config.get("useIgnoreFiles") === false) {
        extraArgs.push("--no-ignore");
    }
    // Respect VSCode's search.useGlobalIgnoreFiles setting
    if (config.get("useGlobalIgnoreFiles") === false) {
        extraArgs.push("--no-ignore-global");
    }
    // Respect VSCode's search.useParentIgnoreFiles setting
    if (config.get("useParentIgnoreFiles") === false) {
        extraArgs.push("--no-ignore-parent");
    }
    return extraArgs;
}
function executeRipgrepForFiles(workspacePath, limit) {
    return __awaiter(this, void 0, void 0, function () {
        var effectiveLimit, args;
        return __generator(this, function (_a) {
            effectiveLimit = limit !== null && limit !== void 0 ? limit : vscode.workspace.getConfiguration(package_1.Package.name).get("maximumIndexedFilesForFileSearch", 10000);
            args = __spreadArray(__spreadArray([
                "--files",
                "--follow",
                "--hidden"
            ], getRipgrepSearchOptions(), true), [
                "-g",
                "!**/node_modules/**",
                "-g",
                "!**/.git/**",
                "-g",
                "!**/out/**",
                "-g",
                "!**/dist/**",
                workspacePath,
            ], false);
            return [2 /*return*/, executeRipgrep({ args: args, workspacePath: workspacePath, limit: effectiveLimit })];
        });
    });
}
function searchWorkspaceFiles(query_1, workspacePath_1) {
    return __awaiter(this, arguments, void 0, function (query, workspacePath, limit) {
        var allItems, searchItems, fzf, fzfResults, verifiedResults, error_1;
        var _this = this;
        if (limit === void 0) { limit = 20; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, executeRipgrepForFiles(workspacePath)
                        // If no query, just return the top items
                    ];
                case 1:
                    allItems = _a.sent();
                    // If no query, just return the top items
                    if (!query.trim()) {
                        return [2 /*return*/, allItems.slice(0, limit)];
                    }
                    searchItems = allItems.map(function (item) { return ({
                        original: item,
                        searchStr: "".concat(item.path, " ").concat(item.label || ""),
                    }); });
                    fzf = new fzf_1.Fzf(searchItems, {
                        selector: function (item) { return item.searchStr; },
                        tiebreakers: [fzf_1.byLengthAsc],
                        limit: limit,
                    });
                    fzfResults = fzf.find(query).map(function (result) { return result.item.original; });
                    return [4 /*yield*/, Promise.all(fzfResults.map(function (result) { return __awaiter(_this, void 0, void 0, function () {
                            var fullPath, isDirectory;
                            return __generator(this, function (_a) {
                                fullPath = path.join(workspacePath, result.path);
                                // Verify if the path exists and is actually a directory
                                if (fs.existsSync(fullPath)) {
                                    isDirectory = fs.lstatSync(fullPath).isDirectory();
                                    return [2 /*return*/, __assign(__assign({}, result), { path: result.path.toPosix(), type: isDirectory ? "folder" : "file" })];
                                }
                                // If path doesn't exist, keep original type
                                return [2 /*return*/, result];
                            });
                        }); }))];
                case 2:
                    verifiedResults = _a.sent();
                    return [2 /*return*/, verifiedResults];
                case 3:
                    error_1 = _a.sent();
                    console.error("Error in searchWorkspaceFiles:", error_1);
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    });
}
