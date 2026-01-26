import { getAllModesWithPrompts } from "../../../shared/modes";
import { ensureSettingsDirectoryExists } from "../../../utils/globalContext";
export async function getModesSection(context, skipXmlExamples = false) {
    // Make sure path gets created
    await ensureSettingsDirectoryExists(context);
    // Get all modes with their overrides from extension state
    const allModes = await getAllModesWithPrompts(context);
    let modesContent = `====

MODES

- These are the currently available modes:
${allModes
        .map((mode) => {
        let description;
        if (mode.whenToUse && mode.whenToUse.trim() !== "") {
            // Use whenToUse as the primary description, indenting subsequent lines for readability
            description = mode.whenToUse.replace(/\n/g, "\n    ");
        }
        else {
            // Fallback to the first sentence of roleDefinition if whenToUse is not available
            description = mode.roleDefinition.split(".")[0];
        }
        return `  * "${mode.name}" mode (${mode.slug}) - ${description}`;
    })
        .join("\n")}`;
    if (!skipXmlExamples) {
        modesContent += `
If the user asks you to create or edit a new mode for this project, you should read the instructions by using the fetch_instructions tool, like this:
<fetch_instructions>
<task>create_mode</task>
</fetch_instructions>
`;
    }
    else {
        modesContent += `
If the user asks you to create or edit a new mode for this project, you should read the instructions by using the fetch_instructions tool.
`;
    }
    return modesContent;
}
//# sourceMappingURL=modes.js.map