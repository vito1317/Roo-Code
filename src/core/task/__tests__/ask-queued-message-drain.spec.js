import { Task } from "../Task";
// Keep this test focused: if a queued message arrives while Task.ask() is blocked,
// it should be consumed and used to fulfill the ask.
describe("Task.ask queued message drain", () => {
    it("consumes queued message while blocked on followup ask", async () => {
        const task = Object.create(Task.prototype);
        task.abort = false;
        task.clineMessages = [];
        task.askResponse = undefined;
        task.askResponseText = undefined;
        task.askResponseImages = undefined;
        task.lastMessageTs = undefined;
        // Message queue service exists in constructor; for unit test we can attach a real one.
        const { MessageQueueService } = await import("../../message-queue/MessageQueueService");
        task.messageQueueService = new MessageQueueService();
        task.addToClineMessages = vi.fn(async () => { });
        task.saveClineMessages = vi.fn(async () => { });
        task.updateClineMessage = vi.fn(async () => { });
        task.cancelAutoApprovalTimeout = vi.fn(() => { });
        task.checkpointSave = vi.fn(async () => { });
        task.emit = vi.fn();
        task.providerRef = { deref: () => undefined };
        const askPromise = task.ask("followup", "Q?", false);
        task.messageQueueService.addMessage("picked answer");
        const result = await askPromise;
        expect(result.response).toBe("messageResponse");
        expect(result.text).toBe("picked answer");
    });
});
//# sourceMappingURL=ask-queued-message-drain.spec.js.map