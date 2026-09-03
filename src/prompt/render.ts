export interface TemplateVars {
	diff: string;
	stat: string;
	recentCommits: string;
	branch: string;
	userHint: string;
	language: string;
	styleRules: string;
	ticket: string;
	/** PR generation only; empty for commit messages. */
	commits?: string;
	base?: string;
	previousAttempt?: string;
}

const VARIABLE = /\{\{\s*(\w+)\s*\}\}/g;

export function render(template: string, vars: TemplateVars): string {
	return template.replace(VARIABLE, (match, name: string) => {
		const value = (vars as unknown as Record<string, string | undefined>)[name];
		return value === undefined ? match : value;
	});
}

export function hasVariables(template: string): boolean {
	VARIABLE.lastIndex = 0;
	return VARIABLE.test(template);
}
