import * as vscode from "vscode";
import { EditorUtils } from "../../integrations/editor/EditorUtils";
import { CodeActionProvider, TITLES } from "../CodeActionProvider";
vi.mock("vscode", () => ({
    CodeAction: vi.fn().mockImplementation((title, kind) => ({
        title,
        kind,
        command: undefined,
    })),
    CodeActionKind: {
        QuickFix: { value: "quickfix" },
        RefactorRewrite: { value: "refactor.rewrite" },
    },
    Range: vi.fn().mockImplementation((startLine, startChar, endLine, endChar) => ({
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
    })),
    DiagnosticSeverity: {
        Error: 0,
        Warning: 1,
        Information: 2,
        Hint: 3,
    },
    workspace: {
        getConfiguration: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue(true),
        }),
    },
}));
vi.mock("../../integrations/editor/EditorUtils", () => ({
    EditorUtils: {
        getEffectiveRange: vi.fn(),
        getFilePath: vi.fn(),
        hasIntersectingRange: vi.fn(),
        createDiagnosticData: vi.fn(),
    },
}));
describe("CodeActionProvider", () => {
    let provider;
    let mockDocument;
    let mockRange;
    let mockContext;
    beforeEach(() => {
        provider = new CodeActionProvider();
        mockDocument = {
            getText: vi.fn(),
            lineAt: vi.fn(),
            lineCount: 10,
            uri: { fsPath: "/test/file.ts" },
        };
        mockRange = new vscode.Range(0, 0, 0, 10);
        mockContext = { diagnostics: [] };
        EditorUtils.getEffectiveRange.mockReturnValue({
            range: mockRange,
            text: "test code",
        });
        EditorUtils.getFilePath.mockReturnValue("/test/file.ts");
        EditorUtils.hasIntersectingRange.mockReturnValue(true);
        EditorUtils.createDiagnosticData.mockImplementation((d) => d);
    });
    describe("provideCodeActions", () => {
        it("should provide explain, improve, fix logic, and add to context actions by default", () => {
            const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext);
            expect(actions).toHaveLength(3);
            expect(actions[0].title).toBe(TITLES.ADD_TO_CONTEXT);
            expect(actions[1].title).toBe(TITLES.EXPLAIN);
            expect(actions[2].title).toBe(TITLES.IMPROVE);
        });
        it("should provide fix action instead of fix logic when diagnostics exist", () => {
            mockContext.diagnostics = [
                { message: "test error", severity: vscode.DiagnosticSeverity.Error, range: mockRange },
            ];
            const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext);
            expect(actions).toHaveLength(2);
            expect(actions.some((a) => a.title === `${TITLES.FIX}`)).toBe(true);
            expect(actions.some((a) => a.title === `${TITLES.ADD_TO_CONTEXT}`)).toBe(true);
        });
        it("should return empty array when no effective range", () => {
            ;
            EditorUtils.getEffectiveRange.mockReturnValue(null);
            const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext);
            expect(actions).toEqual([]);
        });
        it("should return empty array when enableCodeActions is disabled", () => {
            // Mock the configuration to return false for enableCodeActions
            const mockGet = vi.fn().mockReturnValue(false);
            const mockGetConfiguration = vi.fn().mockReturnValue({
                get: mockGet,
            });
            vscode.workspace.getConfiguration.mockReturnValue(mockGetConfiguration());
            const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext);
            expect(actions).toEqual([]);
            expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("roo-cline");
            expect(mockGet).toHaveBeenCalledWith("enableCodeActions", true);
        });
        it("should handle errors gracefully", () => {
            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
            // Reset the workspace mock to return true for enableCodeActions
            const mockGet = vi.fn().mockReturnValue(true);
            const mockGetConfiguration = vi.fn().mockReturnValue({
                get: mockGet,
            });
            vscode.workspace.getConfiguration.mockReturnValue(mockGetConfiguration());
            EditorUtils.getEffectiveRange.mockImplementation(() => {
                throw new Error("Test error");
            });
            const actions = provider.provideCodeActions(mockDocument, mockRange, mockContext);
            expect(actions).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalledWith("Error providing code actions:", expect.any(Error));
            consoleErrorSpy.mockRestore();
        });
    });
});
//# sourceMappingURL=CodeActionProvider.spec.js.map