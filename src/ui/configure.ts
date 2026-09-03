import * as vscode from 'vscode';
import { range } from '../prompt/default';

type SettingType = 'boolean' | 'enum' | 'number' | 'string' | 'array' | 'range' | 'command';

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

	{ key: 'limits.bodyBullets', label: 'Commit body bullets', group: 'Limits', type: 'range', summary: asRange },
	{ key: 'limits.prSummaryBullets', label: 'PR summary bullets', group: 'Limits', type: 'range', summary: asRange },
	{ key: 'limits.prChangesBullets', label: 'PR changes bullets', group: 'Limits', type: 'range', summary: asRange },
	{ key: 'limits.bulletChars', label: 'Bullet length', group: 'Limits', type: 'number', summary: v => `${v} chars` },
	{ key: 'limits.subjectChars', label: 'Subject length', group: 'Limits', type: 'number', summary: v => `${v} chars` },

	{ key: 'baseBranch', label: 'PR base branch', group: 'Message style', type: 'string', summary: v => String(v || 'auto-detect') },

	{ key: 'prompt', label: 'Edit prompt…', group: 'Prompt & signature', type: 'command', command: 'komit.editPrompt', summary: v => v ? 'custom' : 'built-in' },
	{ key: 'prPrompt', label: 'PR template', group: 'Prompt & signature', type: 'string', summary: v => v ? 'custom' : 'built-in' },
	{ key: 'signature', label: 'Edit signature…', group: 'Prompt & signature', type: 'command', command: 'komit.editSignature', summary: countOf('trailer') },

	{ key: 'activeProvider', label: 'Provider…', group: 'Provider', type: 'command', command: 'komit.selectProvider', summary: v => String(v || 'not set') },
	{ key: '', label: 'Model…', group: 'Provider', type: 'command', command: 'komit.selectModel' },

	{ key: 'excludeGlobs', label: 'Excluded paths', group: 'Diff', type: 'array', summary: countOf('pattern') },
	{ key: 'excludeGlobs.additional', label: 'Extra exclusions', group: 'Diff', type: 'array', summary: countOf('pattern') },
	{ key: 'includeGlobs', label: 'Re-included paths', group: 'Diff', type: 'array', summary: countOf('pattern') },
	{ key: 'recentCommitCount', label: 'Recent commits sent', group: 'Diff', type: 'number' },
	{ key: 'maxDiffBytes', label: 'Max diff size', group: 'Diff', type: 'number', summary: v => `${v} bytes` },
	{ key: 'maxPrDiffBytes', label: 'Max PR diff size', group: 'Diff', type: 'number', summary: v => `${v} bytes` },
	{ key: 'timeoutSeconds', label: 'Timeout', group: 'Diff', type: 'number', summary: v => `${v}s` },

	{ key: 'overwriteExistingMessage', label: 'Overwrite existing message', group: 'Behaviour', type: 'boolean' },
	{ key: 'privacyNotice', label: 'Privacy notice', group: 'Behaviour', type: 'enum', values: ['once', 'always', 'never'] },
];

function asRange(value: unknown): string {
	return Array.isArray(value) ? range(value as number[]) : 'not set';
}

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

/** Every setting in one place, each showing its current value. */
export async function configure(target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Promise<void> {
	const config = vscode.workspace.getConfiguration('komit');
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
		title: 'Komit: configure',
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
		await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ariefsn.komit');
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
	return value === undefined || value === '' ? 'not set' : String(value);
}

async function edit(setting: Setting, target: vscode.ConfigurationTarget): Promise<void> {
	const config = vscode.workspace.getConfiguration('komit');

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

		case 'range': {
			// Ranges are two numbers, so add/remove would be clumsy. Take "2-4" or
			// "3" and store [2, 4] or [3].
			const value = await vscode.window.showInputBox({
				title: setting.label,
				prompt: 'A range like 2-4, or a single number for exactly that many',
				value: asRange(config.get(setting.key)),
				validateInput: input => /^\d+(-\d+)?$/.test(input.trim()) ? undefined : 'Enter 2-4 or 3',
			});
			if (value) {
				const parts = value.trim().split('-').map(Number);
				await config.update(setting.key, parts[1] === parts[0] ? [parts[0]] : parts, target);
			}
			return;
		}

		case 'array':
			await editArray(setting, target);
			return;
	}
}

async function editArray(setting: Setting, target: vscode.ConfigurationTarget): Promise<void> {
	const config = vscode.workspace.getConfiguration('komit');
	const current = config.get<string[]>(setting.key) ?? [];

	const action = await vscode.window.showQuickPick([
		{ label: '$(add) Add…', id: 'add' },
		{ label: '$(trash) Remove…', id: 'remove' },
		{ label: '$(discard) Reset to default', id: 'reset' },
	], { title: `${setting.label}: ${current.length} entr${current.length === 1 ? 'y' : 'ies'}` });

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
