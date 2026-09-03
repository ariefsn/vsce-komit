import * as vscode from 'vscode';
import { createProvider, getProfiles, saveProfile } from '../providers/registry';
import type { ProviderProfile } from '../providers/types';

interface ProfileItem extends vscode.QuickPickItem {
	profile?: ProviderProfile;
	addNew?: boolean;
}

export async function pickProvider(activeId: string | undefined): Promise<ProviderProfile | 'add-new' | undefined> {
	const profiles = getProfiles();

	// detail always renders on a second row, so the check goes in the label.
	const items: ProfileItem[] = profiles.map(profile => ({
		label: profile.id === activeId ? `$(check) ${profile.label}` : profile.label,
		description: profile.model ?? profile.command,
		profile,
	}));

	items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
	items.push({ label: '$(add) Add a provider…', addNew: true });

	const picked = await vscode.window.showQuickPick(items, {
		title: 'Komit: select provider',
		placeHolder: profiles.length ? 'Switch the active provider' : 'No providers configured yet',
	});

	if (!picked) {
		return undefined;
	}
	return picked.addNew ? 'add-new' : picked.profile;
}

/**
 * Model picker (FR-6). Queries the provider's catalogue where the protocol supports
 * it. Where it does not, this falls back to free text without an error toast.
 */
export async function pickModel(profile: ProviderProfile, secrets: vscode.SecretStorage): Promise<string | undefined> {
	const models = await listModelsQuietly(profile, secrets);

	if (models.length === 0) {
		return vscode.window.showInputBox({
			title: `Model for ${profile.label}`,
			prompt: 'Model identifier',
			value: profile.model ?? '',
			ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : 'Enter a model id',
		});
	}

	const items: vscode.QuickPickItem[] = models.map(id => ({
		label: id,
		description: id === profile.model ? '$(check) Current' : undefined,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		title: `Model for ${profile.label}`,
		placeHolder: 'Pick a model',
		matchOnDescription: true,
		ignoreFocusOut: true,
	});

	return picked?.label;
}

async function listModelsQuietly(profile: ProviderProfile, secrets: vscode.SecretStorage): Promise<string[]> {
	try {
		const provider = await createProvider(profile, secrets, 15_000);
		return provider.listModels ? await provider.listModels() : [];
	} catch {
		// An endpoint without a catalogue is normal, not an error (FR-6).
		return [];
	}
}

export async function setModel(profile: ProviderProfile, model: string): Promise<void> {
	await saveProfile({ ...profile, model }, false);
}
