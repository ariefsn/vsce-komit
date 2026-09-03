import * as vscode from 'vscode';
import { styleOptions } from '../config';
import { runGit } from '../git/repository';
import { buildDefaultPrompt, buildStyleRules } from '../prompt/default';
import { REPO_FILES, readRepoInstructions } from '../prompt/resolve';
import { render } from '../prompt/render';

interface Choice extends vscode.QuickPickItem {
	action: 'settings' | 'repo' | 'reset';
}

/** Surfaces the prompt override paths so people can find them. */
export async function editPrompt(repoRoot: vscode.Uri | undefined): Promise<void> {
	const repoFile = repoRoot ? vscode.Uri.joinPath(repoRoot, REPO_FILES[0]) : undefined;
	const repoFileExists = repoRoot ? Boolean(await readRepoInstructions(repoRoot)) : false;

	const choices: Choice[] = [
		{
			label: '$(settings-gear) Edit my prompt',
			detail: 'Applies to every repository (user settings)',
			action: 'settings',
		},
	];

	if (repoFile) {
		choices.push(repoFileExists
			? { label: `$(go-to-file) Open ${REPO_FILES[0]}`, detail: 'Already present in this repository', action: 'repo' }
			: { label: `$(new-file) Create ${REPO_FILES[0]} for this repository`, detail: 'Travels with the repo, so every contributor gets it', action: 'repo' },
		);
	}

	choices.push({
		label: '$(discard) Reset to the built-in prompt',
		detail: 'Clears your override',
		action: 'reset',
	});

	const picked = await vscode.window.showQuickPick(choices, {
		title: 'AI Commit: edit prompt',
		placeHolder: 'How would you like to customize the prompt?',
	});

	switch (picked?.action) {
		case 'settings':
			await vscode.commands.executeCommand('workbench.action.openSettings', 'aicommit.prompt');
			break;
		case 'repo':
			await openRepoFile(repoFile!, repoFileExists);
			break;
		case 'reset':
			await resetPrompt(repoFile, repoFileExists);
			break;
	}
}

/** Seeds the file with the current default so there is something to edit. */
async function openRepoFile(uri: vscode.Uri, exists: boolean): Promise<void> {
	if (!exists) {
		const seed = buildDefaultPrompt(styleOptions())
			.replace('{{styleRules}}', buildStyleRules(styleOptions()));
		await vscode.workspace.fs.writeFile(uri, Buffer.from(seed, 'utf8'));
	}

	await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
}

async function resetPrompt(repoFile: vscode.Uri | undefined, repoFileExists: boolean): Promise<void> {
	await vscode.workspace.getConfiguration('aicommit')
		.update('prompt', undefined, vscode.ConfigurationTarget.Global);

	if (repoFile && repoFileExists) {
		const choice = await vscode.window.showWarningMessage(
			`Also delete ${REPO_FILES[0]}? It overrides your settings.`,
			{ modal: true },
			'Delete',
		);
		if (choice === 'Delete') {
			await vscode.workspace.fs.delete(repoFile);
		}
	}

	vscode.window.showInformationMessage('AI Commit: using the built-in prompt.');
}

interface SignatureChoice extends vscode.QuickPickItem {
	action: 'coauthor' | 'custom' | 'remove' | 'settings';
}

/** Edits trailers without anyone having to hand-write JSON. */
export async function editSignature(gitPath: string | undefined, repoRoot: vscode.Uri | undefined): Promise<void> {
	const config = vscode.workspace.getConfiguration('aicommit');
	const current = config.get<string[]>('signature') ?? [];

	const choices: SignatureChoice[] = [
		{ label: '$(person-add) Add Co-authored-by from git config', detail: 'Uses your user.name and user.email', action: 'coauthor' },
		{ label: '$(add) Add a custom trailer…', detail: 'For example: Refs: {{branch}}', action: 'custom' },
	];

	if (current.length) {
		choices.push({ label: '$(trash) Remove a trailer…', action: 'remove' });
	}
	choices.push({ label: '$(settings-gear) Edit all in Settings', action: 'settings' });

	const picked = await vscode.window.showQuickPick(choices, {
		title: 'AI Commit: edit signature',
		placeHolder: current.length ? `${current.length} trailer${current.length === 1 ? '' : 's'} configured` : 'No trailers configured',
	});

	switch (picked?.action) {
		case 'coauthor':
			await addTrailer(current, await coauthorSeed(gitPath, repoRoot));
			break;
		case 'custom':
			await addTrailer(current, '');
			break;
		case 'remove':
			await removeTrailer(current);
			break;
		case 'settings':
			await vscode.commands.executeCommand('workbench.action.openSettings', 'aicommit.signature');
			break;
	}
}

async function coauthorSeed(gitPath: string | undefined, repoRoot: vscode.Uri | undefined): Promise<string> {
	if (!gitPath || !repoRoot) {
		return 'Co-authored-by: ';
	}

	const read = async (key: string) =>
		(await runGit(gitPath, repoRoot.fsPath, ['config', '--get', key]).catch(() => '')).trim();

	const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
	return name && email ? `Co-authored-by: ${name} <${email}>` : 'Co-authored-by: ';
}

async function addTrailer(current: string[], seed: string): Promise<void> {
	const value = await vscode.window.showInputBox({
		title: 'Add a trailer',
		prompt: 'Appended to every generated message. Template variables such as {{branch}} are supported.',
		value: seed,
		ignoreFocusOut: true,
		validateInput: input => /^[A-Za-z][A-Za-z0-9-]*:\s*\S/.test(input.trim())
			? undefined
			: 'Use the git trailer form "Key: Value"',
	});

	if (value) {
		await saveSignature([...current, value.trim()]);
	}
}

async function removeTrailer(current: string[]): Promise<void> {
	const picked = await vscode.window.showQuickPick(current, {
		title: 'Remove a trailer',
		placeHolder: 'Pick the trailer to remove',
	});

	if (picked) {
		await saveSignature(current.filter(line => line !== picked));
	}
}

async function saveSignature(lines: string[]): Promise<void> {
	await vscode.workspace.getConfiguration('aicommit')
		.update('signature', lines, vscode.ConfigurationTarget.Global);

	const preview = render(lines.join('\n'), {
		diff: '', stat: '', recentCommits: '', branch: '<branch>',
		userHint: '', language: '', styleRules: '', ticket: '<ticket>',
	});
	vscode.window.showInformationMessage(lines.length
		? `AI Commit signature:\n${preview}`
		: 'AI Commit: signature cleared.');
}
