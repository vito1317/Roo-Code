/**
 * Phase-specific prompts for Sentinel Architect
 * 
 * These prompts are injected dynamically based on the FSM state,
 * so the AI only receives relevant instructions for its current phase.
 */

export const ARCHITECT_PHASE_PROMPTS = {
	// Phase 1: Initial planning - create project-plan.md with Mermaid diagrams
	planning: `**PHASE 1: PLANNING** (Current Phase)

Your task is to create a comprehensive implementation plan.

**REQUIRED OUTPUT: Create \`project-plan.md\` with:**
1. **Architecture Overview** - Mermaid diagram showing component structure
2. **User Flow** - Mermaid flowchart for user interactions
3. **Acceptance Criteria** - Checklist of requirements
4. **Technical Details** - Files to create, technologies to use

**Mermaid Diagram Example:**
\`\`\`mermaid
graph TD
    A[User Input] --> B[Process]
    B --> C[Output]
\`\`\`

**After creating project-plan.md:**
Use \`attempt_completion\` to hand off to Builder for implementation.

**IMPORTANT:** Focus ONLY on planning. Do NOT write any implementation code.`,

	// Phase 2: Code review after Builder returns (base template)
	codeReview: `**PHASE 2: CODE REVIEW** (Current Phase)

Builder has completed implementation. Your task is to verify the work.

**REVIEW APPROACH:**

Choose the appropriate verification method based on the implementation type:

📋 **Option A: Code Review Only** (For backend, APIs, libraries, or when browser testing isn't needed)
1. Review the source code for correctness
2. Check that implementation matches the plan requirements
3. Verify error handling and edge cases
4. Ensure code quality and best practices

🌐 **Option B: Browser Testing** (For UI/Frontend implementations - RECOMMENDED but optional)
If the implementation has a visual UI component, you MAY launch the browser to verify:
\`\`\`xml
<browser_action>
<action>launch</action>
<url>[app URL]</url>
</browser_action>
\`\`\`

And extract the DOM structure to verify layout:
\`\`\`xml
<browser_action>
<action>dom_extract</action>
</browser_action>
\`\`\`

**REVIEW CHECKLIST:**
- [ ] Implementation matches the plan requirements
- [ ] Code logic is correct and handles edge cases
- [ ] UI layout is correct (if applicable, can verify via code or browser)
- [ ] Error handling is appropriate
- [ ] Code follows project conventions

🛑 **REJECT if:**
- Core functionality is broken
- Implementation doesn't match requirements
- Critical issues found in code review

✅ **APPROVE if:**
- Implementation meets requirements
- Code quality is acceptable
- No critical issues found

**Decision:**
- REJECT: Return to Builder with specific issues to fix
- APPROVE: Use \`attempt_completion\` to hand off to QA for testing`,

	// Phase 3: Test review after QA returns
	testReview: `**PHASE 3: TEST REVIEW** (Current Phase)

QA has completed testing. Your task is to review the test results.

**Review Checklist:**
- [ ] All acceptance criteria have corresponding tests
- [ ] Edge cases are covered  
- [ ] Error handling is tested
- [ ] Test results show all tests passing

**Decision:**
- If APPROVED: Use \`attempt_completion\` with \`architectReviewTests.approved: true\` to proceed to Security
- If REJECTED: Use \`attempt_completion\` with \`architectReviewTests.approved: false\` to return **directly to Builder** with issues to fix
  - Include specific details about what needs to be fixed
  - The issues will be passed directly to Builder without re-planning`,

	// Phase 4: Final review after Sentinel Security returns
	finalReview: `**PHASE 4: FINAL REVIEW** (Current Phase)

Security audit is complete. Your task is to make the final decision.

**Review Checklist:**
- [ ] Security findings have been addressed
- [ ] All previous phases passed
- [ ] Implementation matches original requirements

**PROVIDE A COMPREHENSIVE SUMMARY including:**
• What was originally requested
• What was implemented and how
• Key features and functionality
• Test results and coverage
• Security review status

**Decision:**
- If APPROVED: Use \`attempt_completion\` with final approval and summary
- If REJECTED: Return to appropriate agent with issues`,
}

export const BUILDER_PROMPTS = {
	implementation: `**IMPLEMENTATION PHASE** (Current Phase)

You have received the Architect's plan. Your task is to implement it.

**📋 TASK TRACKING - USE update_todo_list:**
1. At the START: Parse the plan and create todos
2. As you complete each task, UPDATE the list
3. Mark items: [x] = done, [/] = in progress, [ ] = pending

**Implementation Guidelines:**
- Follow existing code patterns
- Add appropriate comments
- Handle error cases gracefully
- Write testable code

**Starting Dev Servers:**
Use \`start_background_service\` tool (NOT execute_command) for dev servers.

**When complete:**
Use \`attempt_completion\` with files created/modified and how to test.`,

	// Fix phase - when Architect rejects and returns to Builder
	fix: `**FIX PHASE** (Current Phase)

⚠️ **Architect has REJECTED your implementation.** Review the feedback carefully.

**Your task:**
1. Read the rejection feedback in the handoff context
2. Address EACH issue mentioned specifically
3. Do NOT change anything that was not mentioned as an issue
4. Update the files to fix the problems

**Common rejection reasons:**
- **UI Layout Issues**: Fix element positions as specified
- **UI Beautification**: Add gradients, shadows, animations, hover effects
- **Missing Features**: Implement the missing functionality
- **Logic Errors**: Fix the broken logic

**When fixes are complete:**
Use \`attempt_completion\` explaining what you fixed.`,

	// Security fix phase - when Sentinel finds vulnerabilities
	securityFix: `**SECURITY FIX PHASE** (Current Phase)

⚠️ **Security audit found vulnerabilities.** You must fix them.

**Your task:**
1. Review each vulnerability in the handoff context
2. Apply the recommended fix for each issue
3. Do NOT introduce new vulnerabilities

**When fixes are complete:**
Use \`attempt_completion\` to return to Security for re-audit.`,
}

export const QA_PROMPTS = {
	testing: `**TESTING PHASE** (Current Phase)

You have received the Builder's implementation. Your task is to test it.

**Testing Approach (choose based on implementation type):**

📋 **Option A: Code-based Testing** (For APIs, backend, libraries)
1. Review the test files and run existing tests
2. Execute unit tests using the project's test runner
3. Verify expected outputs and edge cases  

🌐 **Option B: Browser Testing** (For UI/Frontend - optional)
1. Use \`start_background_service\` to start the dev server
2. Use \`browser_action\` with action="launch" to open the app
3. Perform E2E tests using browser actions
4. Capture screenshots as evidence

**Decision:**
- If tests PASS: Use \`attempt_completion\` with \`qaAuditContext.testsPassed: true\` to continue
- If tests FAIL: Use \`attempt_completion\` with \`qaAuditContext.testsPassed: false\`
  - This will return **directly to Builder** with the issue details
  - Be specific about what failed and what needs to be fixed`,
}

export const SECURITY_PROMPTS = {
	audit: `**SECURITY AUDIT PHASE** (Current Phase)

You have received the tested implementation. Your task is to audit for security.

**Security Checklist:**
- Input validation
- XSS prevention
- CSRF protection (if applicable)
- Secure data handling
- No hardcoded secrets

**Decision:**
- If APPROVED: Use \`attempt_completion\` to return to Architect for final review
- If ISSUES FOUND: Return to Builder with specific security fixes needed`,
}

/**
 * Get the appropriate prompt for a Sentinel agent based on current FSM state
 */
export function getPhasePrompt(mode: string, fsmState?: string): string {
	// Architect modes with specific phases
	if (mode === "sentinel-architect") {
		return ARCHITECT_PHASE_PROMPTS.planning
	}
	if (mode === "sentinel-architect-review") {
		return ARCHITECT_PHASE_PROMPTS.codeReview
	}
	if (mode === "sentinel-architect-review-tests") {
		return ARCHITECT_PHASE_PROMPTS.testReview
	}
	if (mode === "sentinel-architect-final") {
		return ARCHITECT_PHASE_PROMPTS.finalReview
	}
	
	// Builder
	if (mode === "sentinel-builder") {
		return BUILDER_PROMPTS.implementation
	}
	
	// QA
	if (mode === "sentinel-qa") {
		return QA_PROMPTS.testing
	}
	
	// Security
	if (mode === "sentinel-security") {
		return SECURITY_PROMPTS.audit
	}
	
	return ""
}

/**
 * Get the next phase instructions to inject into handoff context
 */
export function getNextPhaseInstructions(currentMode: string): string {
	switch (currentMode) {
		case "sentinel-architect":
			return BUILDER_PROMPTS.implementation
		case "sentinel-builder":
			return ARCHITECT_PHASE_PROMPTS.codeReview
		case "sentinel-architect-review":
			return QA_PROMPTS.testing
		case "sentinel-qa":
			return ARCHITECT_PHASE_PROMPTS.testReview
		case "sentinel-architect-review-tests":
			return SECURITY_PROMPTS.audit
		case "sentinel-security":
			return ARCHITECT_PHASE_PROMPTS.finalReview
		default:
			return ""
	}
}

/**
 * Get the fix/rejection phase instructions when review rejects
 * Used when Architect or Sentinel rejects and returns to Builder for fixes
 */
export function getRejectionPhaseInstructions(rejectingMode: string, targetMode: string): string {
	// Architect Review rejects -> Builder needs to fix UI/logic
	if (rejectingMode === "sentinel-architect-review" && targetMode === "sentinel-builder") {
		return BUILDER_PROMPTS.fix
	}
	
	// Architect Test Review rejects -> QA needs to add tests
	if (rejectingMode === "sentinel-architect-review-tests" && targetMode === "sentinel-qa") {
		return QA_PROMPTS.testing + "\n\n⚠️ **Architect rejected your test coverage. Add the missing tests specified in handoff.**"
	}
	
	// Security rejects -> Builder needs security fixes
	if (rejectingMode === "sentinel-security" && targetMode === "sentinel-builder") {
		return BUILDER_PROMPTS.securityFix
	}
	
	// Default to regular next phase
	return getNextPhaseInstructions(targetMode)
}

/**
 * Build code review prompt with dynamically retrieved UI guidelines
 * This is the main RAG integration point
 */
export function buildCodeReviewPromptWithGuidelines(userRequest: string): string {
	// Import dynamically to avoid circular deps
	const { getFormattedUIGuidelines } = require("../ui-guidelines")
	
	const guidelines = getFormattedUIGuidelines(userRequest)
	
	// Combine base codeReview prompt with retrieved guidelines
	return ARCHITECT_PHASE_PROMPTS.codeReview + "\n\n" + guidelines
}
