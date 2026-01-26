"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Package = void 0;
var package_json_1 = require("../package.json");
// These ENV variables can be defined by ESBuild when building the extension
// in order to override the values in package.json. This allows us to build
// different extension variants with the same package.json file.
// The build process still needs to emit a modified package.json for consumption
// by VSCode, but that build artifact is not used during the transpile step of
// the build, so we still need this override mechanism.
exports.Package = {
    publisher: package_json_1.publisher,
    name: process.env.PKG_NAME || package_json_1.name,
    version: process.env.PKG_VERSION || package_json_1.version,
    outputChannel: process.env.PKG_OUTPUT_CHANNEL || "Roo-Code",
    sha: process.env.PKG_SHA,
};
