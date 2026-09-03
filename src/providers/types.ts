import type * as vscode from 'vscode';

export type ProviderType = 'cli' | 'openai' | 'anthropic';

export interface ProviderProfile {
	id: string;
	label: string;
	type: ProviderType;
	model?: string;
	/** cli */
	command?: string;
	promptArgs?: string[];
	extraArgs?: string[];
	/** openai | anthropic */
	baseUrl?: string;
}

export interface Provider {
	readonly profile: ProviderProfile;
	/** Human-readable destination, named in the FR-18 privacy notice. */
	readonly destination: string;
	generate(instruction: string, token: vscode.CancellationToken): Promise<string>;
	listModels?(): Promise<string[]>;
}

export interface HttpProviderOptions {
	apiKey: string;
	timeoutMs: number;
}
