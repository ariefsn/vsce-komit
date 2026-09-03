import * as vscode from 'vscode';
import { getGitAPI, type GitAPI, type GitRepository } from './git/api';
import { collectContext, hasStagedChanges, resolveRepository } from './git/repository';
import { AiCommitError, showError } from './errors';
import { normalize } from './normalize';
import { privacyNotice, signature, styleOptions, ticketFor } from './config';
import { buildStyleRules } from './prompt/default';
import { resolvePrompt } from './prompt/resolve';
import { render, type TemplateVars } from './prompt/render';
import { appendSignature } from './signature';
import { configure } from './ui/configure';
import { editPrompt, editSignature } from './ui/prompt-editor';
import { createProvider, getActiveProfile } from './providers/registry';
import type { Provider } from './providers/types';
import { pickModel, pickProvider, setModel } from './ui/pickers';
import { runSetup } from './ui/setup';

const STAGED_CONTEXT_KEY = 'aicommit.hasStagedChanges';
const ACKNOWLEDGED_KEY = 'aicommit.acknowledgedDestinations';

const inFlight = new Set<string>();

let gitPath: string | undefined;
let gitApi: GitAPI | undefined;

/** The repository the prompt/signature editors should act on. */
function currentRepoRoot(): vscode.Uri | undefined {
	return gitApi ? resolveRepository(gitApi, undefined)?.rootUri : undefined;
}

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('aicommit.generate', (arg?: { rootUri?: vscode.Uri }) =>
			generate(context, arg?.rootUri).catch(showError)),
		vscode.commands.registerCommand('aicommit.selectProvider', () => selectProvider(context).catch(showError)),
		vscode.commands.registerCommand('aicommit.selectModel', () => selectModel(context).catch(showError)),
		vscode.commands.registerCommand('aicommit.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ariefsn.aicommit')),
		vscode.commands.registerCommand('aicommit.editPrompt', () =>
			editPrompt(currentRepoRoot()).catch(showError)),
		vscode.commands.registerCommand('aicommit.editSignature', () =>
			editSignature(gitPath, currentRepoRoot()).catch(showError)),
		vscode.commands.registerCommand('aicommit.configure', () => configure().catch(showError)),
	);

	const api = await getGitAPI();
	if (api) {
		gitApi = api;
		gitPath = api.git.path;
		watchStagedChanges(api, context.subscriptions);
	}
}

export function deactivate() { }

async function generate(context: vscode.ExtensionContext, rootUri: vscode.Uri | undefined): Promise<void> {
	const api = await getGitAPI();
	if (!api) {
		throw new AiCommitError('The built-in Git extension is not available.');
	}

	const repo = resolveRepository(api, rootUri);
	if (!repo) {
		throw new AiCommitError('No Git repository is open.');
	}

	const key = repo.rootUri.toString();
	if (inFlight.has(key)) {
		return;
	}

	if (!hasStagedChanges(repo) && !await offerToStageAll(repo)) {
		return;
	}

	const profile = getActiveProfile() ?? await runSetup(context.secrets);
	if (!profile) {
		return;
	}

	const config = vscode.workspace.getConfiguration('aicommit');
	const timeoutMs = (config.get<number>('timeoutSeconds') ?? 90) * 1000;
	const provider = await createProvider(profile, context.secrets, timeoutMs);

	if (!await acknowledgeDestination(context, provider)) {
		return;
	}

	inFlight.add(key);
	try {
		const message = await vscode.window.withProgress({
			location: vscode.ProgressLocation.SourceControl,
			title: 'Generating commit message…',
			cancellable: true,
		}, (_progress, token) => run(repo, provider, token));

		if (message) {
			repo.inputBox.value = message;
		}
	} finally {
		inFlight.delete(key);
	}
}

async function run(repo: GitRepository, provider: Provider, token: vscode.CancellationToken): Promise<string | undefined> {
	const api = await getGitAPI();
	const config = vscode.workspace.getConfiguration('aicommit');

	const excludeGlobs = [
		...(config.get<string[]>('excludeGlobs') ?? []),
		...(config.get<string[]>('excludeGlobs.additional') ?? []),
	];

	const staged = await collectContext(api!.git.path, repo, {
		excludeGlobs,
		includeGlobs: config.get<string[]>('includeGlobs') ?? [],
		maxDiffBytes: config.get<number>('maxDiffBytes') ?? 60000,
		recentCommitCount: config.get<number>('recentCommitCount') ?? 10,
	});

	if (!staged.diff && !staged.stat) {
		throw new AiCommitError('Every staged file is excluded by aicommit.excludeGlobs, so there is nothing to describe.');
	}

	const existing = repo.inputBox.value.trim();
	const overwrite = config.get<boolean>('overwriteExistingMessage') ?? false;

	const vars: TemplateVars = {
		diff: staged.truncated
			? `${staged.diff}\n\n[Diff truncated. Rely on the file list above for overall scope.]`
			: staged.diff,
		stat: staged.stat || '(no file summary available)',
		recentCommits: staged.recentCommits.map(s => `- ${s}`).join('\n') || '(no previous commits)',
		branch: staged.branch || '(unknown)',
		userHint: !overwrite && existing ? existing : '(nothing typed yet)',
		language: config.get<string>('language') ?? 'English',
		styleRules: buildStyleRules(styleOptions(staged.branch)),
		ticket: ticketFor(staged.branch) ?? '',
	};

	const instruction = render(await resolvePrompt(repo.rootUri), vars);

	if (token.isCancellationRequested) {
		return undefined;
	}

	const message = normalize(await provider.generate(instruction, token));
	if (token.isCancellationRequested) {
		return undefined;
	}
	if (!message) {
		throw new AiCommitError(`${provider.destination} returned an empty message.`);
	}

	return appendSignature(message, signature(), vars);
}

/** FR-2: never fall back to the working tree silently. */
async function offerToStageAll(repo: GitRepository): Promise<boolean> {
	const changes = repo.state.workingTreeChanges;
	if (changes.length === 0) {
		throw new AiCommitError('Nothing is staged, and there are no changes to stage.');
	}

	const choice = await vscode.window.showWarningMessage(
		`Nothing is staged. Stage all ${changes.length} changed file${changes.length === 1 ? '' : 's'} and continue?`,
		{ modal: true },
		'Stage All and Continue',
	);

	if (choice !== 'Stage All and Continue') {
		return false;
	}

	await repo.add(changes.map(c => c.uri.fsPath));
	return true;
}

/** FR-18: name the destination once, before the first request reaches it. */
async function acknowledgeDestination(context: vscode.ExtensionContext, provider: Provider): Promise<boolean> {
	const mode = privacyNotice();
	if (mode === 'never') {
		return true;
	}

	const acknowledged = context.globalState.get<string[]>(ACKNOWLEDGED_KEY) ?? [];
	if (mode === 'once' && acknowledged.includes(provider.destination)) {
		return true;
	}

	const choice = await vscode.window.showWarningMessage(
		`AI Commit will send your staged diff to ${provider.destination}.`,
		{
			modal: true,
			detail: 'This happens every time you generate a message. Common secret files (.env, private keys) are excluded by default, but exclusions are a filter, not a guarantee — a secret committed inside an ordinary source file would still be sent.',
		},
		'Continue',
	);

	if (choice !== 'Continue') {
		return false;
	}

	await context.globalState.update(ACKNOWLEDGED_KEY, [...acknowledged, provider.destination]);
	return true;
}

async function selectProvider(context: vscode.ExtensionContext): Promise<void> {
	const active = getActiveProfile();
	const picked = await pickProvider(active?.id);
	if (!picked) {
		return;
	}

	if (picked === 'add-new') {
		await runSetup(context.secrets);
		return;
	}

	await vscode.workspace.getConfiguration('aicommit')
		.update('activeProvider', picked.id, vscode.ConfigurationTarget.Global);
	vscode.window.showInformationMessage(`AI Commit: now using ${picked.label}.`);
}

async function selectModel(context: vscode.ExtensionContext): Promise<void> {
	const profile = getActiveProfile() ?? await runSetup(context.secrets);
	if (!profile) {
		return;
	}

	const model = await pickModel(profile, context.secrets);
	if (model) {
		await setModel(profile, model);
		vscode.window.showInformationMessage(`AI Commit: ${profile.label} now uses ${model}.`);
	}
}

/**
 * Drives the enablement context key. Keys are window-global with no per-input-box
 * scoping, so this is true when ANY repository has staged changes; FR-2's
 * confirmation is the per-repository backstop.
 */
function watchStagedChanges(api: GitAPI, subscriptions: vscode.Disposable[]): void {
	const perRepo = new Map<string, vscode.Disposable>();

	const refresh = () => {
		const anyStaged = api.repositories.some(hasStagedChanges);
		vscode.commands.executeCommand('setContext', STAGED_CONTEXT_KEY, anyStaged);
	};

	const attach = (repo: GitRepository) => {
		perRepo.get(repo.rootUri.toString())?.dispose();
		perRepo.set(repo.rootUri.toString(), repo.state.onDidChange(refresh));
		refresh();
	};

	api.repositories.forEach(attach);
	subscriptions.push(
		api.onDidOpenRepository(attach),
		api.onDidCloseRepository(repo => {
			perRepo.get(repo.rootUri.toString())?.dispose();
			perRepo.delete(repo.rootUri.toString());
			refresh();
		}),
		new vscode.Disposable(() => perRepo.forEach(d => d.dispose())),
	);

	refresh();
}
