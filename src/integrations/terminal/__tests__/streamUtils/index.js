// streamUtils/index.ts
import { createBashCommandStream } from "./bashStream";
import { createCmdCommandStream } from "./cmdStream";
import { createPowerShellStream } from "./pwshStream";
import { createBaseMockStream, createBashMockStream, createCmdMockStream, createPowerShellMockStream, createChunkedMockStream, } from "./mockStream";
/**
 * Check if PowerShell Core (pwsh) is available on the system
 * @returns Boolean indicating whether pwsh is available
 */
export function isPowerShellCoreAvailable() {
    return global.__TEST_ENV__?.isPowerShellAvailable || false;
}
/**
 * Get the current platform
 * @returns The current platform: 'win32', 'darwin', 'linux', etc.
 */
export function getPlatform() {
    return global.__TEST_ENV__?.platform || process.platform;
}
/**
 * Check if the current platform is Windows
 * @returns Boolean indicating whether the current platform is Windows
 */
export function isWindows() {
    return getPlatform() === "win32";
}
// Export all streams for direct use in specific test files
export { 
// Real command execution streams
createBashCommandStream, createCmdCommandStream, createPowerShellStream, 
// Mock streams
createBaseMockStream, createBashMockStream, createCmdMockStream, createPowerShellMockStream, createChunkedMockStream, };
//# sourceMappingURL=index.js.map