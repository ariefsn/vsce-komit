import * as vscode from 'vscode';
import {
	CLI_PRESETS,
	HOSTED_PRESETS,
	detectCliPresets,
	getProfiles,
	saveProfile,
	secretKey,
} from '../providers/registry';
import type { ProviderProfile } from '../providers/types';
import { pickModel } from './pickers';

interface PresetItem extends vscode.QuickPickItem {
	preset?: ProviderProfile;
	custom?: boolean;
}

/**
 * First-run flow (§5.1): detected CLI agents first, then hosted presets, then a
 * custom OpenAI-compatible endpoint. Returns the configured profile, or undefined
 * if the user backed out.
 */
export async function runSetup(secrets: vscode.SecretStorage): Promise<ProviderProfile | undefined> {
	const detected = vscode.workspace.isTrusted ? await detectCliPresets() : [];
	const detectedIds = new Set(detected.map(p => p.id));
	const items: PresetItem[] = [];

	if (detected.length) {
		items.push({ label: 'Installed on this machine', kind: vscode.QuickPickItemKind.Separator });
		for (const preset of detected) {
			items.push({ label: preset.label, description: preset.command, detail: 'No API key needed — uses the CLI\'s own login', preset });
		}
	}

	items.push({ label: 'API providers', kind: vscode.QuickPickItemKind.Separator });
	for (const preset of HOSTED_PRESETS) {
		items.push({ label: preset.label, description: preset.baseUrl, preset });
	}

	const undetected = CLI_PRESETS.filter(p => !detectedIds.has(p.id));
	if (undetected.length) {
		items.push({ label: 'CLI agents (not detected on PATH)', kind: vscode.QuickPickItemKind.Separator });
		for (const preset of undetected) {
			items.push({ label: preset.label, description: preset.command, preset });
		}
	}

	items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
	items.push({ label: '$(add) Add custom provider…', detail: 'Any OpenAI-compatible endpoint', custom: true });

	const picked = await vscode.window.showQuickPick(items, {
		title: 'AI Commit: choose a backend',
		placeHolder: 'Which backend should AI Commit use?',
		ignoreFocusOut: true,
	});

	if (!picked) {
		return undefined;
	}

	const profile = picked.custom ? await buildCustomProfile() : { ...picked.preset! };
	if (!profile) {
		return undefined;
	}

	if (profile.type !== 'cli' && !await secrets.get(secretKey(profile.id))) {
		const key = await promptForApiKey(profile);
		if (key === undefined) {
			return undefined;
		}
		if (key) {
			await secrets.store(secretKey(profile.id), key);
		}
	}

	if (profile.type !== 'cli' && !profile.model) {
		const model = await pickModel(profile, secrets);
		if (!model) {
			return undefined;
		}
		profile.model = model;
	}

	await saveProfile(profile, true);
	return profile;
}

export async function promptForApiKey(profile: ProviderProfile): Promise<string | undefined> {
	const isLocal = /localhost|127\.0\.0\.1/.test(profile.baseUrl ?? '');
	return vscode.window.showInputBox({
		title: `API key for ${profile.label}`,
		prompt: isLocal ? 'Leave blank if your local server does not require one' : 'Stored in the OS keychain, never in settings.json',
		password: true,
		ignoreFocusOut: true,
	});
}

async function buildCustomProfile(): Promise<ProviderProfile | undefined> {
	const label = await vscode.window.showInputBox({
		title: 'Custom provider (1/2)',
		prompt: 'A name for this provider',
		placeHolder: 'My Gateway',
		ignoreFocusOut: true,
		validateInput: value => value.trim() ? undefined : 'Enter a name',
	});
	if (!label) {
		return undefined;
	}

	const baseUrl = await vscode.window.showInputBox({
		title: 'Custom provider (2/2)',
		prompt: 'OpenAI-compatible base URL',
		placeHolder: 'https://example.com/v1',
		ignoreFocusOut: true,
		validateInput: value => {
			try {
				new URL(value);
				return undefined;
			} catch {
				return 'Enter a valid URL';
			}
		},
	});
	if (!baseUrl) {
		return undefined;
	}

	return {
		id: uniqueId(label),
		label: label.trim(),
		type: 'openai',
		baseUrl: baseUrl.trim(),
	};
}

function uniqueId(label: string): string {
	const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
	const taken = new Set(getProfiles().map(p => p.id));
	if (!taken.has(base)) {
		return base;
	}
	let n = 2;
	while (taken.has(`${base}-${n}`)) {
		n++;
	}
	return `${base}-${n}`;
}
