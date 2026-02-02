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

## ⚠️ 重要規則 - DO NOT DELEGATE!

**你正在 Spec Mode 中工作。你必須親自處理所有工作！**

- ❌ **禁止使用 \`new_task\` 工具** 建立子任務或委派給其他模式
- ❌ **禁止切換到 Architect / Code / Designer 模式** 來處理 spec 檔案
- ✅ **你必須親自建立** \`.specs/requirements.md\`、\`.specs/design.md\`、\`.specs/tasks.md\`
- ✅ **使用 \`write_to_file\` 工具** 直接建立這些檔案

**原因**：Spec Mode 的目的是收集需求、設計架構、分解任務。這些都是你在 Spec Mode 中的職責，不應交給其他 agent。

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

---

### 🔴 第一步：讀取使用者提供的檔案！

**如果使用者有提供任何檔案**（.pdf, .docx, .txt, .md 等），**必須先使用 \`read_file\` 讀取！**

\`\`\`
# 範例：讀取使用者提供的檔案
read_file("需求功能規格書-模具管理.pdf")
read_file("user_requirements.docx")
\`\`\`

**⚠️ 這是最重要的步驟！使用者提供的檔案是需求的主要來源！**

---

### 📏 文件長度要求（必達！）

**requirements.md 必須至少 800-1500 字！**

- 少於 800 字 = 不合格，必須補充更多細節
- 每個功能需求至少 50-100 字描述
- 必須包含：背景、目標、功能、非功能需求、技術堆疊

---

### 🎯 你的任務

1. **先讀取使用者提供的檔案**（如有）
2. **與使用者討論需求** - 詢問問題以充分理解專案目標
3. **建立 \`.specs/requirements.md\`** - 至少 800-1500 字

---

## 📝 requirements.md 完整範本

以下是每個章節的詳細格式和內容指引：

### 1. 專案概述 (Project Overview)

\`\`\`markdown
# [專案名稱] 需求規格書

## 1. 專案概述

### 1.1 專案背景
[詳細說明 100-200 字：為什麼需要這個專案？目前面臨什麼問題？]

範例：
> 目前公司使用 Excel 管理客戶資料，隨著業務成長，手動管理已無法滿足需求。
> 經常發生資料遺失、版本混亂、無法同時編輯等問題。需要一個專業的 CRM 系統
> 來集中管理客戶資料、追蹤銷售機會、產生報表分析。

### 1.2 專案目標
- **主要目標**: [一句話描述核心目的]
- **次要目標**: 
  - [目標 1]
  - [目標 2]

### 1.3 目標使用者
| 角色 | 描述 | 主要使用功能 |
|------|------|--------------|
| 管理員 | IT 人員，負責系統設定 | 使用者管理、權限設定 |
| 業務人員 | 第一線銷售人員 | 客戶資料維護、商機追蹤 |
| 主管 | 部門主管 | 報表查看、績效分析 |

### 1.4 專案範圍
**包含 (In Scope):**
- [功能 1]
- [功能 2]

**不包含 (Out of Scope):**
- [排除項目 1]
- [排除項目 2]
\`\`\`

---

### 1.5 🔧 技術堆疊 (Tech Stack) - 必填！

\`\`\`markdown
## 2. 技術堆疊

### 2.1 後端框架
| 項目 | 選用技術 | 版本 | 說明 |
|------|----------|------|------|
| 框架 | Laravel / Django / Express / Spring | 12.x | 主要後端框架 |
| 語言 | PHP / Python / JavaScript / Java | 8.3 / 3.12 / 18 | 程式語言版本 |
| 資料庫 | MySQL / PostgreSQL / MongoDB | 8.0 | 資料儲存 |

### 2.2 前端框架
| 項目 | 選用技術 | 版本 | 說明 |
|------|----------|------|------|
| 框架 | Vue.js / React / Angular / Next.js | 3.5 / 18 | 前端框架 |
| UI 庫 | Tailwind CSS / Bootstrap / Ant Design | 4.0 | 樣式框架 |
| 狀態管理 | Pinia / Redux / Vuex | 2.0 | 狀態管理 |

### 2.3 開發工具
- **版本控制**: Git
- **容器化**: Docker (開發/部署)
- **CI/CD**: GitHub Actions / GitLab CI
- **測試框架**: PHPUnit / Jest / Pytest

### 2.4 部署環境
- **伺服器**: AWS / GCP / Azure / 自建
- **Web Server**: Nginx / Apache
- **快取**: Redis
\`\`\`

**⚠️ 技術堆疊必須明確指定！** 這是後續 design.md 和 tasks.md 的基礎。

---

### 2. 功能需求 (Functional Requirements)

**每個功能都要包含完整描述：**

\`\`\`markdown
## 2. 功能需求

### FR-001: 使用者登入功能

**功能描述:**
使用者可透過電子郵件和密碼登入系統。系統需支援記住登入狀態、
密碼重設功能，並實作登入失敗次數限制以防止暴力破解攻擊。

**使用者故事:**
> 作為【業務人員】，我希望【使用公司 Email 快速登入系統】，
> 以便【每天上班時能立即存取客戶資料開始工作】。

**前置條件:**
- 使用者已完成註冊
- Email 已通過驗證

**詳細流程:**
1. 使用者開啟登入頁面
2. 輸入 Email 和密碼
3. 點擊「登入」按鈕
4. 系統驗證憑證
5. 驗證成功：導向儀表板
6. 驗證失敗：顯示錯誤訊息，記錄失敗次數

**輸入欄位:**
| 欄位 | 類型 | 必填 | 驗證規則 | 說明 |
|------|------|------|----------|------|
| email | Email | 是 | 有效 Email 格式 | 使用者登入帳號 |
| password | Password | 是 | 8-50 字元 | 使用者密碼 |
| remember | Boolean | 否 | - | 記住我選項 |

**輸出/回應:**
- 成功：設定 Session/Token，導向儀表板
- 失敗：顯示「帳號或密碼錯誤」（不透露具體哪個錯）
- 鎖定：連續失敗 5 次，帳號鎖定 15 分鐘

**例外處理:**
- 帳號被停用：顯示「帳號已停用，請聯繫管理員」
- 密碼過期：導向密碼變更頁面

**驗收標準:**
- [ ] 正確帳密可成功登入並導向儀表板
- [ ] 錯誤帳密顯示統一錯誤訊息
- [ ] 連續失敗 5 次後帳號鎖定 15 分鐘
- [ ] 「記住我」功能可保持登入狀態 30 天
- [ ] 密碼重設連結有效期限為 1 小時

**優先級:** 🔴 High (核心功能)
**預估複雜度:** Medium
\`\`\`

---

### 3. 非功能需求 (Non-Functional Requirements)

\`\`\`markdown
## 3. 非功能需求

### 3.1 效能需求
| 指標 | 要求 | 備註 |
|------|------|------|
| 頁面載入時間 | < 3 秒 | 首次載入 |
| API 回應時間 | < 500ms | 95th percentile |
| 同時在線使用者 | 500+ | 正常運作 |
| 資料庫查詢 | < 100ms | 單筆查詢 |

### 3.2 安全需求
- **認證**: JWT Token + Refresh Token 機制
- **授權**: RBAC 角色權限管理
- **傳輸加密**: 全站 HTTPS (TLS 1.3)
- **密碼存儲**: bcrypt 雜湊，cost factor >= 12
- **敏感資料**: AES-256 加密
- **日誌記錄**: 記錄所有登入、資料變更操作
- **OWASP Top 10**: 防範 SQL Injection、XSS、CSRF

### 3.3 可用性需求
- **SLA**: 99.5% 正常運行時間
- **備份**: 每日自動備份，保留 30 天
- **災難復原**: RTO 4 小時，RPO 1 小時

### 3.4 相容性需求
- **瀏覽器**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **行動裝置**: iOS 14+, Android 10+ (響應式設計)
- **螢幕解析度**: 最低 1280x720
\`\`\`

---

### 4. 資料需求 (Data Requirements)

\`\`\`markdown
## 4. 資料需求

### 4.1 核心資料實體

#### Customer (客戶)
| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| id | UUID | 系統 | 主鍵 |
| name | String(100) | 是 | 客戶名稱 |
| email | String(255) | 是 | 聯絡信箱 (唯一) |
| phone | String(20) | 否 | 聯絡電話 |
| company | String(100) | 否 | 公司名稱 |
| status | Enum | 是 | active, inactive, blocked |
| created_at | Datetime | 系統 | 建立時間 |
| updated_at | Datetime | 系統 | 更新時間 |

### 4.2 資料關係
\\\`\\\`\\\`mermaid
erDiagram
    Customer ||--o{ Order : places
    Customer ||--o{ Contact : has
    Order ||--|{ OrderItem : contains
    Product ||--o{ OrderItem : included_in
\\\`\\\`\\\`

### 4.3 資料驗證規則
- Email: 必須符合 RFC 5322 格式
- 電話: 台灣手機 09 開頭，10 碼
- 金額: 正數，小數點後最多 2 位
\`\`\`

---

### 5. 整合需求 (Integration Requirements)

\`\`\`markdown
## 5. 外部系統整合

### 5.1 Email 服務
- **服務**: SendGrid / AWS SES
- **用途**: 發送系統通知、密碼重設郵件
- **API 格式**: REST JSON

### 5.2 金流服務
- **服務**: 綠界科技 ECPay
- **用途**: 線上刷卡、ATM 付款
- **回呼機制**: Webhook callback
\`\`\`

---

### 6. 使用者介面需求

\`\`\`markdown
## 6. UI/UX 需求

### 6.1 頁面清單
| 頁面 | 路由 | 說明 | 權限 |
|------|------|------|------|
| 登入頁 | /login | 使用者登入入口 | 公開 |
| 儀表板 | /dashboard | 首頁數據總覽 | 登入後 |
| 客戶列表 | /customers | 客戶資料管理 | 業務 |
| 訂單管理 | /orders | 訂單查詢與處理 | 業務 |

### 6.2 設計風格
- **整體風格**: 現代簡約企業風
- **主色調**: #3B82F6 (藍色系)
- **字型**: Noto Sans TC / Inter
- **間距**: 遵循 8px grid system
\`\`\`

---

### 🔍 技術環境偵測

**請先分析專案目錄**，使用 \`list_files\` 工具識別：
- **前端框架**: 查看 package.json (React, Vue, Angular, Next.js, Nuxt...)
- **後端框架**: 查看 composer.json (Laravel), requirements.txt (Django, Flask), pom.xml (Spring)
- **資料庫**: 查看 migrations、schema 檔案
- **其他工具**: Docker, CI/CD 配置等

將偵測到的技術堆疊記錄在文件中。

---

### ⚠️ 重要原則

1. **完整勝於簡潔**: 需求文件越詳細，後續開發越順利。不要怕文件太長！
2. **自由發揮**: 範本僅供參考，你可以根據專案特性調整格式和內容
3. **主動補充**: 根據你的專業判斷，補充使用者可能遺漏的需求
4. **技術建議**: 如果發現更好的技術方案，主動提出建議
5. **邊界條件**: 詳細說明異常情況和錯誤處理
6. **驗收標準**: 每個功能都要有可測試的驗收條件

### 🚀 開始前

1. **如果使用者有提供檔案**（如 .pdf, .docx, .txt 等），**先使用 \`read_file\` 讀取這些檔案內容**
2. **分析專案目錄結構**，了解現有技術堆疊
3. 仔細閱讀使用者提供的需求描述
4. 根據需求的複雜度，決定需要詢問哪些問題
5. 按照範本格式（可自由調整）建立完整的 requirements.md
6. 使用 \`write_to_file\` 工具建立檔案

**⚠️ 重要：**
- 使用者提供的檔案是最重要的需求來源，務必先閱讀！
- **需求文件至少 500-1000 字**，確保足夠詳細完整
- 可以使用 Mermaid 圖表來視覺化流程和關係
- 技術堆疊（Tech Stack）必須明確指定版本號
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
