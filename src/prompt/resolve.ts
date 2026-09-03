import * as vscode from 'vscode';
import { styleOptions } from '../config';
import { buildDefaultPrompt } from './default';
import { hasVariables } from './render';

export const REPO_FILES = ['.komit.md', '.github/commit-instructions.md'];

const CONTEXT_BLOCKS = `

{{styleRules}}

Recent commits on this branch:
{{recentCommits}}

What the author already typed (treat as their intent, refine it):
{{userHint}}

Files changed:
{{stat}}

Diff:
{{diff}}
`;

/**
 * Prompt precedence (FR-7): repo-local file, workspace setting, user setting, built-in.
 * The repo-local lookup is skipped in an untrusted workspace (FR-19) because the file
 * is repository-controlled input.
 */
export async function resolvePrompt(repoRoot: vscode.Uri): Promise<string> {
	if (vscode.workspace.isTrusted) {
		const fromRepo = await readRepoInstructions(repoRoot);
		if (fromRepo) {
			// A file with no variables gets the standard context appended (FR-8).
			return hasVariables(fromRepo) ? fromRepo : fromRepo + CONTEXT_BLOCKS;
		}
	}

	const configured = vscode.workspace.getConfiguration('komit').get<string>('prompt');
	if (configured && configured.trim()) {
		return hasVariables(configured) ? configured : configured + CONTEXT_BLOCKS;
	}

	return buildDefaultPrompt(styleOptions());
}

export async function readRepoInstructions(repoRoot: vscode.Uri): Promise<string | undefined> {
	for (const name of REPO_FILES) {
		const uri = vscode.Uri.joinPath(repoRoot, ...name.split('/'));
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const text = Buffer.from(bytes).toString('utf8').trim();
			if (text) {
				return text;
			}
		} catch {
			// Not present; try the next candidate.
		}
	}
	return undefined;
}
