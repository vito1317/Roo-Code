import { ClineProvider } from "../../core/webview/ClineProvider";
import { getVisibleProviderOrLog } from "../registerCommands";
vi.mock("execa", () => ({
    execa: vi.fn(),
}));
vi.mock("vscode", () => ({
    CodeActionKind: {
        QuickFix: { value: "quickfix" },
        RefactorRewrite: { value: "refactor.rewrite" },
    },
    window: {
        createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    workspace: {
        workspaceFolders: [
            {
                uri: {
                    fsPath: "/mock/workspace",
                },
            },
        ],
    },
}));
vi.mock("../../core/webview/ClineProvider");
describe("getVisibleProviderOrLog", () => {
    let mockOutputChannel;
    beforeEach(() => {
        mockOutputChannel = {
            appendLine: vi.fn(),
            append: vi.fn(),
            clear: vi.fn(),
            hide: vi.fn(),
            name: "mock",
            replace: vi.fn(),
            show: vi.fn(),
            dispose: vi.fn(),
        };
        vi.clearAllMocks();
    });
    it("returns the visible provider if found", () => {
        const mockProvider = {};
        ClineProvider.getVisibleInstance.mockReturnValue(mockProvider);
        const result = getVisibleProviderOrLog(mockOutputChannel);
        expect(result).toBe(mockProvider);
        expect(mockOutputChannel.appendLine).not.toHaveBeenCalled();
    });
    it("logs and returns undefined if no provider found", () => {
        ;
        ClineProvider.getVisibleInstance.mockReturnValue(undefined);
        const result = getVisibleProviderOrLog(mockOutputChannel);
        expect(result).toBeUndefined();
        expect(mockOutputChannel.appendLine).toHaveBeenCalledWith("Cannot find any visible Roo Code instances.");
    });
});
//# sourceMappingURL=registerCommands.spec.js.map