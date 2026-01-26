/**
 * Sentinel Edition - Handoff Context Tool
 *
 * Allows agents to submit structured handoff context when completing
 * their phase, triggering the FSM transition to the next agent.
 */
import { formatResponse } from "../prompts/responses";
import { BaseTool } from "./BaseTool";
import { AgentState } from "../sentinel/StateMachine";
/**
 * Handoff Context Tool
 *
 * Used by agents to submit their work output and trigger transition
 * to the next agent in the workflow.
 */
export class HandoffContextTool extends BaseTool {
    name = "handoff_context";
    /**
     * Parse legacy XML parameters
     */
    parseLegacy(params) {
        return {
            notes: params.notes || "",
            // Accept multiple parameter name variants for robustness
            context_json: params.context_json || params.contextJson || params.context_data || params.contextData || "{}",
        };
    }
    /**
     * Execute the tool
     */
    async execute(params, task, callbacks) {
        const { handleError, pushToolResult } = callbacks;
        const { notes, context_json } = params;
        try {
            // Validate we have context
            if (!context_json || context_json === "{}") {
                task.consecutiveMistakeCount++;
                task.recordToolError("handoff_context");
                pushToolResult(await task.sayAndCreateMissingParamError("handoff_context", "context_json"));
                return;
            }
            // Check if Sentinel FSM is active
            const fsm = task.sentinelStateMachine;
            if (!fsm || !fsm.isActive()) {
                pushToolResult(formatResponse.toolError("Sentinel FSM is not active. Use this tool only within a Sentinel workflow."));
                return;
            }
            task.consecutiveMistakeCount = 0;
            // Parse the context JSON
            let parsedContext;
            try {
                parsedContext = JSON.parse(context_json);
            }
            catch (parseError) {
                task.recordToolError("handoff_context");
                pushToolResult(formatResponse.toolError(`Invalid JSON in context_json: ${parseError.message}`));
                return;
            }
            // Build handoff data based on current agent
            const currentState = fsm.getCurrentState();
            const handoffData = this.buildHandoffData(currentState, parsedContext, notes);
            // Show what's being submitted
            await task.say("text", `\ud83d\udd04 Submitting handoff context from ${currentState}...`);
            // Trigger FSM transition
            const result = await fsm.handleAgentCompletion(handoffData);
            if (result.success) {
                // Format context for display - show each field clearly
                let contextDisplay = "";
                const formatValue = (val, indent = 0) => {
                    const prefix = "  ".repeat(indent);
                    if (val === null || val === undefined)
                        return `${prefix}(empty)`;
                    if (Array.isArray(val)) {
                        if (val.length === 0)
                            return `${prefix}(empty list)`;
                        return val.map((v, i) => `${prefix}${i + 1}. ${typeof v === 'object' ? JSON.stringify(v) : v}`).join("\n");
                    }
                    if (typeof val === 'object') {
                        return Object.entries(val)
                            .map(([k, v]) => `${prefix}**${k}:** ${typeof v === 'object' ? '\n' + formatValue(v, indent + 1) : v}`)
                            .join("\n");
                    }
                    return `${prefix}${val}`;
                };
                try {
                    contextDisplay = Object.entries(parsedContext)
                        .map(([key, value]) => {
                        const formattedValue = typeof value === 'object'
                            ? '\n' + formatValue(value, 1)
                            : String(value);
                        return `- **${key}:** ${formattedValue}`;
                    })
                        .join("\n\n");
                }
                catch {
                    contextDisplay = JSON.stringify(parsedContext, null, 2);
                }
                pushToolResult(`✅ Handoff successful!\n\n` +
                    `- **From:** ${result.fromState}\n` +
                    `- **To:** ${result.toState}\n` +
                    `- **Notes:** ${notes || "(none)"}\n\n` +
                    `---\n\n` +
                    `## 📋 Handoff Context (AI-to-AI Message):\n\n` +
                    `${contextDisplay}\n\n` +
                    `---\n\n` +
                    `The workflow will now continue with the ${result.toState} agent.`);
                // CRITICAL: Add auto-continue message to trigger next agent
                // This tells the next agent what to do based on their role
                const continueMessage = this.buildContinueMessage(result.toState, parsedContext);
                task.userMessageContent.push({
                    type: "text",
                    text: continueMessage,
                });
            }
            else {
                if (result.toState === AgentState.BLOCKED) {
                    pushToolResult(`⚠️ Workflow blocked!\n\n` +
                        `- **Reason:** ${result.error}\n\n` +
                        `Human intervention is required to continue.`);
                }
                else {
                    pushToolResult(formatResponse.toolError(`Handoff failed: ${result.error}`));
                }
            }
        }
        catch (error) {
            await handleError("submitting handoff context", error);
        }
    }
    /**
     * Build handoff data based on current agent state
     */
    buildHandoffData(currentState, parsedContext, notes) {
        const base = {
            previousAgentNotes: notes,
        };
        // Extract figmaUrl if present in context (for Designer routing)
        if (parsedContext.figmaUrl && typeof parsedContext.figmaUrl === "string") {
            base.figmaUrl = parsedContext.figmaUrl;
        }
        // Extract designSpecs if present
        if (parsedContext.designSpecs && typeof parsedContext.designSpecs === "string") {
            base.designSpecs = parsedContext.designSpecs;
        }
        switch (currentState) {
            case AgentState.ARCHITECT:
                return {
                    ...base,
                    architectPlan: parsedContext,
                };
            case AgentState.DESIGNER:
                return {
                    ...base,
                    designSpecs: parsedContext.designSpecs || JSON.stringify(parsedContext),
                };
            case AgentState.BUILDER:
                return {
                    ...base,
                    builderTestContext: parsedContext,
                };
            case AgentState.QA_ENGINEER:
                return {
                    ...base,
                    qaAuditContext: parsedContext,
                };
            case AgentState.SENTINEL:
                return {
                    ...base,
                    sentinelResult: parsedContext,
                };
            default:
                return base;
        }
    }
    /**
     * Handle partial streaming
     */
    async handlePartial(task, block) {
        const nativeArgs = block.nativeArgs;
        const notes = nativeArgs?.notes;
        const contextJson = nativeArgs?.context_json;
        // Try to show a preview of the context
        let preview = "(parsing...)";
        if (contextJson) {
            try {
                const parsed = JSON.parse(contextJson);
                preview = `Keys: ${Object.keys(parsed).join(", ")}`;
            }
            catch {
                preview = "(streaming...)";
            }
        }
        const partialMessage = JSON.stringify({
            tool: "handoff_context",
            notes: notes || "(streaming...)",
            contextPreview: preview,
        });
        await task.ask("tool", partialMessage, block.partial).catch(() => { });
    }
    /**
     * Build a continue message for the next agent based on their role
     */
    buildContinueMessage(toState, context) {
        switch (toState) {
            case AgentState.ARCHITECT:
                return `[AUTO-CONTINUE] You are the Architect. Review the feedback and create/update the implementation plan.`;
            case AgentState.DESIGNER:
                if (context.figmaUrl) {
                    return `[AUTO-CONTINUE] You are the Designer.\n\n` +
                        `**YOUR MISSION:** Analyze the Figma design and create design-specs.md\n\n` +
                        `**STEP 0:** Launch browser to show the Figma design to the user:\n` +
                        `\`\`\`xml\n<browser_action>\n<action>launch</action>\n<url>${context.figmaUrl}</url>\n</browser_action>\n\`\`\`\n\n` +
                        `**STEP 1:** Use the BUILT-IN figma server (NO installation needed):\n` +
                        '```xml\n<use_mcp_tool>\n<server_name>figma</server_name>\n<tool_name>get_simplified_structure</tool_name>\n<arguments>{"file_key": "EXTRACT_FROM_URL"}</arguments>\n</use_mcp_tool>\n```\n\n' +
                        `Extract file_key from URL: ${context.figmaUrl}\n\n` +
                        `**STEP 2:** Create design-specs.md with colors, fonts, spacing\n\n` +
                        `**STEP 3:** ONLY THEN use handoff_context to pass to Builder\n\n` +
                        `⚠️ DO NOT handoff until design-specs.md is created!`;
                }
                else {
                    return `[AUTO-CONTINUE] You are the Designer.\n\n` +
                        `**YOUR MISSION:** Create design-specs.md for the UI\n\n` +
                        `**OPTION A:** Use generate_image (if available) to create mockup\n\n` +
                        `**OPTION B (FALLBACK):** Create text-only design-specs.md with:\n` +
                        `- ASCII layout diagram\n` +
                        `- Color palette (hex codes): e.g. primary: #FF6B00, bg: #1E1E1E\n` +
                        `- Typography: font-family, sizes, weights\n` +
                        `- Spacing: padding, margins, gaps\n` +
                        `- Component hierarchy and states\n\n` +
                        `**STEP FINAL:** Use handoff_context ONLY AFTER design-specs.md exists\n\n` +
                        `⚠️ DO NOT handoff until design-specs.md is created!`;
                }
            case AgentState.BUILDER:
                return `[AUTO-CONTINUE] You are the Builder. Implement according to the plan and design specs: ${JSON.stringify(context).slice(0, 500)}`;
            case AgentState.QA_ENGINEER: {
                // Extract targetUrl from context if available
                const targetUrl = context.targetUrl ||
                    context.runCommand?.includes('localhost') ? 'http://localhost:3000' :
                    'http://localhost:3000';
                return `[AUTO-CONTINUE] You are QA. Test the implementation.

**CRITICAL: YOU MUST OPEN THE BROWSER!**

**🚀 STEP 1: Launch the app in browser:**
\`\`\`xml
<browser_action>
<action>launch</action>
<url>${targetUrl}</url>
</browser_action>
\`\`\`

**🔍 STEP 2: Extract DOM to see actual structure:**
\`\`\`xml
<browser_action>
<action>dom_extract</action>
</browser_action>
\`\`\`

**🧪 STEP 3: Test interactions (click buttons, verify display):**
\`\`\`xml
<browser_action>
<action>click</action>
<coordinate>160,400</coordinate>
</browser_action>
\`\`\`

**📊 STEP 4: Compare DOM vs design-specs.md**
- Read design-specs.md first
- Count elements: buttons, text, layout
- Check if layout matches (grid vs column)

**⚠️ YOU CANNOT PASS WITHOUT OPENING THE BROWSER!**`;
            }
            case AgentState.ARCHITECT_REVIEW_TESTS: {
                // Inject RAG UI guidelines based on detected UI type
                const guidelines = this.getRAGGuidelinesForContext(context);
                return `[AUTO-CONTINUE] Review the work and decide: approve or reject with feedback.\n\n${guidelines}`;
            }
            case AgentState.SENTINEL:
                return `[AUTO-CONTINUE] You are Sentinel Security. Perform security audit. After audit, use handoff_context to pass to Architect Final.`;
            case AgentState.ARCHITECT_REVIEW_FINAL:
                return `[AUTO-CONTINUE] You are Architect Final Review. Create a walkthrough.md summarizing all work completed, then use attempt_completion.`;
            case AgentState.COMPLETED:
                return `[AUTO-CONTINUE] Workflow completed. Use attempt_completion to finish.`;
            default:
                return `[AUTO-CONTINUE] Continue with your assigned role.`;
        }
    }
    /**
     * Get RAG UI guidelines based on context (detects UI type from plan)
     */
    getRAGGuidelinesForContext(context) {
        try {
            // Import the RAG system dynamically
            const { getFormattedUIGuidelines } = require("../sentinel/ui-guidelines");
            // Try to detect UI type from the context (plan, description, etc.)
            const contextStr = JSON.stringify(context);
            const guidelines = getFormattedUIGuidelines(contextStr);
            if (guidelines) {
                return `## 📋 UI GUIDELINES (from RAG):\n${guidelines}`;
            }
        }
        catch (error) {
            console.error("[HandoffContext] Error loading RAG guidelines:", error);
        }
        return "";
    }
}
/**
 * Singleton tool instance
 */
export const handoffContextTool = new HandoffContextTool();
//# sourceMappingURL=HandoffContextTool.js.map