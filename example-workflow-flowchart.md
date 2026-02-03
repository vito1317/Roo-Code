# Roo Code 完整工作流程範例

> 範例：「幫我建立一個登入頁面」
> 從 Spec Mode 開始到完成的每個步驟詳解

---

## 🎯 使用者輸入

```
/spec 幫我建立一個登入頁面，需要帳號密碼登入和 Google OAuth
```

---

## 📋 Phase 1: Requirements（需求收集）

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant SP as SpecMode
    participant CP as ContextProvider
    participant FS as .specs/

    Note over U,FS: Step 1 - 使用者輸入 /spec 命令
    U->>SP: /spec 幫我建立一個登入頁面

    Note over U,FS: Step 2 - 檢查 Spec 檔案狀態
    SP->>CP: checkSpecFilesStatus()
    CP->>FS: 檢查 .specs/ 目錄是否存在
    FS-->>CP: 目錄不存在
    CP->>FS: 建立 .specs/ 目錄

    Note over U,FS: Step 3 - 判斷當前階段
    CP->>CP: determineCurrentPhase()
    Note right of CP: requirements.md 不存在<br/>=> Phase = requirements
    CP-->>SP: 注入 Phase 1 Prompt

    Note over U,FS: Step 4 - 分析使用者需求
    SP->>SP: 分析輸入內容
    Note right of SP: 識別關鍵功能:<br/>1. 帳號密碼登入<br/>2. Google OAuth<br/>3. 登入頁面 UI

    Note over U,FS: Step 5 - 建立 requirements.md
    SP->>FS: write_to_file .specs/requirements.md
    Note right of FS: 內容包含:<br/>- 概述<br/>- 功能需求<br/>- 非功能需求<br/>- 驗收標準<br/>(至少 800 字)
    FS-->>SP: 檔案建立成功

    Note over U,FS: Step 6 - 觸發下一階段
    SP->>SP: handleSpecFileCreated
    SP->>U: 是否繼續 Design 階段
    U-->>SP: 繼續
```

### 📄 產出檔案：`.specs/requirements.md`

```markdown
# 登入頁面需求規格

## 1. 概述

建立一個現代化的登入頁面，支援傳統帳號密碼登入及 Google OAuth 社交登入...

## 2. 功能需求

### 2.1 帳號密碼登入

- 使用者可輸入 Email 和密碼
- 密碼欄位需有顯示/隱藏切換
- 提供「記住我」選項
- 提供「忘記密碼」連結

### 2.2 Google OAuth 登入

- 一鍵 Google 登入按鈕
- 自動取得 Google 用戶資料
- 首次登入自動建立帳號

## 3. 非功能需求

- 響應式設計（支援手機、平板、桌機）
- 頁面載入時間 < 2 秒
- 支援 HTTPS
- 符合 WCAG 2.1 無障礙標準

## 4. 驗收標準

- [ ] 可成功以帳號密碼登入
- [ ] 可成功以 Google OAuth 登入
- [ ] 錯誤訊息正確顯示
- [ ] 響應式設計正常運作
```

---

## 🎨 Phase 2: Design（系統設計）

```mermaid
sequenceDiagram
    autonumber
    participant SP as SpecMode
    participant CP as ContextProvider
    participant FS as .specs/
    participant U as User

    Note over SP,U: Step 7 - 進入 Design 階段
    SP->>CP: checkSpecFilesStatus()
    CP-->>SP: requirementsExists=true designExists=false
    CP->>CP: determineCurrentPhase() => design
    CP-->>SP: 注入 Phase 2 Prompt

    Note over SP,U: Step 8 - 讀取需求文件
    SP->>FS: read_file requirements.md
    FS-->>SP: 需求內容

    Note over SP,U: Step 9 - 建立設計文件
    SP->>SP: 根據需求設計系統架構
    SP->>FS: write_to_file .specs/design.md
    Note right of FS: 內容包含:<br/>1. 系統架構圖<br/>2. 資料庫 ER 圖<br/>3. API 設計<br/>4. UI 結構圖
    FS-->>SP: 檔案建立成功

    Note over SP,U: Step 10 - 觸發下一階段
    SP->>SP: handleSpecFileCreated
    SP->>U: 是否繼續 Tasks 階段
    U-->>SP: 繼續
```

### 📄 產出檔案：`.specs/design.md`

```markdown
# 登入頁面系統設計

## 1. 系統架構

graph TB
Client[Login Page] --> API[API Gateway]
API --> Auth[Auth Service]
Auth --> DB[(PostgreSQL)]
Auth --> Google[Google OAuth]

## 2. 資料庫設計

| 欄位          | 型態         | 說明      |
| ------------- | ------------ | --------- |
| id            | BIGINT       | 主鍵      |
| email         | VARCHAR(255) | 信箱      |
| password_hash | VARCHAR(255) | 密碼雜湊  |
| google_id     | VARCHAR(255) | Google ID |
| created_at    | TIMESTAMP    | 建立時間  |

## 3. API 設計

| Method | Endpoint         | 說明         |
| ------ | ---------------- | ------------ |
| POST   | /api/auth/login  | 帳號密碼登入 |
| POST   | /api/auth/google | Google OAuth |
| GET    | /api/auth/me     | 取得當前用戶 |

## 4. UI 結構

- 登入表單區塊
  - Email 輸入框
  - 密碼輸入框
  - 記住我勾選框
  - 登入按鈕
- 社交登入區塊
  - Google 登入按鈕
- 輔助連結區塊
  - 忘記密碼
  - 註冊帳號
```

---

## ✅ Phase 3: Tasks（任務拆解）

```mermaid
sequenceDiagram
    autonumber
    participant SP as SpecMode
    participant CP as ContextProvider
    participant FS as .specs/
    participant U as User

    Note over SP,U: Step 11 - 進入 Tasks 階段
    SP->>CP: checkSpecFilesStatus()
    CP-->>SP: tasksExists=false
    CP->>CP: determineCurrentPhase() => tasks

    Note over SP,U: Step 12 - 讀取需求和設計文件
    SP->>FS: read_file requirements.md
    SP->>FS: read_file design.md
    FS-->>SP: 文件內容

    Note over SP,U: Step 13 - 拆解任務
    SP->>SP: 根據設計拆解可執行任務
    SP->>FS: write_to_file .specs/tasks.md
    Note right of FS: 每個任務包含:<br/>- 任務 ID<br/>- 描述<br/>- 涉及檔案<br/>- 驗收標準<br/>- 依賴關係
    FS-->>SP: 檔案建立成功

    Note over SP,U: Step 14 - 完成 Spec Mode
    SP->>U: Spec 完成 可從 Panel 執行任務
```

### 📄 產出檔案：`.specs/tasks.md`

```markdown
# 登入頁面任務清單

## TASK-001: 建立專案架構 (low)

**描述:** 初始化 Vue 3 + Vite 專案
**涉及檔案:** package.json, vite.config.ts, tsconfig.json
**驗收標準:**

- [ ] npm run dev 可正常執行
- [ ] TypeScript 設定正確
      **依賴:** 無

## TASK-002: 建立資料庫結構 (medium)

**描述:** 建立 users 資料表和 migrations
**涉及檔案:** migrations/create_users_table.ts
**驗收標準:**

- [ ] Migration 可正常執行
- [ ] 資料表結構符合設計
      **依賴:** TASK-001

## TASK-003: 實作 Auth API (high)

**描述:** 實作登入和 Google OAuth API
**涉及檔案:** src/api/auth.ts, src/controllers/AuthController.ts
**驗收標準:**

- [ ] POST /api/auth/login 可正常運作
- [ ] POST /api/auth/google 可正常運作
      **依賴:** TASK-002

## TASK-004: 設計登入頁面 UI (medium)

**描述:** 使用 UIDesignCanvas 設計登入頁面
**涉及檔案:** Figma/UIDesignCanvas 設計稿
**驗收標準:**

- [ ] UI 設計符合需求
- [ ] 可匯出 HTML/React 程式碼
      **依賴:** 無

## TASK-005: 實作登入頁面前端 (high)

**描述:** 根據設計稿實作 Vue 元件
**涉及檔案:** src/pages/Login.vue, src/components/GoogleLoginButton.vue
**驗收標準:**

- [ ] UI 符合設計稿
- [ ] 表單驗證正常
      **依賴:** TASK-003, TASK-004
```

---

## 🚀 Phase 4: Execution（執行任務）

### Step 15-16: 選擇並啟動任務

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant WF as WorkflowManager
    participant SM as StateMachine

    Note over U,SM: Step 15 - 使用者選擇任務
    U->>WF: 點擊 Start TASK-004

    Note over U,SM: Step 16 - 初始化 Sentinel 工作流
    WF->>WF: startIndividualTask TASK-004
    WF->>SM: setMode sentinel-architect
    WF->>SM: createTask with taskPrompt
    SM->>SM: setState ARCHITECT
```

---

## 🟦 Architect Phase（含設計判斷邏輯）

```mermaid
sequenceDiagram
    autonumber
    participant SM as StateMachine
    participant AR as Architect
    participant FS as FileSystem
    participant MCP as McpHub

    Note over SM,MCP: Step 17 - Architect 分析任務
    SM->>AR: 啟動 Architect Agent
    AR->>FS: read_file .specs/design.md
    FS-->>AR: 設計文件內容
    AR->>FS: read_file .specs/tasks.md
    FS-->>AR: 任務內容 TASK-004 設計登入頁面 UI

    Note over SM,MCP: Step 18 - 建立執行計畫
    AR->>AR: 分析 TASK-004 需求
    AR->>FS: write_to_file plan.md
    Note right of FS: 計畫內容:<br/>1. 開啟 UIDesignCanvas<br/>2. 建立登入表單 Frame<br/>3. 添加 UI 元素<br/>4. 匯出程式碼

    Note over SM,MCP: Step 19 - 判斷是否需要設計 needsDesign
    AR->>AR: 偵測關鍵字
    Note right of AR: 關鍵字偵測:<br/>UI/介面/設計/頁面/按鈕<br/>login/form/button/layout<br/>=> 符合 UI 任務

    alt 發現 UI 關鍵字
        AR->>AR: needsDesign = true
        
        Note over SM,MCP: Step 20 - 檢查設計工具可用性
        AR->>MCP: checkMcpConnectionStatus
        MCP-->>AR: connections list
        
        alt UIDesignCanvas 已連線
            AR->>AR: designPlatform = UIDesignCanvas
            Note right of AR: 優先使用內建工具<br/>port 4420 SSE
        else Figma 已連線
            AR->>AR: designPlatform = Figma
            Note right of AR: 使用外部 Figma<br/>port 3055 WebSocket
        else 無設計工具
            AR->>AR: designPlatform = none
            Note right of AR: 跳過設計階段<br/>直接進入 Builder
        end
        
        AR->>SM: handoff needsDesign=true platform=UIDesignCanvas
        SM->>SM: setState DESIGNER
    else 無 UI 關鍵字
        AR->>AR: needsDesign = false
        Note right of AR: 純後端/API 任務<br/>無需設計
        AR->>SM: handoff needsDesign=false
        SM->>SM: setState BUILDER
    end
```

---

## 🎨 Designer Phase（使用 UIDesignCanvas）

```mermaid
sequenceDiagram
    autonumber
    participant SM as StateMachine
    participant DE as Designer
    participant MCP as McpHub
    participant UDC as UIDesignCanvas
    participant WV as Webview

    Note over SM,WV: Step 20 - 啟動 Designer
    SM->>DE: 啟動 Designer Agent
    DE->>MCP: 檢查 UIDesignCanvas 連線
    MCP-->>DE: 已連線 port 4420

    Note over SM,WV: Step 21 - 建立新設計
    DE->>MCP: use_mcp_tool UIDesignCanvas new_design
    MCP->>UDC: POST tool new_design name=LoginPage
    UDC->>WV: 開啟設計畫布
    UDC-->>MCP: designId=login-page-001
    MCP-->>DE: 設計建立成功

    Note over SM,WV: Step 22 - 建立登入表單 Frame
    DE->>MCP: use_mcp_tool UIDesignCanvas create_frame
    MCP->>UDC: POST create_frame x=0 y=0 w=400 h=500
    UDC->>WV: 渲染 Frame
    UDC-->>MCP: frameId=frame_login

    Note over SM,WV: Step 23 - 添加標題文字
    DE->>MCP: use_mcp_tool UIDesignCanvas create_text
    MCP->>UDC: POST create_text content=登入 fontSize=32
    UDC->>WV: 渲染文字
    UDC-->>MCP: textId=title_001

    Note over SM,WV: Step 24 - 建立 Email 輸入框
    DE->>MCP: use_mcp_tool UIDesignCanvas create_rectangle
    MCP->>UDC: POST create_rectangle w=320 h=48 radius=8
    UDC-->>MCP: rectId=input_email

    Note over SM,WV: Step 25 - 建立密碼輸入框
    DE->>MCP: use_mcp_tool UIDesignCanvas create_rectangle
    MCP->>UDC: POST create_rectangle w=320 h=48 radius=8
    UDC-->>MCP: rectId=input_password

    Note over SM,WV: Step 26 - 建立登入按鈕
    DE->>MCP: use_mcp_tool UIDesignCanvas create_rectangle
    MCP->>UDC: POST create_rectangle w=320 h=48
    DE->>MCP: use_mcp_tool UIDesignCanvas set_style
    MCP->>UDC: POST set_style fill=3B82F6 radius=8
    UDC-->>MCP: 樣式已套用

    Note over SM,WV: Step 27 - 建立 Google 登入按鈕
    DE->>MCP: use_mcp_tool UIDesignCanvas create_rectangle
    MCP->>UDC: POST create_rectangle w=320 h=48
    DE->>MCP: use_mcp_tool UIDesignCanvas set_style
    MCP->>UDC: POST set_style fill=FFFFFF stroke=E5E7EB

    Note over SM,WV: Step 28 - 匯出設計
    DE->>MCP: use_mcp_tool UIDesignCanvas export_html
    MCP->>UDC: POST export_html
    UDC->>UDC: generateHTML
    UDC-->>MCP: html=完整 HTML 程式碼

    DE->>MCP: use_mcp_tool UIDesignCanvas export_react
    MCP->>UDC: POST export_react
    UDC->>UDC: generateReact
    UDC-->>MCP: component=React 元件程式碼

    Note over SM,WV: Step 29 - 交接給 Builder
    DE->>SM: handoff designSpecs 包含匯出程式碼
    SM->>SM: setState BUILDER
```

---

## 🟩 Builder Phase

```mermaid
sequenceDiagram
    autonumber
    participant SM as StateMachine
    participant BL as Builder
    participant FS as FileSystem
    participant TM as Terminal

    Note over SM,TM: Step 30 - 啟動 Builder
    SM->>BL: 啟動 Builder Agent
    BL->>FS: read_file plan.md
    BL->>BL: 讀取 designSpecs

    Note over SM,TM: Step 31 - 建立 Vue 元件
    BL->>FS: write_to_file src/pages/Login.vue
    Note right of FS: 根據匯出的 React/HTML<br/>轉換為 Vue 元件

    Note over SM,TM: Step 32 - 執行測試
    BL->>TM: execute_command npm run test
    TM-->>BL: Tests passed

    Note over SM,TM: Step 33 - 交接給 QA
    BL->>SM: handoff builderTestContext
    SM->>SM: setState QA
```

---

## 🟨 QA Phase

```mermaid
sequenceDiagram
    autonumber
    participant SM as StateMachine
    participant QA as QA
    participant BR as Browser

    Note over SM,BR: Step 34 - 啟動 QA
    SM->>QA: 啟動 QA Agent

    Note over SM,BR: Step 35 - 開啟瀏覽器測試
    QA->>BR: browser_action launch http://localhost:3000/login
    BR-->>QA: 頁面載入完成

    Note over SM,BR: Step 36 - 截圖驗證
    QA->>BR: browser_action screenshot
    BR-->>QA: screenshot.png
    QA->>QA: 比對設計稿

    Note over SM,BR: Step 37 - 互動測試
    QA->>BR: browser_action type email test@example.com
    QA->>BR: browser_action type password ******
    QA->>BR: browser_action click 登入按鈕
    BR-->>QA: 登入成功

    Note over SM,BR: Step 38 - 交接給 Sentinel
    QA->>SM: handoff qaAuditContext
    SM->>SM: setState SENTINEL
```

---

## 🟥 Sentinel Phase

```mermaid
sequenceDiagram
    autonumber
    participant SM as StateMachine
    participant SE as Sentinel
    participant FS as FileSystem

    Note over SM,FS: Step 39 - 啟動 Sentinel
    SM->>SE: 啟動 Sentinel Agent

    Note over SM,FS: Step 40 - SAST 靜態分析
    SE->>FS: 掃描 src/pages/Login.vue
    SE->>SE: 檢查 XSS 漏洞
    SE->>SE: 檢查 CSRF 保護
    SE->>SE: 檢查密碼處理

    Note over SM,FS: Step 41 - DAST 動態測試
    SE->>SE: 模擬 SQL Injection
    SE->>SE: 模擬 XSS 攻擊
    SE->>SE: 檢查 HTTPS

    Note over SM,FS: Step 42 - 產出報告
    SE->>FS: write_to_file security-report.md
    SE->>SM: handoff sentinelResult pass
    SM->>SM: setState COMPLETED
```

---

## ✅ 完成並更新 Spec

```mermaid
sequenceDiagram
    autonumber
    participant SM as StateMachine
    participant WF as WorkflowManager
    participant FS as .specs/
    participant U as User

    Note over SM,U: Step 43 - 任務完成
    SM->>WF: 通知任務完成

    Note over SM,U: Step 44 - 更新 tasks.md
    WF->>FS: update tasks.md
    Note right of FS: TASK-004 狀態:<br/>[ ] => [x]

    Note over SM,U: Step 45 - 詢問下一步
    WF->>U: TASK-004 完成 繼續執行 TASK-005

    Note over SM,U: Step 46 - 繼續或結束
    alt 還有任務
        U-->>WF: 繼續執行下一個
        WF->>SM: 啟動 TASK-005
    else 全部完成
        U-->>WF: 結束
        WF->>U: 所有任務已完成
    end
```

---

## 📊 流程總覽

| Phase        | Steps | 主要產出               |
| ------------ | ----- | ---------------------- |
| Requirements | 1-6   | .specs/requirements.md |
| Design       | 7-10  | .specs/design.md       |
| Tasks        | 11-14 | .specs/tasks.md        |
| Execution    | 15-16 | 啟動 Sentinel 工作流   |
| Architect    | 17-19 | plan.md                |
| Designer     | 20-29 | UI 設計 + 匯出程式碼   |
| Builder      | 30-33 | 程式碼實作             |
| QA           | 34-38 | 測試報告               |
| Sentinel     | 39-42 | 安全報告               |
| Complete     | 43-46 | 更新 tasks.md          |

**總步驟數：46 步**
