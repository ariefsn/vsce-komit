import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { AiCommitError, MANAGE_TRUST, SELECT_PROVIDER } from '../errors';
import { CliProvider } from './cli';
import { AnthropicProvider, OpenAiProvider } from './http';
import type { Provider, ProviderProfile } from './types';

/** Built-in profiles offered by the setup QuickPick (§5.1). */
export const CLI_PRESETS: ProviderProfile[] = [
	{ id: 'claude-cli', label: 'Claude Code (subscription)', type: 'cli', command: 'claude', promptArgs: ['-p'] },
	{ id: 'codex-cli', label: 'Codex CLI (subscription)', type: 'cli', command: 'codex', promptArgs: ['exec'] },
	{ id: 'gemini-cli', label: 'Gemini CLI (subscription)', type: 'cli', command: 'gemini', promptArgs: ['-p'] },
	{ id: 'opencode-cli', label: 'OpenCode (subscription)', type: 'cli', command: 'opencode', promptArgs: ['run'] },
];

export const HOSTED_PRESETS: ProviderProfile[] = [
	{ id: 'anthropic', label: 'Anthropic API', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5' },
	{ id: 'openai', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' },
	{ id: 'openrouter', label: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
	{ id: 'groq', label: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
	{ id: 'deepseek', label: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com' },
	{ id: 'glm', label: 'GLM (Zhipu)', type: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
	{ id: 'sumopod', label: 'SumoPod', type: 'openai', baseUrl: 'https://ai.sumopod.com/v1' },
	{ id: 'ollama', label: 'Ollama (local)', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
	{ id: 'lmstudio', label: 'LM Studio (local)', type: 'openai', baseUrl: 'http://localhost:1234/v1' },
];

export function getProfiles(): ProviderProfile[] {
	return vscode.workspace.getConfiguration('aicommit').get<ProviderProfile[]>('providers') ?? [];
}

export function getActiveProfile(): ProviderProfile | undefined {
	const id = vscode.workspace.getConfiguration('aicommit').get<string>('activeProvider');
	if (!id) {
		return undefined;
	}
	return getProfiles().find(p => p.id === id);
}

export async function saveProfile(profile: ProviderProfile, makeActive: boolean): Promise<void> {
	const config = vscode.workspace.getConfiguration('aicommit');
	const profiles = getProfiles().filter(p => p.id !== profile.id);
	profiles.push(profile);

	await config.update('providers', profiles, vscode.ConfigurationTarget.Global);
	if (makeActive) {
		await config.update('activeProvider', profile.id, vscode.ConfigurationTarget.Global);
	}
}

export function secretKey(profileId: string): string {
	return `aicommit.apiKey.${profileId}`;
}

/** Probes PATH so the setup QuickPick can list CLI agents the user already has. */
export async function detectCliPresets(): Promise<ProviderProfile[]> {
	const found = await Promise.all(CLI_PRESETS.map(async preset => (
		await isOnPath(preset.command!) ? preset : undefined
	)));
	return found.filter((p): p is ProviderProfile => p !== undefined);
}

function isOnPath(command: string): Promise<boolean> {
	return new Promise(resolve => {
		const child = spawn(process.platform === 'win32' ? 'where' : 'which', [command]);
		child.on('error', () => resolve(false));
		child.on('close', code => resolve(code === 0));
	});
}

export async function createProvider(
	profile: ProviderProfile,
	secrets: vscode.SecretStorage,
	timeoutMs: number,
): Promise<Provider> {
	if (profile.type === 'cli') {
		// FR-19: a repository must never be able to choose a binary to run.
		if (!vscode.workspace.isTrusted) {
			throw new AiCommitError(
				`"${profile.label}" runs a program, which is blocked in an untrusted workspace. Trust this folder, or switch to an API provider.`,
				[MANAGE_TRUST, SELECT_PROVIDER],
			);
		}
		return new CliProvider(profile, timeoutMs);
	}

	const apiKey = await secrets.get(secretKey(profile.id)) ?? '';
	return profile.type === 'anthropic'
		? new AnthropicProvider(profile, apiKey, timeoutMs)
		: new OpenAiProvider(profile, apiKey, timeoutMs);
}
