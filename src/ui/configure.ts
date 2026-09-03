import * as vscode from 'vscode';

type SettingType = 'boolean' | 'enum' | 'number' | 'string' | 'array' | 'command';

interface Setting {
	key: string;
	label: string;
	group: string;
	type: SettingType;
	values?: string[];
	command?: string;
	/** Shown instead of the raw value, for things that read badly as JSON. */
	summary?: (value: unknown) => string;
}

const SETTINGS: Setting[] = [
	{ key: 'conventionalCommits', label: 'Conventional Commits', group: 'Message style', type: 'boolean' },
	{ key: 'commitTypes', label: 'Commit types', group: 'Message style', type: 'array' },
	{ key: 'bodyStyle', label: 'Body style', group: 'Message style', type: 'enum', values: ['bullets', 'prose', 'none'] },
	{ key: 'scopeSource', label: 'Scope source', group: 'Message style', type: 'enum', values: ['auto', 'ticket', 'path', 'none'] },
	{ key: 'ticketPattern', label: 'Ticket pattern', group: 'Message style', type: 'string' },
	{ key: 'ticketUppercase', label: 'Uppercase ticket keys', group: 'Message style', type: 'boolean' },
	{ key: 'language', label: 'Language', group: 'Message style', type: 'string' },

	{ key: 'prompt', label: 'Edit prompt…', group: 'Prompt & signature', type: 'command', command: 'aicommit.editPrompt', summary: v => v ? 'custom' : 'built-in' },
	{ key: 'signature', label: 'Edit signature…', group: 'Prompt & signature', type: 'command', command: 'aicommit.editSignature', summary: countOf('trailer') },

	{ key: 'activeProvider', label: 'Provider…', group: 'Provider', type: 'command', command: 'aicommit.selectProvider', summary: v => String(v || '—') },
	{ key: '', label: 'Model…', group: 'Provider', type: 'command', command: 'aicommit.selectModel' },

	{ key: 'excludeGlobs', label: 'Excluded paths', group: 'Diff', type: 'array', summary: countOf('pattern') },
	{ key: 'excludeGlobs.additional', label: 'Extra exclusions', group: 'Diff', type: 'array', summary: countOf('pattern') },
	{ key: 'includeGlobs', label: 'Re-included paths', group: 'Diff', type: 'array', summary: countOf('pattern') },
	{ key: 'recentCommitCount', label: 'Recent commits sent', group: 'Diff', type: 'number' },
	{ key: 'maxDiffBytes', label: 'Max diff size', group: 'Diff', type: 'number', summary: v => `${v} bytes` },
	{ key: 'timeoutSeconds', label: 'Timeout', group: 'Diff', type: 'number', summary: v => `${v}s` },

	{ key: 'overwriteExistingMessage', label: 'Overwrite existing message', group: 'Behaviour', type: 'boolean' },
	{ key: 'privacyNotice', label: 'Privacy notice', group: 'Behaviour', type: 'enum', values: ['once', 'always', 'never'] },
];

function countOf(noun: string) {
	return (value: unknown) => {
		const n = Array.isArray(value) ? value.length : 0;
		return n === 0 ? 'none' : `${n} ${noun}${n === 1 ? '' : 's'}`;
	};
}

interface Item extends vscode.QuickPickItem {
	setting?: Setting;
	scopeSwitch?: boolean;
	openJson?: boolean;
}

/** AI Commit: Configure — every setting in one place, each showing its value. */
export async function configure(target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Promise<void> {
	const config = vscode.workspace.getConfiguration('aicommit');
	const workspaceOpen = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
	const isWorkspace = target === vscode.ConfigurationTarget.Workspace;

	const items: Item[] = [];

	if (workspaceOpen) {
		items.push({
			label: `$(gear) Scope: ${isWorkspace ? 'Workspace' : 'User'} settings`,
			description: `switch to ${isWorkspace ? 'User' : 'Workspace'}`,
			scopeSwitch: true,
		});
	}

	let group = '';
	for (const setting of SETTINGS) {
		if (setting.group !== group) {
			group = setting.group;
			items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
		}

		const value = setting.key ? config.get(setting.key) : undefined;
		items.push({
			label: setting.label,
			description: setting.summary ? setting.summary(value) : describe(value),
			setting,
		});
	}

	items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
	items.push({ label: '$(json) Open settings.json…', openJson: true });

	const picked = await vscode.window.showQuickPick(items, {
		title: 'AI Commit: configure',
		placeHolder: `Editing ${isWorkspace ? 'workspace' : 'user'} settings`,
		matchOnDescription: true,
	});

	if (!picked) {
		return;
	}

	if (picked.scopeSwitch) {
		return configure(isWorkspace ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace);
	}

	if (picked.openJson) {
		await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ariefsn.aicommit');
		return;
	}

	await edit(picked.setting!, target);
	await configure(target);
}

function describe(value: unknown): string {
	if (typeof value === 'boolean') {
		return value ? 'On' : 'Off';
	}
	if (Array.isArray(value)) {
		return value.length ? `${value.slice(0, 3).join(', ')}${value.length > 3 ? ` +${value.length - 3}` : ''}` : 'none';
	}
	return value === undefined || value === '' ? '—' : String(value);
}

async function edit(setting: Setting, target: vscode.ConfigurationTarget): Promise<void> {
	const config = vscode.workspace.getConfiguration('aicommit');

	switch (setting.type) {
		case 'command':
			await vscode.commands.executeCommand(setting.command!);
			return;

		case 'boolean':
			await config.update(setting.key, !config.get<boolean>(setting.key), target);
			return;

		case 'enum': {
			const current = config.get<string>(setting.key);
			const picked = await vscode.window.showQuickPick(
				setting.values!.map(v => ({ label: v, description: v === current ? '$(check) current' : undefined })),
				{ title: setting.label },
			);
			if (picked) {
				await config.update(setting.key, picked.label, target);
			}
			return;
		}

		case 'number': {
			const value = await vscode.window.showInputBox({
				title: setting.label,
				value: String(config.get<number>(setting.key) ?? ''),
				validateInput: input => /^\d+$/.test(input.trim()) && Number(input) > 0
					? undefined
					: 'Enter a positive whole number',
			});
			if (value) {
				await config.update(setting.key, Number(value.trim()), target);
			}
			return;
		}

		case 'string': {
			const value = await vscode.window.showInputBox({
				title: setting.label,
				value: config.get<string>(setting.key) ?? '',
			});
			if (value !== undefined) {
				await config.update(setting.key, value, target);
			}
			return;
		}

		case 'array':
			await editArray(setting, target);
			return;
	}
}

async function editArray(setting: Setting, target: vscode.ConfigurationTarget): Promise<void> {
	const config = vscode.workspace.getConfiguration('aicommit');
	const current = config.get<string[]>(setting.key) ?? [];

	const action = await vscode.window.showQuickPick([
		{ label: '$(add) Add…', id: 'add' },
		{ label: '$(trash) Remove…', id: 'remove' },
		{ label: '$(discard) Reset to default', id: 'reset' },
	], { title: `${setting.label} — ${current.length} entr${current.length === 1 ? 'y' : 'ies'}` });

	switch (action?.id) {
		case 'add': {
			const value = await vscode.window.showInputBox({ title: `Add to ${setting.label}` });
			if (value?.trim()) {
				await config.update(setting.key, [...current, value.trim()], target);
			}
			return;
		}
		case 'remove': {
			const picked = await vscode.window.showQuickPick(current, { title: `Remove from ${setting.label}` });
			if (picked) {
				await config.update(setting.key, current.filter(v => v !== picked), target);
			}
			return;
		}
		case 'reset':
			await config.update(setting.key, undefined, target);
			return;
	}
}
