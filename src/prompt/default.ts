export type BodyStyle = 'bullets' | 'prose' | 'none';
export type ScopeSource = 'auto' | 'ticket' | 'path' | 'none';

export interface StyleOptions {
	conventionalCommits: boolean;
	commitTypes: string[];
	bodyStyle: BodyStyle;
	scopeSource: ScopeSource;
	/** Extracted from the branch name; undefined when there is none. */
	ticket?: string;
}

export const DEFAULT_COMMIT_TYPES = [
	'feat', 'fix', 'docs', 'style', 'refactor',
	'perf', 'test', 'build', 'ci', 'chore', 'revert',
];

const PATH_SCOPE = '- Include a scope when the changed files share one obvious area; omit it when the change is scattered.';
const NO_SCOPE = '- Do not include a scope. Write `type: summary`.';

/** Naming the literal token keeps the model copying rather than parsing. */
function scopeRule(options: StyleOptions): string {
	const ticket = options.ticket;

	switch (options.scopeSource) {
		case 'ticket':
			return ticket ? ticketScope(ticket) : NO_SCOPE;
		case 'path':
			return PATH_SCOPE;
		case 'none':
			return NO_SCOPE;
		default:
			return ticket ? ticketScope(ticket) : PATH_SCOPE;
	}
}

function ticketScope(ticket: string): string {
	return `- Use exactly \`${ticket}\` as the scope: \`type(${ticket}): summary\`.`;
}

/** The format rules, exposed to templates as {{styleRules}}. */
export function buildStyleRules(options: StyleOptions): string {
	const lines = ['Format:'];

	if (options.conventionalCommits) {
		lines.push(`- Subject: \`type(scope): summary\`, where type is one of ${options.commitTypes.join(', ')}.`);
		lines.push(scopeRule(options));
		lines.push('- Summary: imperative mood, lower case, whole subject under 72 characters, no trailing period.');
	} else {
		lines.push(
			'- Match the subject style of the recent commits shown. Do not impose Conventional Commits if the repository does not already use them.',
			'- Subject: imperative mood, under 72 characters, no trailing period.',
		);
	}

	switch (options.bodyStyle) {
		case 'bullets':
			lines.push('- Then a blank line, then 2-4 bullets starting with "- ", each under 80 characters, saying what changed and why.');
			break;
		case 'prose':
			lines.push('- Then a blank line, then one short paragraph explaining what changed and why.');
			break;
		case 'none':
			lines.push('- Output the subject line only. No body.');
			break;
	}

	lines.push('- Output only the commit message. No preamble, no code fences, no quotes.');
	return lines.join('\n');
}

export function buildDefaultPrompt(options: StyleOptions): string {
	// With an enforced format, recent commits teach vocabulary rather than shape.
	const recentHeading = options.conventionalCommits
		? 'Recent commits (for tone, vocabulary and scope names — not format):'
		: 'Recent commits on this branch:';

	return `Write a git commit message for the staged changes below.

{{styleRules}}
- Write in {{language}}.

${recentHeading}
{{recentCommits}}

Branch: {{branch}}

What the author already typed (treat as their intent, refine it):
{{userHint}}

Files changed:
{{stat}}

Diff:
{{diff}}
`;
}
