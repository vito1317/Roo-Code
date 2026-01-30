import { createMCPServerInstructions } from "./create-mcp-server";
import { createModeInstructions } from "./create-mode";
export async function fetchInstructions(text, detail) {
    switch (text) {
        case "create_mcp_server": {
            return await createMCPServerInstructions(detail.mcpHub, detail.diffStrategy);
        }
        case "create_mode": {
            return await createModeInstructions(detail.context);
        }
        default: {
            return "";
        }
    }
}
//# sourceMappingURL=instructions.js.map