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
Object.defineProperty(exports, "__esModule", { value: true });
exports.truncateLine = truncateLine;
exports.getBinPath = getBinPath;
exports.regexSearchFiles = regexSearchFiles;
var childProcess = require("child_process");
var path = require("path");
var readline = require("readline");
var vscode = require("vscode");
var fs_1 = require("../../utils/fs");
/*
This file provides functionality to perform regex searches on files using ripgrep.
Inspired by: https://github.com/DiscreteTom/vscode-ripgrep-utils

Key components:
1. getBinPath: Locates the ripgrep binary within the VSCode installation.
2. execRipgrep: Executes the ripgrep command and returns the output.
3. regexSearchFiles: The main function that performs regex searches on files.
   - Parameters:
     * cwd: The current working directory (for relative path calculation)
     * directoryPath: The directory to search in
     * regex: The regular expression to search for (Rust regex syntax)
     * filePattern: Optional glob pattern to filter files (default: '*')
   - Returns: A formatted string containing search results with context

The search results include:
- Relative file paths
- 2 lines of context before and after each match
- Matches formatted with pipe characters for easy reading

Usage example:
const results = await regexSearchFiles('/path/to/cwd', '/path/to/search', 'TODO:', '*.ts');

rel/path/to/app.ts
│----
│function processData(data: any) {
│  // Some processing logic here
│  // TODO: Implement error handling
│  return processedData;
│}
│----

rel/path/to/helper.ts
│----
│  let result = 0;
│  for (let i = 0; i < input; i++) {
│    // TODO: Optimize this function for performance
│    result += Math.pow(i, 2);
│  }
│----
*/
var isWindows = process.platform.startsWith("win");
var binName = isWindows ? "rg.exe" : "rg";
// Constants
var MAX_RESULTS = 300;
var MAX_LINE_LENGTH = 500;
/**
 * Truncates a line if it exceeds the maximum length
 * @param line The line to truncate
 * @param maxLength The maximum allowed length (defaults to MAX_LINE_LENGTH)
 * @returns The truncated line, or the original line if it's shorter than maxLength
 */
function truncateLine(line, maxLength) {
    if (maxLength === void 0) { maxLength = MAX_LINE_LENGTH; }
    return line.length > maxLength ? line.substring(0, maxLength) + " [truncated...]" : line;
}
/**
 * Get the path to the ripgrep binary within the VSCode installation
 */
function getBinPath(vscodeAppRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var checkPath, _a, _b, _c;
        var _this = this;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    checkPath = function (pkgFolder) { return __awaiter(_this, void 0, void 0, function () {
                        var fullPath;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    fullPath = path.join(vscodeAppRoot, pkgFolder, binName);
                                    return [4 /*yield*/, (0, fs_1.fileExistsAtPath)(fullPath)];
                                case 1: return [2 /*return*/, (_a.sent()) ? fullPath : undefined];
                            }
                        });
                    }); };
                    return [4 /*yield*/, checkPath("node_modules/@vscode/ripgrep/bin/")];
                case 1:
                    _c = (_d.sent());
                    if (_c) return [3 /*break*/, 3];
                    return [4 /*yield*/, checkPath("node_modules/vscode-ripgrep/bin")];
                case 2:
                    _c = (_d.sent());
                    _d.label = 3;
                case 3:
                    _b = _c;
                    if (_b) return [3 /*break*/, 5];
                    return [4 /*yield*/, checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")];
                case 4:
                    _b = (_d.sent());
                    _d.label = 5;
                case 5:
                    _a = _b;
                    if (_a) return [3 /*break*/, 7];
                    return [4 /*yield*/, checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/")];
                case 6:
                    _a = (_d.sent());
                    _d.label = 7;
                case 7: return [2 /*return*/, (_a)];
            }
        });
    });
}
function execRipgrep(bin, args) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var rgProcess = childProcess.spawn(bin, args);
                    // cross-platform alternative to head, which is ripgrep author's recommendation for limiting output.
                    var rl = readline.createInterface({
                        input: rgProcess.stdout,
                        crlfDelay: Infinity, // treat \r\n as a single line break even if it's split across chunks. This ensures consistent behavior across different operating systems.
                    });
                    var output = "";
                    var lineCount = 0;
                    var maxLines = MAX_RESULTS * 5; // limiting ripgrep output with max lines since there's no other way to limit results. it's okay that we're outputting as json, since we're parsing it line by line and ignore anything that's not part of a match. This assumes each result is at most 5 lines.
                    rl.on("line", function (line) {
                        if (lineCount < maxLines) {
                            output += line + "\n";
                            lineCount++;
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
                        if (errorOutput) {
                            reject(new Error("ripgrep process error: ".concat(errorOutput)));
                        }
                        else {
                            resolve(output);
                        }
                    });
                    rgProcess.on("error", function (error) {
                        reject(new Error("ripgrep process error: ".concat(error.message)));
                    });
                })];
        });
    });
}
function regexSearchFiles(cwd, directoryPath, regex, filePattern, rooIgnoreController) {
    return __awaiter(this, void 0, void 0, function () {
        var vscodeAppRoot, rgPath, args, output, error_1, results, currentFile, filteredResults;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    vscodeAppRoot = vscode.env.appRoot;
                    return [4 /*yield*/, getBinPath(vscodeAppRoot)];
                case 1:
                    rgPath = _a.sent();
                    if (!rgPath) {
                        throw new Error("Could not find ripgrep binary");
                    }
                    args = ["--json", "-e", regex];
                    // Only add --glob if a specific file pattern is provided
                    // Using --glob "*" overrides .gitignore behavior, so we omit it when no pattern is specified
                    if (filePattern) {
                        args.push("--glob", filePattern);
                    }
                    args.push("--context", "1", "--no-messages", directoryPath);
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, execRipgrep(rgPath, args)];
                case 3:
                    output = _a.sent();
                    return [3 /*break*/, 5];
                case 4:
                    error_1 = _a.sent();
                    console.error("Error executing ripgrep:", error_1);
                    return [2 /*return*/, "No results found"];
                case 5:
                    results = [];
                    currentFile = null;
                    output.split("\n").forEach(function (line) {
                        if (line) {
                            try {
                                var parsed = JSON.parse(line);
                                if (parsed.type === "begin") {
                                    currentFile = {
                                        file: parsed.data.path.text.toString(),
                                        searchResults: [],
                                    };
                                }
                                else if (parsed.type === "end") {
                                    // Reset the current result when a new file is encountered
                                    results.push(currentFile);
                                    currentFile = null;
                                }
                                else if ((parsed.type === "match" || parsed.type === "context") && currentFile) {
                                    var line_1 = __assign({ line: parsed.data.line_number, text: truncateLine(parsed.data.lines.text), isMatch: parsed.type === "match" }, (parsed.type === "match" && { column: parsed.data.absolute_offset }));
                                    var lastResult = currentFile.searchResults[currentFile.searchResults.length - 1];
                                    if ((lastResult === null || lastResult === void 0 ? void 0 : lastResult.lines.length) > 0) {
                                        var lastLine = lastResult.lines[lastResult.lines.length - 1];
                                        // If this line is contiguous with the last result, add to it
                                        if (parsed.data.line_number <= lastLine.line + 1) {
                                            lastResult.lines.push(line_1);
                                        }
                                        else {
                                            // Otherwise create a new result
                                            currentFile.searchResults.push({
                                                lines: [line_1],
                                            });
                                        }
                                    }
                                    else {
                                        // First line in file
                                        currentFile.searchResults.push({
                                            lines: [line_1],
                                        });
                                    }
                                }
                            }
                            catch (error) {
                                console.error("Error parsing ripgrep output:", error);
                            }
                        }
                    });
                    filteredResults = rooIgnoreController
                        ? results.filter(function (result) { return rooIgnoreController.validateAccess(result.file); })
                        : results;
                    return [2 /*return*/, formatResults(filteredResults, cwd)];
            }
        });
    });
}
function formatResults(fileResults, cwd) {
    var groupedResults = {};
    var totalResults = fileResults.reduce(function (sum, file) { return sum + file.searchResults.length; }, 0);
    var output = "";
    if (totalResults >= MAX_RESULTS) {
        output += "Showing first ".concat(MAX_RESULTS, " of ").concat(MAX_RESULTS, "+ results. Use a more specific search if necessary.\n\n");
    }
    else {
        output += "Found ".concat(totalResults === 1 ? "1 result" : "".concat(totalResults.toLocaleString(), " results"), ".\n\n");
    }
    // Group results by file name
    fileResults.slice(0, MAX_RESULTS).forEach(function (file) {
        var _a;
        var relativeFilePath = path.relative(cwd, file.file);
        if (!groupedResults[relativeFilePath]) {
            groupedResults[relativeFilePath] = [];
            (_a = groupedResults[relativeFilePath]).push.apply(_a, file.searchResults);
        }
    });
    for (var _i = 0, _a = Object.entries(groupedResults); _i < _a.length; _i++) {
        var _b = _a[_i], filePath = _b[0], fileResults_1 = _b[1];
        output += "# ".concat(filePath.toPosix(), "\n");
        fileResults_1.forEach(function (result) {
            // Only show results with at least one line
            if (result.lines.length > 0) {
                // Show all lines in the result
                result.lines.forEach(function (line) {
                    var lineNumber = String(line.line).padStart(3, " ");
                    output += "".concat(lineNumber, " | ").concat(line.text.trimEnd(), "\n");
                });
                output += "----\n";
            }
        });
        output += "\n";
    }
    return output.trim();
}
