import { applyDiffTool as applyDiffToolClass } from "./ApplyDiffTool";
export async function applyDiffTool(cline, block, askApproval, handleError, pushToolResult) {
    return applyDiffToolClass.handle(cline, block, {
        askApproval,
        handleError,
        pushToolResult,
    });
}
//# sourceMappingURL=MultiApplyDiffTool.js.map