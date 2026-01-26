"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
exports.defaultPrompts = exports.FileRestrictionError = exports.defaultModeSlug = exports.modes = void 0;
exports.getGroupName = getGroupName;
exports.getToolsForMode = getToolsForMode;
exports.getModeBySlug = getModeBySlug;
exports.getModeConfig = getModeConfig;
exports.getAllModes = getAllModes;
exports.isCustomMode = isCustomMode;
exports.findModeBySlug = findModeBySlug;
exports.getModeSelection = getModeSelection;
exports.getAllModesWithPrompts = getAllModesWithPrompts;
exports.getFullModeDetails = getFullModeDetails;
exports.getRoleDefinition = getRoleDefinition;
exports.getDescription = getDescription;
exports.getWhenToUse = getWhenToUse;
exports.getCustomInstructions = getCustomInstructions;
var types_1 = require("@roo-code/types");
var custom_instructions_1 = require("../core/prompts/sections/custom-instructions");
var tools_1 = require("./tools");
// Helper to extract group name regardless of format
function getGroupName(group) {
    if (typeof group === "string") {
        return group;
    }
    return group[0];
}
// Helper to get all tools for a mode
function getToolsForMode(groups) {
    var tools = new Set();
    // Add tools from each group (excluding customTools which are opt-in only)
    groups.forEach(function (group) {
        var groupName = getGroupName(group);
        var groupConfig = tools_1.TOOL_GROUPS[groupName];
        groupConfig.tools.forEach(function (tool) { return tools.add(tool); });
    });
    // Always add required tools
    tools_1.ALWAYS_AVAILABLE_TOOLS.forEach(function (tool) { return tools.add(tool); });
    return Array.from(tools);
}
// Main modes configuration as an ordered array
exports.modes = types_1.DEFAULT_MODES;
// Export the default mode slug
exports.defaultModeSlug = exports.modes[0].slug;
// Helper functions
function getModeBySlug(slug, customModes) {
    // Check custom modes first
    var customMode = customModes === null || customModes === void 0 ? void 0 : customModes.find(function (mode) { return mode.slug === slug; });
    if (customMode) {
        return customMode;
    }
    // Then check built-in modes
    return exports.modes.find(function (mode) { return mode.slug === slug; });
}
function getModeConfig(slug, customModes) {
    var mode = getModeBySlug(slug, customModes);
    if (!mode) {
        throw new Error("No mode found for slug: ".concat(slug));
    }
    return mode;
}
// Get all available modes, with custom modes overriding built-in modes
function getAllModes(customModes) {
    if (!(customModes === null || customModes === void 0 ? void 0 : customModes.length)) {
        return __spreadArray([], exports.modes, true);
    }
    // Start with built-in modes
    var allModes = __spreadArray([], exports.modes, true);
    // Process custom modes
    customModes.forEach(function (customMode) {
        var index = allModes.findIndex(function (mode) { return mode.slug === customMode.slug; });
        if (index !== -1) {
            // Override existing mode
            allModes[index] = customMode;
        }
        else {
            // Add new mode
            allModes.push(customMode);
        }
    });
    return allModes;
}
// Check if a mode is custom or an override
function isCustomMode(slug, customModes) {
    return !!(customModes === null || customModes === void 0 ? void 0 : customModes.some(function (mode) { return mode.slug === slug; }));
}
/**
 * Find a mode by its slug, don't fall back to built-in modes
 */
function findModeBySlug(slug, modes) {
    return modes === null || modes === void 0 ? void 0 : modes.find(function (mode) { return mode.slug === slug; });
}
/**
 * Get the mode selection based on the provided mode slug, prompt component, and custom modes.
 * If a custom mode is found, it takes precedence over the built-in modes.
 * If no custom mode is found, the built-in mode is used with partial merging from promptComponent.
 * If neither is found, the default mode is used.
 */
function getModeSelection(mode, promptComponent, customModes) {
    var customMode = findModeBySlug(mode, customModes);
    var builtInMode = findModeBySlug(mode, exports.modes);
    // If we have a custom mode, use it entirely
    if (customMode) {
        return {
            roleDefinition: customMode.roleDefinition || "",
            baseInstructions: customMode.customInstructions || "",
            description: customMode.description || "",
        };
    }
    // Otherwise, use built-in mode as base and merge with promptComponent
    var baseMode = builtInMode || exports.modes[0]; // fallback to default mode
    return {
        roleDefinition: (promptComponent === null || promptComponent === void 0 ? void 0 : promptComponent.roleDefinition) || baseMode.roleDefinition || "",
        baseInstructions: (promptComponent === null || promptComponent === void 0 ? void 0 : promptComponent.customInstructions) || baseMode.customInstructions || "",
        description: baseMode.description || "",
    };
}
// Custom error class for file restrictions
var FileRestrictionError = /** @class */ (function (_super) {
    __extends(FileRestrictionError, _super);
    function FileRestrictionError(mode, pattern, description, filePath, tool) {
        var _this = this;
        var toolInfo = tool ? "Tool '".concat(tool, "' in mode '").concat(mode, "'") : "This mode (".concat(mode, ")");
        _this = _super.call(this, "".concat(toolInfo, " can only edit files matching pattern: ").concat(pattern).concat(description ? " (".concat(description, ")") : "", ". Got: ").concat(filePath)) || this;
        _this.name = "FileRestrictionError";
        return _this;
    }
    return FileRestrictionError;
}(Error));
exports.FileRestrictionError = FileRestrictionError;
// Create the mode-specific default prompts
exports.defaultPrompts = Object.freeze(Object.fromEntries(exports.modes.map(function (mode) { return [
    mode.slug,
    {
        roleDefinition: mode.roleDefinition,
        whenToUse: mode.whenToUse,
        customInstructions: mode.customInstructions,
        description: mode.description,
    },
]; })));
// Helper function to get all modes with their prompt overrides from extension state
function getAllModesWithPrompts(context) {
    return __awaiter(this, void 0, void 0, function () {
        var customModes, customModePrompts, allModes;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, context.globalState.get("customModes")];
                case 1:
                    customModes = (_a.sent()) || [];
                    return [4 /*yield*/, context.globalState.get("customModePrompts")];
                case 2:
                    customModePrompts = (_a.sent()) || {};
                    allModes = getAllModes(customModes);
                    return [2 /*return*/, allModes.map(function (mode) {
                            var _a, _b, _c, _d, _e, _f;
                            return (__assign(__assign({}, mode), { roleDefinition: (_b = (_a = customModePrompts[mode.slug]) === null || _a === void 0 ? void 0 : _a.roleDefinition) !== null && _b !== void 0 ? _b : mode.roleDefinition, whenToUse: (_d = (_c = customModePrompts[mode.slug]) === null || _c === void 0 ? void 0 : _c.whenToUse) !== null && _d !== void 0 ? _d : mode.whenToUse, customInstructions: (_f = (_e = customModePrompts[mode.slug]) === null || _e === void 0 ? void 0 : _e.customInstructions) !== null && _f !== void 0 ? _f : mode.customInstructions }));
                        })];
            }
        });
    });
}
// Helper function to get complete mode details with all overrides
function getFullModeDetails(modeSlug, customModes, customModePrompts, options) {
    return __awaiter(this, void 0, void 0, function () {
        var baseMode, promptComponent, baseCustomInstructions, baseWhenToUse, baseDescription, fullCustomInstructions;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    baseMode = getModeBySlug(modeSlug, customModes) || exports.modes.find(function (m) { return m.slug === modeSlug; }) || exports.modes[0];
                    promptComponent = customModePrompts === null || customModePrompts === void 0 ? void 0 : customModePrompts[modeSlug];
                    baseCustomInstructions = (promptComponent === null || promptComponent === void 0 ? void 0 : promptComponent.customInstructions) || baseMode.customInstructions || "";
                    baseWhenToUse = (promptComponent === null || promptComponent === void 0 ? void 0 : promptComponent.whenToUse) || baseMode.whenToUse || "";
                    baseDescription = (promptComponent === null || promptComponent === void 0 ? void 0 : promptComponent.description) || baseMode.description || "";
                    fullCustomInstructions = baseCustomInstructions;
                    if (!(options === null || options === void 0 ? void 0 : options.cwd)) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, custom_instructions_1.addCustomInstructions)(baseCustomInstructions, options.globalCustomInstructions || "", options.cwd, modeSlug, { language: options.language })];
                case 1:
                    fullCustomInstructions = _a.sent();
                    _a.label = 2;
                case 2: 
                // Return mode with any overrides applied
                return [2 /*return*/, __assign(__assign({}, baseMode), { roleDefinition: (promptComponent === null || promptComponent === void 0 ? void 0 : promptComponent.roleDefinition) || baseMode.roleDefinition, whenToUse: baseWhenToUse, description: baseDescription, customInstructions: fullCustomInstructions })];
            }
        });
    });
}
// Helper function to safely get role definition
function getRoleDefinition(modeSlug, customModes) {
    var mode = getModeBySlug(modeSlug, customModes);
    if (!mode) {
        console.warn("No mode found for slug: ".concat(modeSlug));
        return "";
    }
    return mode.roleDefinition;
}
// Helper function to safely get description
function getDescription(modeSlug, customModes) {
    var _a;
    var mode = getModeBySlug(modeSlug, customModes);
    if (!mode) {
        console.warn("No mode found for slug: ".concat(modeSlug));
        return "";
    }
    return (_a = mode.description) !== null && _a !== void 0 ? _a : "";
}
// Helper function to safely get whenToUse
function getWhenToUse(modeSlug, customModes) {
    var _a;
    var mode = getModeBySlug(modeSlug, customModes);
    if (!mode) {
        console.warn("No mode found for slug: ".concat(modeSlug));
        return "";
    }
    return (_a = mode.whenToUse) !== null && _a !== void 0 ? _a : "";
}
// Helper function to safely get custom instructions
function getCustomInstructions(modeSlug, customModes) {
    var _a;
    var mode = getModeBySlug(modeSlug, customModes);
    if (!mode) {
        console.warn("No mode found for slug: ".concat(modeSlug));
        return "";
    }
    return (_a = mode.customInstructions) !== null && _a !== void 0 ? _a : "";
}
