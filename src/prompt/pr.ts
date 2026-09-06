import * as vscode from 'vscode';
import { bullets, type Limits } from './default';

const PR_FILES = ['.komit-pr.md', '.github/pull_request_template.md'];

export function buildPrPrompt(limits: Limits): string {
	return `Write a pull request title and description for the branch below.

Format:
- First line: the title, in the same style as the commit subjects shown. No prefix like "PR:".
- Then a blank line, then exactly these two sections:

## Summary
- ${bullets(limits.prSummaryBullets)} on *why* this exists: the problem it solves or the outcome it achieves.

## Changes
- ${bullets(limits.prChangesBullets)} on *what* was done, grouped by area or concern.
- Never write one bullet per file. If the branch touches many files, describe the areas.
- Mention test work as one bullet when it is worth mentioning. Do not add a separate section for it.

- Summary states intent, Changes states what was done. Do not restate one in the other.
- Keep every bullet on one line, under ${limits.bulletChars} characters. Output only the title and the two sections.
- Write in {{language}}.

Commits on this branch:
{{commits}}

Branch: {{branch}} (against {{base}})

Files changed:
{{stat}}

Diff:
{{diff}}
`;
}

/**
 * Uses the repository's own PR template as the structure when it has one, since
 * most repos already keep their conventions in .github/pull_request_template.md.
 */
const TEMPLATE_PREFIX = `Write a pull request title and description for the branch below.

The first line is the title. Then fill in this repository's pull request template,
keeping its headings and removing any checklist items or instructions that do not
apply. Use bullets, group related changes by area, and never write one bullet per file.
Write in {{language}}.

--- repository pull request template ---
`;

const TEMPLATE_SUFFIX = `
--- end of template ---

Commits on this branch:
{{commits}}

Branch: {{branch}} (against {{base}})

Files changed:
{{stat}}

Diff:
{{diff}}
`;

export async function resolvePrPrompt(repoRoot: vscode.Uri, limits: Limits): Promise<string> {
	if (vscode.workspace.isTrusted) {
		for (const name of PR_FILES) {
			const text = await readFile(vscode.Uri.joinPath(repoRoot, ...name.split('/')));
			if (!text) {
				continue;
			}
			// A dedicated .komit-pr.md is already a prompt; GitHub's template is
			// a document to fill in, so it gets wrapped with instructions.
			return name === PR_FILES[0] ? text : TEMPLATE_PREFIX + text + TEMPLATE_SUFFIX;
		}
	}

	const configured = vscode.workspace.getConfiguration('komit').get<string>('prPrompt');
	return configured?.trim() ? configured : buildPrPrompt(limits);
}

async function readFile(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8').trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}
