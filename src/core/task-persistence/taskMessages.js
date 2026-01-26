import { safeWriteJson } from "../../utils/safeWriteJson";
import * as path from "path";
import * as fs from "fs/promises";
import { fileExistsAtPath } from "../../utils/fs";
import { GlobalFileNames } from "../../shared/globalFileNames";
import { getTaskDirectoryPath } from "../../utils/storage";
export async function readTaskMessages({ taskId, globalStoragePath, }) {
    const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId);
    const filePath = path.join(taskDir, GlobalFileNames.uiMessages);
    const fileExists = await fileExistsAtPath(filePath);
    if (fileExists) {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    }
    return [];
}
export async function saveTaskMessages({ messages, taskId, globalStoragePath }) {
    const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId);
    const filePath = path.join(taskDir, GlobalFileNames.uiMessages);
    await safeWriteJson(filePath, messages);
}
//# sourceMappingURL=taskMessages.js.map