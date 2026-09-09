import * as vscode from 'vscode';
import { limits } from './config';
import { KomitError } from './errors';
import { getGitAPI } from './git/api';
import {
	collectBranchContext,
	listBranches,
	pickRepository,
	repoLabel,
	resolveBaseBranch,
	type BasePreselection,
} from './git/repository';
import { normalize } from './normalize';
import { resolvePrPrompt } from './prompt/pr';
import { render, type TemplateVars } from './prompt/render';
import { createProvider, getActiveProfile } from './providers/registry';
import { runSetup } from './ui/setup';

export async function generatePr(context: vscode.ExtensionContext, rootUri: vscode.Uri | undefined): Promise<void> {
	const api = await getGitAPI();
	if (!api) {
		throw new KomitError('The built-in Git extension is not available.');
	}

	if (api.repositories.length === 0) {
		throw new KomitError('No Git repository is open.');
	}

	// Undefined here means the picker was dismissed, which is not an error.
	const repo = await pickRepository(api, rootUri);
	if (!repo) {
		return;
	}

	const config = vscode.workspace.getConfiguration('komit');
	const cwd = repo.rootUri.fsPath;
	const name = repoLabel(api, repo);
	const prefix = name ? `[${name}] ` : '';

	const suggested = await resolveBaseBranch(
		api.git.path,
		cwd,
		config.get<string>('baseBranch') ?? '',
		lastBase(context, repo.rootUri),
	);

	const head = repo.state.HEAD?.name;
	const base = await askForBase(api.git.path, cwd, suggested, [name, head].filter(Boolean).join(' · '));
	if (!base) {
		return;
	}

	await rememberBase(context, repo.rootUri, base);

	const profile = getActiveProfile() ?? await runSetup(context.secrets);
	if (!profile) {
		return;
	}

	const provider = await createProvider(profile, context.secrets, (config.get<number>('timeoutSeconds') ?? 90) * 1000);

	const description = await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `${prefix}Generating PR description against ${base}…`,
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
			throw new KomitError(`${prefix}This branch has no commits that ${base} does not already have.`);
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
	vscode.window.showInformationMessage(
		name
			? `Komit: PR description for ${name} copied to the clipboard.`
			: 'Komit: PR description copied to the clipboard.',
	);
}

interface BranchItem extends vscode.QuickPickItem {
	branch: string;
}

/**
 * Confirms the base on every run. A wrong base quietly describes somebody else's
 * work, and the suggestion is only ever a guess, so it goes in front of the user
 * as the first item: Enter accepts it, typing retargets it.
 */
async function askForBase(
	gitPath: string,
	cwd: string,
	suggested: BasePreselection | undefined,
	from: string,
): Promise<string | undefined> {
	const branches = await listBranches(gitPath, cwd);
	if (branches.length === 0) {
		throw new KomitError('Could not work out which branch to compare against. Set komit.baseBranch.');
	}

	const rest: BranchItem[] = branches
		.filter(b => b !== suggested?.branch)
		.map(branch => ({ label: `$(git-branch) ${branch}`, branch }));

	const items: BranchItem[] = suggested
		? [
			{ label: `$(check) ${suggested.branch}`, description: suggested.source, branch: suggested.branch },
			{ label: '', kind: vscode.QuickPickItemKind.Separator, branch: '' },
			...rest,
		]
		: rest;

	const picked = await vscode.window.showQuickPick(items, {
		title: from ? `Base branch for the PR from ${from}` : 'Base branch for the pull request',
		placeHolder: 'Enter accepts the suggestion, or pick another branch',
		matchOnDescription: true,
	});

	return picked?.branch;
}

const LAST_BASE_KEY = 'komit.lastBaseBranch';

function lastBase(context: vscode.ExtensionContext, rootUri: vscode.Uri): string | undefined {
	return context.workspaceState.get<Record<string, string>>(LAST_BASE_KEY)?.[rootUri.toString()];
}

/** Keyed per repository, so repositories with different bases do not fight. */
function rememberBase(context: vscode.ExtensionContext, rootUri: vscode.Uri, base: string): Thenable<void> {
	const stored = context.workspaceState.get<Record<string, string>>(LAST_BASE_KEY) ?? {};
	return context.workspaceState.update(LAST_BASE_KEY, { ...stored, [rootUri.toString()]: base });
}
