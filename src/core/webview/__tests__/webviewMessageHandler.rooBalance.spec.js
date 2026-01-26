import { describe, it, expect, vi, beforeEach } from "vitest";
import { webviewMessageHandler } from "../webviewMessageHandler";
import { CloudService } from "@roo-code/cloud";
vi.mock("@roo-code/cloud", () => ({
    CloudService: {
        hasInstance: vi.fn(),
        instance: {
            cloudAPI: {
                creditBalance: vi.fn(),
            },
        },
    },
}));
describe("webviewMessageHandler - requestRooCreditBalance", () => {
    let mockProvider;
    beforeEach(() => {
        mockProvider = {
            postMessageToWebview: vi.fn(),
            contextProxy: {
                getValue: vi.fn(),
                setValue: vi.fn(),
            },
            getCurrentTask: vi.fn(),
            cwd: "/test/path",
        };
        vi.clearAllMocks();
    });
    it("should handle requestRooCreditBalance and return balance", async () => {
        const mockBalance = 42.75;
        const requestId = "test-request-id";
        CloudService.hasInstance.mockReturnValue(true);
        CloudService.instance.cloudAPI.creditBalance.mockResolvedValue(mockBalance);
        await webviewMessageHandler(mockProvider, {
            type: "requestRooCreditBalance",
            requestId,
        });
        expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
            type: "rooCreditBalance",
            requestId,
            values: { balance: mockBalance },
        });
    });
    it("should handle CloudAPI errors", async () => {
        const requestId = "test-request-id";
        const errorMessage = "Failed to fetch balance";
        CloudService.hasInstance.mockReturnValue(true);
        CloudService.instance.cloudAPI.creditBalance.mockRejectedValue(new Error(errorMessage));
        await webviewMessageHandler(mockProvider, {
            type: "requestRooCreditBalance",
            requestId,
        });
        expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
            type: "rooCreditBalance",
            requestId,
            values: { error: errorMessage },
        });
    });
    it("should handle missing CloudService", async () => {
        const requestId = "test-request-id";
        CloudService.hasInstance.mockReturnValue(false);
        await webviewMessageHandler(mockProvider, {
            type: "requestRooCreditBalance",
            requestId,
        });
        expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
            type: "rooCreditBalance",
            requestId,
            values: { error: "Cloud service not available" },
        });
    });
    it("should handle missing cloudAPI", async () => {
        const requestId = "test-request-id";
        CloudService.hasInstance.mockReturnValue(true);
        CloudService.instance.cloudAPI = null;
        await webviewMessageHandler(mockProvider, {
            type: "requestRooCreditBalance",
            requestId,
        });
        expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
            type: "rooCreditBalance",
            requestId,
            values: { error: "Cloud service not available" },
        });
    });
});
//# sourceMappingURL=webviewMessageHandler.rooBalance.spec.js.map