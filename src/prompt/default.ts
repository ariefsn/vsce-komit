export type BodyStyle = 'bullets' | 'prose' | 'none';
export type ScopeSource = 'auto' | 'ticket' | 'path' | 'none';

export interface Limits {
	bodyBullets: number[];
	prSummaryBullets: number[];
	prChangesBullets: number[];
	bulletChars: number;
	subjectChars: number;
}

export interface StyleOptions {
	conventionalCommits: boolean;
	commitTypes: string[];
	bodyStyle: BodyStyle;
	scopeSource: ScopeSource;
	limits: Limits;
	/** Extracted from the branch name; undefined when there is none. */
	ticket?: string;
}

/** Turns [2, 4] into "2-4", and [3] or [3, 3] into "3". */
export function range(value: number[]): string {
	const [min, max] = value;
	return max === undefined || max === min ? String(min) : `${min}-${max}`;
}

/** "2-4 bullets", or "1 bullet" when the range is exactly one. */
export function bullets(value: number[]): string {
	const text = range(value);
	return `${text} ${text === '1' ? 'bullet' : 'bullets'}`;
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

	const { subjectChars, bulletChars } = options.limits;

	if (options.conventionalCommits) {
		lines.push(`- Subject: \`type(scope): summary\`, where type is one of ${options.commitTypes.join(', ')}.`);
		lines.push(scopeRule(options));
		lines.push(`- Summary: imperative mood, lower case, whole subject under ${subjectChars} characters, no trailing period.`);
	} else {
		lines.push(
			'- Match the subject style of the recent commits shown. Do not impose Conventional Commits if the repository does not already use them.',
			`- Subject: imperative mood, under ${subjectChars} characters, no trailing period.`,
		);
	}

	switch (options.bodyStyle) {
		case 'bullets':
			lines.push(`- Then a blank line, then ${bullets(options.limits.bodyBullets)} starting with "- ", saying what changed and why. One bullet per line: aim for under ${bulletChars} characters, and if a bullet does not fit, shorten it rather than wrapping it onto a second line.`);
			break;
		case 'prose':
			lines.push('- Then a blank line, then one short paragraph explaining what changed and why. Write it as a single line; do not hard-wrap it.');
			break;
		case 'none':
			lines.push('- Output the subject line only. No body.');
			break;
	}

	lines.push('- Output exactly one commit message and nothing else. No preamble, no commentary about these rules, no second or alternative version, no code fences, no quotes.');
	return lines.join('\n');
}

export function buildDefaultPrompt(options: StyleOptions): string {
	// With an enforced format, recent commits teach vocabulary rather than shape.
	const recentHeading = options.conventionalCommits
		? 'Recent commits, for tone, vocabulary and scope names rather than format:'
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
