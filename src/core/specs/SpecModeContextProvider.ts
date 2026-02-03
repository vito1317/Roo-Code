/**
 * SpecModeContextProvider - Dynamic prompt injection for Spec Mode
 *
 * This module provides dynamic context for Spec mode by checking which
 * spec files exist and generating appropriate prompts for each workflow phase.
 */

import * as path from "path"
import * as fs from "fs"

export type SpecPhase = "requirements" | "design" | "tasks" | "execution"

export interface SpecFilesStatus {
	requirementsExists: boolean
	designExists: boolean
	tasksExists: boolean
	specsDirectoryExists: boolean
}

export interface SpecModeContext {
	currentPhase: SpecPhase
	filesStatus: SpecFilesStatus
	dynamicPrompt: string
}

/**
 * Check which spec files exist in the workspace
 */
export function checkSpecFilesStatus(workspacePath: string): SpecFilesStatus {
	const specsDir = path.join(workspacePath, ".specs")
	const specsDirectoryExists = fs.existsSync(specsDir)

	return {
		specsDirectoryExists,
		requirementsExists: specsDirectoryExists && fs.existsSync(path.join(specsDir, "requirements.md")),
		designExists: specsDirectoryExists && fs.existsSync(path.join(specsDir, "design.md")),
		tasksExists: specsDirectoryExists && fs.existsSync(path.join(specsDir, "tasks.md")),
	}
}

/**
 * Determine current workflow phase based on file existence
 */
export function determineCurrentPhase(status: SpecFilesStatus): SpecPhase {
	if (!status.requirementsExists) {
		return "requirements"
	}
	if (!status.designExists) {
		return "design"
	}
	if (!status.tasksExists) {
		return "tasks"
	}
	return "execution"
}

/**
 * Generate dynamic prompt based on current phase
 */
export function generateSpecModePrompt(status: SpecFilesStatus): string {
	const phase = determineCurrentPhase(status)

	const statusIndicators = [
		status.requirementsExists ? "✅" : "⬜",
		status.designExists ? "✅" : "⬜",
		status.tasksExists ? "✅" : "⬜",
	]

	const header = `
## 📊 SPEC WORKFLOW STATUS
\`\`\`
${statusIndicators[0]} Requirements  ${status.requirementsExists ? "(.specs/requirements.md)" : "- Not created"}
${statusIndicators[1]} Design        ${status.designExists ? "(.specs/design.md)" : "- Not created"}
${statusIndicators[2]} Tasks         ${status.tasksExists ? "(.specs/tasks.md)" : "- Not created"}
\`\`\`

**Current Phase: ${phase.toUpperCase()}**

---

## ⚠️ 重要規則

**你正在 Spec Mode 中工作。**

${(phase === "tasks" || phase === "execution") ? `
### ✅ Phase 3-4 - 可以建立子任務

在 Tasks/Execution 階段，你**必須使用** \`new_task\` 工具為每個 TASK-XXX 建立獨立的子任務執行。

- ✅ **必須使用 \`new_task\` 工具** 為每個任務建立獨立子任務
- ✅ **依序建立子任務**：TASK-001 → TASK-002 → TASK-003...
- ❌ **禁止直接執行任務**：你的職責是建立子任務，由子任務執行實際工作
- ❌ **禁止說「無法建立子任務」**：這是你的主要工作，必須執行！

### 📋 傳遞上下文給子任務（必須！）

**當建立子任務時，必須在訊息中包含相關的 spec 上下文！**

特別是 **Designer 任務**，必須包含需求摘要，否則 Designer 會使用預設的通用 UI：

\`\`\`xml
<new_task>
<mode>Designer</mode>
<message>
## 任務：[根據 TASK-XXX 的內容]

## 需求上下文（來自 .specs/requirements.md）：
- 專案名稱：[實際專案名]
- 目標使用者：[實際使用者]
- 主要功能：
  1. [功能1]
  2. [功能2]
  3. [功能3]

## 設計規格（來自 .specs/design.md）：
- 頁面數量：[X] 頁
- 頁面清單：
  1. [頁面1名稱]
  2. [頁面2名稱]

## 設計要求：
請根據以上需求設計 UI，**不要使用任何通用或預設的元素名稱**！
</message>
</new_task>
\`\`\`

**⚠️ 重要：如果子任務訊息太簡短（例如只寫「完成 TASK-001」），子 Agent 無法得知需求，會產出錯誤結果！**
` : `
### ❌ DO NOT DELEGATE!

- ❌ **禁止使用 \`new_task\` 工具** 建立子任務或委派給其他模式
- ❌ **禁止切換到 Architect / Code / Designer 模式** 來處理 spec 檔案
- ✅ **你必須親自建立** \`.specs/requirements.md\`、\`.specs/design.md\`、\`.specs/tasks.md\`
- ✅ **使用 \`write_to_file\` 工具** 直接建立這些檔案

**原因**：Spec Mode 在 Phase 1-2 的目的是收集需求、設計架構、分解任務。這些都是你在 Spec Mode 中的職責，不應交給其他 agent。
`}

---
`


	switch (phase) {
		case "requirements":
			// 如果檔案已存在，顯示保護警告
			if (status.requirementsExists) {
				return (
					header +
					`
## 📋 PHASE 1: Requirements (⚠️ Already Exists)

**⚠️ WARNING: \`.specs/requirements.md\` already exists!**

**DO NOT** overwrite the existing file. Instead:
1. **Read the current content** first using \`read_file\`
2. **Review** what's already documented
3. **Update or append** new requirements if needed
4. **Ask user to confirm** before any changes

If the user explicitly wants to start fresh, they must confirm this action.
Otherwise, preserve the existing content!
`
				)
			}
			return (
				header +
				`
## 📋 PHASE 1: Requirements Gathering

You are in the **Requirements Phase**. Create comprehensive, detailed requirements documentation.

### 📌 Context

When the user uses \`@filename\` to mention files, the file content is **already included in the conversation context**.
Look for \`[read_file for 'xxx']\` blocks above - that's the user's file content.

### 🔄 MANDATORY: Process ALL Sections Iteratively

**You are NOT done until you have processed EVERY section from the user's file!**

Follow this exact workflow:

**Step 1: First write - Create file with header and first section**
\`\`\`
write_to_file(".specs/requirements.md", "# Project Title\\n\\n## 1. Overview\\n[content from user's first section]...")
\`\`\`

**Step 2: Loop through remaining sections - Append each one**
\`\`\`
write_to_file(".specs/requirements.md", "<!-- APPEND -->\\n\\n## 2. [Next Section]\\n[expand content]...")
write_to_file(".specs/requirements.md", "<!-- APPEND -->\\n\\n## 3. [Next Section]\\n[expand content]...")
write_to_file(".specs/requirements.md", "<!-- APPEND -->\\n\\n## 4. [Next Section]\\n[expand content]...")
... continue until ALL sections are done ...
\`\`\`

### ⚠️ CRITICAL RULES

1. **Count the sections** in user's file first
2. **Process each section** one by one
3. **APPEND after each section** - don't try to write everything at once
4. **DO NOT say "complete"** until you have processed EVERY section
5. **Your output must be LONGER** than user's input - expand, don't summarize

### 📝 Example Workflow

If user's file has sections: 概述, 功能需求, 非功能需求, 技術堆疊, 驗收條件

You should make **5 separate write_to_file calls**:
1. \`write_to_file(..., "# 標題\\n\\n## 概述\\n...")\` - Create file
2. \`write_to_file(..., "<!-- APPEND -->\\n\\n## 功能需求\\n...")\` - Append
3. \`write_to_file(..., "<!-- APPEND -->\\n\\n## 非功能需求\\n...")\` - Append
4. \`write_to_file(..., "<!-- APPEND -->\\n\\n## 技術堆疊\\n...")\` - Append
5. \`write_to_file(..., "<!-- APPEND -->\\n\\n## 驗收條件\\n...")\` - Append

**Only after the 5th write can you say the requirements phase is complete.**
`
			)

		case "design":
			// 如果 design.md 已存在，顯示保護警告
			if (status.designExists) {
				return (
					header +
					`
## 🎨 PHASE 2: Design (⚠️ Already Exists)

**⚠️ WARNING: \`.specs/design.md\` already exists!**

**DO NOT** overwrite the existing file. Instead:
1. **Read the current content** first using \`read_file\`
2. **Review** what's already designed
3. **Update or append** new design elements if needed
4. **Ask user to confirm** before any changes

If the user explicitly wants to redesign from scratch, they must confirm.
`
				)
			}
			return (
				header +
				`
## 🎨 PHASE 2: Design

You are in the **Design Phase**. Requirements documentation is complete.

---

### 📏 文件長度要求（必達！）

**design.md 必須至少 800-1500 字！**

- 必須包含系統架構圖（Mermaid）
- 必須包含資料庫 ER 圖
- 必須包含 API 規格
- 少於 800 字 = 不合格

---

### 🎯 你的任務

1. **閱讀 \`.specs/requirements.md\`** 完全理解需求（特別注意技術堆疊）
2. **建立 \`.specs/design.md\`** 包含完整的系統設計（至少 800-1500 字）

### 📐 design.md 必須包含的內容


#### 1. 系統架構總覽 (Architecture Overview)

\`\`\`mermaid
graph TB
    subgraph Frontend
        A[Web App] --> B[Mobile App]
    end
    subgraph Backend
        C[API Gateway] --> D[Service Layer]
        D --> E[Data Layer]
    end
    A --> C
    B --> C
\`\`\`

說明：
- 主要組件及其職責
- 組件之間的通訊方式
- 資料流向

#### 2. 技術堆棧 (Technology Stack)

| 層級 | 技術選擇 | 選擇原因 |
|------|----------|----------|
| 前端 | React/Vue/Angular | ... |
| 後端 | Node.js/Laravel/Django | ... |
| 資料庫 | PostgreSQL/MySQL/MongoDB | ... |
| 快取 | Redis | ... |
| 部署 | Docker/K8s/AWS | ... |

#### 3. 資料庫設計 (Database Schema)

為每個核心實體提供：

\`\`\`markdown
### Table: users
| 欄位名稱 | 資料型態 | 約束條件 | 說明 |
|----------|----------|----------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 主鍵 |
| email | VARCHAR(255) | UNIQUE, NOT NULL | 使用者信箱 |
| password | VARCHAR(255) | NOT NULL | 加密密碼 |
| created_at | TIMESTAMP | DEFAULT NOW() | 建立時間 |

### 關聯圖 (ER Diagram)
\`\`\`mermaid
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : "ordered in"
\`\`\`
\`\`\`

#### 4. API 設計 (API Design)

\`\`\`markdown
### API Endpoints

#### 認證 (Authentication)
| Method | Endpoint | 描述 | Request Body | Response |
|--------|----------|------|--------------|----------|
| POST | /api/auth/login | 使用者登入 | {email, password} | {token, user} |
| POST | /api/auth/register | 使用者註冊 | {name, email, password} | {user} |
| POST | /api/auth/logout | 使用者登出 | - | {message} |

#### 資源 CRUD
| Method | Endpoint | 描述 |
|--------|----------|------|
| GET | /api/resources | 取得列表 |
| GET | /api/resources/:id | 取得單一資源 |
| POST | /api/resources | 建立資源 |
| PUT | /api/resources/:id | 更新資源 |
| DELETE | /api/resources/:id | 刪除資源 |
\`\`\`

#### 5. 前端頁面結構 (UI Structure)

\`\`\`markdown
### 頁面清單
- **/** - 首頁/儀表板
- **/login** - 登入頁面
- **/register** - 註冊頁面
- **/dashboard** - 使用者儀表板
- **/settings** - 設定頁面

### 元件結構
\`\`\`mermaid
graph TD
    App --> Layout
    Layout --> Header
    Layout --> Sidebar
    Layout --> MainContent
    Layout --> Footer
\`\`\`
\`\`\`

#### 6. 安全設計 (Security Design)
- **認證機制**: JWT / Session
- **授權策略**: RBAC / ABAC
- **資料驗證**: 前端 + 後端雙重驗證
- **敏感資料處理**: 加密、雜湊

#### 7. 效能考量 (Performance Considerations)
- **快取策略**: 什麼資料需要快取
- **資料庫優化**: 索引設計
- **前端優化**: 懶載入、程式碼分割

### ⚠️ 重要提醒

- **用圖表說明**: Mermaid 圖表讓架構更清晰
- **具體而非抽象**: 給出實際的欄位名稱、API 路徑
- **考慮擴展性**: 設計要支援未來成長
- **基於需求**: 每個設計決策都要對應到需求

### 🚀 開始時

1. 仔細閱讀 requirements.md
2. 先畫出整體架構圖
3. 再逐一設計各個模組
4. 使用 \`write_to_file\` 建立 design.md

**⚠️ 重要：**
- **設計文件至少 500-1000 字**，確保架構足夠清晰
- 使用 Mermaid 圖表表達架構關係
- 每個模組的 API 要有完整規格
`
			)

		case "tasks":
			// 如果 tasks.md 已存在，顯示保護警告
			if (status.tasksExists) {
				return (
					header +
					`
## ✅ PHASE 3: Task Breakdown (⚠️ Already Exists)

**⚠️ WARNING: \`.specs/tasks.md\` already exists!**

**DO NOT** overwrite the existing file. Instead:
1. **Read the current content** first using \`read_file\`
2. **Review** what tasks are already defined and their status
3. **Update** task statuses or add new tasks if needed
4. **Ask user to confirm** before any changes

**Task Status Legend:**
- \`[ ]\` = pending
- \`[/]\` = in progress  
- \`[x]\` = completed

If the user explicitly wants to redefine tasks, they must confirm.
`
				)
			}
			return (
				header +
				`
## ✅ PHASE 3: Task Breakdown

You are in the **Task Breakdown Phase**. Requirements and Design are complete.

---

### 📏 文件長度要求（必達！）

**tasks.md 必須至少 800-1500 字！**

- 每個任務必須有完整的描述、涉及檔案、驗收標準
- 任務數量至少 8-15 個（依專案規模調整）
- 少於 800 字 = 不合格

---

### 🔴 TASK-001 的判斷邏輯

**根據專案類型決定 TASK-001：**

**情況 A：新建專案** → TASK-001 = 建立 Framework
- 需要從零開始建立專案
- 使用者明確說要建立新的應用程式

**情況 B：修改現有專案** → TASK-001 = 第一個功能任務
- 專案已經存在（有 composer.json、package.json 等）
- 使用者說要「修改」、「新增功能」、「修復」等

**新建專案的 TASK-001 範例：**
\`\`\`markdown
### TASK-001: 建立專案開發環境與 Framework (complexity: low)

**描述:**
根據 requirements.md 中指定的技術堆疊，建立專案的基礎開發環境。

**執行指令:**
- Laravel: \`composer create-project laravel/laravel .\`
- Vue: \`npm create vue@latest .\`

**驗收標準:**
- [ ] Framework 專案成功建立
- [ ] 可正常啟動開發伺服器
\`\`\`

**修改現有專案的 TASK-001 範例：**
\`\`\`markdown
### TASK-001: [第一個功能任務名稱] (complexity: medium)

**描述:**
[直接描述要修改或新增的功能]

**涉及檔案:**
- \`現有檔案路徑\`
\`\`\`

---

1. **Read \`.specs/requirements.md\`** and **\`.specs/design.md\`**
2. **Create \`.specs/tasks.md\`** with **DETAILED** task list:

**🚨 CRITICAL: Create GRANULAR tasks with FULL details!**

**Task Format (MUST follow exactly):**
\`\`\`markdown
# [Project Name] 專案任務清單

## Phase 1: 專案環境建立

### TASK-001: 建立專案開發環境與 Framework (complexity: low)
[如上所示]

---

## Phase 2: [功能開發]

### TASK-002: [Next task...] (complexity: medium)

**描述:**
[2-3 sentences explaining WHAT this task does and WHY]

**涉及檔案:**
- \`path/to/file1.ext\` - [purpose]
- \`path/to/file2.ext\` - [purpose]

**驗收標準:**
- [ ] [Specific, testable criterion 1]
- [ ] [Specific, testable criterion 2]
- [ ] [Specific, testable criterion 3]

**依賴:** TASK-001
**負責:** Builder
\`\`\`

3. **Ask user to confirm** tasks before execution

**🎯 TASK GRANULARITY RULES:**
- Each task should take **15-60 minutes** to complete
- Each task should modify **1-5 files** maximum
- If a task affects more than 5 files, **SPLIT IT**
- Every CRUD operation is a separate task
- Configuration and implementation are separate tasks

**EXAMPLE - Wrong vs Right:**
❌ "Set up user authentication" (too broad)
✅ Split into:
  - TASK-001: Create User model and migration
  - TASK-002: Create UserController with index/store methods
  - TASK-003: Add authentication middleware
  - TASK-004: Create login/register views
  - TASK-005: Add authentication routes
  - TASK-006: Write authentication tests

**⚠️ 重要：**
- **任務文件至少 500-1000 字**，每個任務都要有清楚的描述
- 第一個任務必須是「建立專案 Framework」（如有需要）
- 每個任務要列出涉及的檔案和驗收標準
`
			)

		case "execution":
			return (
				header +
				`
## 🚀 PHASE 4: Task Execution

All spec files are ready. Execute tasks **IN STRICT SEQUENCE**.

---

### 🚨 CRITICAL: 嚴格按照順序執行！

**❌ 絕對不可以跳過任務或亂序執行！**

1. **先讀取 \`.specs/tasks.md\`** 確認目前狀態
2. **找到第一個 \`[ ]\` 狀態的任務** - 那是你唯一的焦點
3. **TASK-001 沒有完成前，不可以開始 TASK-002**
4. **檢查任務依賴** - 如果 TASK-002 依賴 TASK-001，必須先完成 TASK-001

---

### � 極為重要：先建立 Framework！

**在建立任何專案檔案之前，必須先：**

1. **確認 requirements.md 中指定的 Framework**
   - 前端：React, Vue, Angular, Next.js, Nuxt...
   - 後端：Laravel, Django, Spring, Express...
   
2. **使用正確的指令建立 Framework 專案**
   - Laravel: \`composer create-project laravel/laravel .\`
   - Vue: \`npm create vue@latest .\`
   - React: \`npx create-react-app .\`
   - Next.js: \`npx create-next-app@latest .\`
   - Django: \`django-admin startproject myproject .\`

3. **等待 Framework 建立完成後，才能建立其他檔案**

**Example - 錯誤做法：**
\`\`\`
TASK-001: 建立 Laravel 12 專案 [ ]
TASK-002: 建立 User 模型和遷移 [ ]

❌ AI 直接建立 User.php 而沒有先建立 Laravel → 錯誤！
\`\`\`

**Example - 正確做法：**
\`\`\`
TASK-001: 建立 Laravel 12 專案 [ ]
   → 執行: composer create-project laravel/laravel .
   → 等待完成
   → 標記為 [x]
   
TASK-002: 建立 User 模型和遷移 [ ]
   → 現在才能在 Laravel 專案中建立檔案
\`\`\`

---

### 📋 TASK EXECUTION FLOW

\`\`\`
1. Read tasks.md           → 確認第一個 [ ] 任務
2. Check requirements.md   → 確認需要的技術堆疊
3. Check dependencies      → 確認所有前置任務已完成 [x]
4. Execute ONLY that task  → 一次只做一個任務
5. Verify acceptance       → 所有驗收標準必須通過
6. Update status to [x]    → 在 tasks.md 中標記完成
7. Move to next task       → 重複步驟 1
\`\`\`

---

### ⚠️ DEPENDENCY ENFORCEMENT

**執行任何任務之前，問問自己：**
- 這個任務需要專案結構嗎？ → 專案已經建立了嗎？
- 這個任務要建立遷移檔？ → Framework 存在嗎？
- 這個任務要修改檔案？ → 那些檔案存在嗎？

### Task Status in tasks.md:
- \`[ ]\` = pending (待執行)
- \`[/]\` = in progress (執行中)
- \`[x]\` = completed (已完成)

**Each task will go through the Sentinel Pipeline:**
Architect → Designer → Builder → QA → Security → Final Review
`
			)

		default:
			return header
	}
}

/**
 * Get complete Spec Mode context for prompt injection
 */
export function getSpecModeContext(workspacePath: string): SpecModeContext {
	const filesStatus = checkSpecFilesStatus(workspacePath)
	const currentPhase = determineCurrentPhase(filesStatus)
	const dynamicPrompt = generateSpecModePrompt(filesStatus)

	return {
		currentPhase,
		filesStatus,
		dynamicPrompt,
	}
}
