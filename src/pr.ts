import * as vscode from 'vscode';
import { limits } from './config';
import { AiCommitError } from './errors';
import { getGitAPI } from './git/api';
import { collectBranchContext, listBranches, resolveBaseBranch, resolveRepository } from './git/repository';
import { normalize } from './normalize';
import { resolvePrPrompt } from './prompt/pr';
import { render, type TemplateVars } from './prompt/render';
import { createProvider, getActiveProfile } from './providers/registry';
import { runSetup } from './ui/setup';

export async function generatePr(context: vscode.ExtensionContext, rootUri: vscode.Uri | undefined): Promise<void> {
	const api = await getGitAPI();
	if (!api) {
		throw new AiCommitError('The built-in Git extension is not available.');
	}

	const repo = resolveRepository(api, rootUri);
	if (!repo) {
		throw new AiCommitError('No Git repository is open.');
	}

	const config = vscode.workspace.getConfiguration('aicommit');
	const cwd = repo.rootUri.fsPath;

	const base = await resolveBaseBranch(api.git.path, cwd, config.get<string>('baseBranch') ?? '')
		?? await askForBase(api.git.path, cwd);
	if (!base) {
		return;
	}

	const profile = getActiveProfile() ?? await runSetup(context.secrets);
	if (!profile) {
		return;
	}

	const provider = await createProvider(profile, context.secrets, (config.get<number>('timeoutSeconds') ?? 90) * 1000);

	const description = await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `Generating PR description against ${base}…`,
		cancellable: true,
	}, async (_progress, token) => {
		const branch = await collectBranchContext(api.git.path, repo, base, {
			excludeGlobs: [
				...(config.get<string[]>('excludeGlobs') ?? []),
				...(config.get<string[]>('excludeGlobs.additional') ?? []),
			],
			includeGlobs: config.get<string[]>('includeGlobs') ?? [],
			maxDiffBytes: config.get<number>('maxPrDiffBytes') ?? 120000,
		});

		if (branch.commits.length === 0) {
			throw new AiCommitError(`This branch has no commits that ${base} does not already have.`);
		}

		const vars: TemplateVars = {
			diff: branch.truncated
				? `${branch.diff}\n\n[Diff truncated. Rely on the file list above for overall scope.]`
				: branch.diff,
			stat: branch.stat || '(no file summary available)',
			commits: branch.commits.map(c => `- ${c.replace(/\n+/g, '\n  ')}`).join('\n'),
			recentCommits: '',
			branch: branch.branch || '(unknown)',
			base,
			userHint: '',
			language: config.get<string>('language') ?? 'English',
			styleRules: '',
			ticket: '',
		};

		const instruction = render(await resolvePrPrompt(repo.rootUri, limits()), vars);
		return token.isCancellationRequested ? undefined : normalize(await provider.generate(instruction, token));
	});

	if (!description) {
		return;
	}

	await vscode.env.clipboard.writeText(description);
	const document = await vscode.workspace.openTextDocument({ content: description, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
	vscode.window.showInformationMessage('AI Commit: PR description copied to the clipboard.');
}

async function askForBase(gitPath: string, cwd: string): Promise<string | undefined> {
	const branches = await listBranches(gitPath, cwd);
	if (branches.length === 0) {
		throw new AiCommitError('Could not work out which branch to compare against. Set aicommit.baseBranch.');
	}

	return vscode.window.showQuickPick(branches, {
		title: 'Compare this branch against',
		placeHolder: 'Pick the base branch for the pull request',
	});
}
