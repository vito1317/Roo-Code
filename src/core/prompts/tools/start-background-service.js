/**
 * Sentinel Edition - Start Background Service Tool Description
 *
 * Allows agents to start development servers or other long-running processes
 * in the background without blocking the conversation.
 */
export const getStartBackgroundServiceDescription = () => {
    return `## start_background_service
Description: Start a development server or other long-running process in the background. The process will continue running while you perform other tasks. Useful for starting test servers before browser testing.
Parameters:
- command: (required) The shell command to run (e.g., "npm run dev", "python -m http.server 8000")
- port: (optional) The port number to wait for. Will auto-detect from common commands: Vite=5173, others=3000
- working_directory: (optional) The directory to run the command in. Defaults to current workspace.
- health_check_path: (optional) Path to check for server readiness. Defaults to "/"
- timeout: (optional) Milliseconds to wait for server to be ready. Defaults to 30000.

Usage:
<start_background_service>
<command>npm run dev</command>
<port>5173</port>
</start_background_service>

Note: The tool will poll the server URL until it responds, then return success. Use browser_action to navigate to the server after it starts.`;
};
//# sourceMappingURL=start-background-service.js.map