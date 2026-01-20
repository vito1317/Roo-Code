/**
 * Sentinel Edition - Handoff Context Tool Description
 *
 * Allows agents to submit structured handoff context when completing
 * their phase, triggering the FSM transition to the next agent.
 */

export const getHandoffContextDescription = (): string => {
	return `## handoff_context
Description: Submit structured handoff context to trigger workflow transition to next agent. Use this when completing your current phase in the Sentinel workflow to pass context to the next agent.
Parameters:
- context_json: (required) JSON object containing your phase output. Format depends on current agent:
  - Architect: {"plan": "...", "techStack": [...], "fileList": [...]}
  - Builder: {"filesCreated": [...], "changesDescription": "..."}
  - QA: {"testsPassed": true, "testResults": [...]}
  - Security: {"securityPassed": true, "vulnerabilities": [], "recommendation": "approve"|"reject", "summary": "..."}
- notes: (optional) Additional notes for the next agent

Usage:
<handoff_context>
<context_json>{"securityPassed": true, "vulnerabilities": [], "recommendation": "approve", "summary": "Security audit completed..."}</context_json>
<notes>All checks passed</notes>
</handoff_context>

IMPORTANT: This tool triggers the FSM to transition to the next agent in the workflow. The workflow will NOT continue unless you use this tool.`
}
