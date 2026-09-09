import * as vscode from 'vscode';
import { getGitAPI, type GitAPI, type GitRepository } from './git/api';
import { collectContext, hasStagedChanges, repoLabel, resolveRepository } from './git/repository';
import { KomitError, showError } from './errors';
import { normalize } from './normalize';
import { privacyNotice, signature, styleOptions, ticketFor } from './config';
import { buildStyleRules } from './prompt/default';
import { resolvePrompt } from './prompt/resolve';
import { render, type TemplateVars } from './prompt/render';
import { appendSignature } from './signature';
import { generatePr } from './pr';
import { configure } from './ui/configure';
import { editPrompt, editSignature } from './ui/prompt-editor';
import { createProvider, getActiveProfile } from './providers/registry';
import type { Provider } from './providers/types';
import { pickModel, pickProvider, setModel } from './ui/pickers';
import { runSetup } from './ui/setup';

const STAGED_CONTEXT_KEY = 'komit.hasStagedChanges';
const ACKNOWLEDGED_KEY = 'komit.acknowledgedDestinations';

const inFlight = new Set<string>();

let gitPath: string | undefined;
let gitApi: GitAPI | undefined;

/** The repository the prompt/signature editors should act on. */
function currentRepoRoot(): vscode.Uri | undefined {
	return gitApi ? resolveRepository(gitApi, undefined)?.rootUri : undefined;
}

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('komit.generate', (arg?: { rootUri?: vscode.Uri }) =>
			generate(context, arg?.rootUri).catch(showError)),
		vscode.commands.registerCommand('komit.regenerate', (arg?: { rootUri?: vscode.Uri }) =>
			generate(context, arg?.rootUri, true).catch(showError)),
		vscode.commands.registerCommand('komit.generatePr', (arg?: { rootUri?: vscode.Uri }) =>
			generatePr(context, arg?.rootUri).catch(showError)),
		vscode.commands.registerCommand('komit.selectProvider', () => selectProvider(context).catch(showError)),
		vscode.commands.registerCommand('komit.selectModel', () => selectModel(context).catch(showError)),
		vscode.commands.registerCommand('komit.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ariefsn.komit')),
		vscode.commands.registerCommand('komit.editPrompt', () =>
			editPrompt(currentRepoRoot()).catch(showError)),
		vscode.commands.registerCommand('komit.editSignature', () =>
			editSignature(gitPath, currentRepoRoot()).catch(showError)),
		vscode.commands.registerCommand('komit.configure', () => configure().catch(showError)),
	);

	const api = await getGitAPI();
	if (api) {
		gitApi = api;
		gitPath = api.git.path;
		watchStagedChanges(api, context.subscriptions);
	}
}

export function deactivate() { }

async function generate(
	context: vscode.ExtensionContext,
	rootUri: vscode.Uri | undefined,
	regenerate = false,
): Promise<void> {
	const api = await getGitAPI();
	if (!api) {
		throw new KomitError('The built-in Git extension is not available.');
	}

	const repo = resolveRepository(api, rootUri);
	if (!repo) {
		throw new KomitError('No Git repository is open.');
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

	const config = vscode.workspace.getConfiguration('komit');
	const timeoutMs = (config.get<number>('timeoutSeconds') ?? 90) * 1000;
	const provider = await createProvider(profile, context.secrets, timeoutMs);

	if (!await acknowledgeDestination(context, provider)) {
		return;
	}

	const label = repoLabel(api, repo);

	inFlight.add(key);
	try {
		const message = await vscode.window.withProgress({
			location: vscode.ProgressLocation.SourceControl,
			// SourceControl progress is not scoped to one provider, so with several
			// repositories in the view the spinner has to say which one is running.
			title: `${label ? `[${label}] ` : ''}Generating commit message…`,
			cancellable: true,
		}, (_progress, token) => run(repo, provider, token, regenerate));

		if (message) {
			repo.inputBox.value = message;
		}
	} finally {
		inFlight.delete(key);
	}
}

async function run(
	repo: GitRepository,
	provider: Provider,
	token: vscode.CancellationToken,
	regenerate = false,
): Promise<string | undefined> {
	const api = await getGitAPI();
	const config = vscode.workspace.getConfiguration('komit');

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
		throw new KomitError('Every staged file is excluded by komit.excludeGlobs, so there is nothing to describe.');
	}

	const existing = repo.inputBox.value.trim();
	// Regenerating always replaces, and treats what is there as the rejected
	// attempt rather than as intent to refine.
	const overwrite = regenerate || (config.get<boolean>('overwriteExistingMessage') ?? false);

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

	let instruction = render(await resolvePrompt(repo.rootUri), vars);
	if (regenerate && existing) {
		instruction += `\n\nYou previously suggested the message below and it was rejected. Write a genuinely different one, taking a different angle or emphasis.\n\n${existing}\n`;
	}

	if (token.isCancellationRequested) {
		return undefined;
	}

	const message = normalize(await provider.generate(instruction, token));
	if (token.isCancellationRequested) {
		return undefined;
	}
	if (!message) {
		throw new KomitError(`${provider.destination} returned an empty message.`);
	}

	return appendSignature(message, signature(), vars);
}

/** FR-2: never fall back to the working tree silently. */
async function offerToStageAll(repo: GitRepository): Promise<boolean> {
	const changes = repo.state.workingTreeChanges;
	if (changes.length === 0) {
		throw new KomitError('Nothing is staged, and there are no changes to stage.');
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
		`Komit will send your staged diff to ${provider.destination}.`,
		{
			modal: true,
			detail: 'This happens every time you generate a message. Common secret files (.env, private keys) are excluded by default, but exclusions only go so far. A secret committed inside an ordinary source file would still be sent.',
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

	await vscode.workspace.getConfiguration('komit')
		.update('activeProvider', picked.id, vscode.ConfigurationTarget.Global);
	vscode.window.showInformationMessage(`Komit: now using ${picked.label}.`);
}

async function selectModel(context: vscode.ExtensionContext): Promise<void> {
	const profile = getActiveProfile() ?? await runSetup(context.secrets);
	if (!profile) {
		return;
	}

	const model = await pickModel(profile, context.secrets);
	if (model) {
		await setModel(profile, model);
		vscode.window.showInformationMessage(`Komit: ${profile.label} now uses ${model}.`);
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
