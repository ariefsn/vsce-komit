import * as vscode from 'vscode';

/** Minimal shape of the built-in Git extension API (vscode.git), typed locally to avoid a dependency. */

export interface GitChange {
	readonly uri: vscode.Uri;
}

export interface GitRepositoryState {
	readonly indexChanges: GitChange[];
	readonly workingTreeChanges: GitChange[];
	readonly onDidChange: vscode.Event<void>;
}

export interface GitRepository {
	readonly rootUri: vscode.Uri;
	readonly inputBox: { value: string };
	readonly state: GitRepositoryState;
	add(paths: string[]): Promise<void>;
}

export interface GitAPI {
	readonly git: { readonly path: string };
	readonly repositories: GitRepository[];
	readonly onDidOpenRepository: vscode.Event<GitRepository>;
	readonly onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: vscode.Event<boolean>;
	getAPI(version: 1): GitAPI;
}

export async function getGitAPI(): Promise<GitAPI | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return undefined;
	}

	const exports = extension.isActive ? extension.exports : await extension.activate();
	return exports.enabled ? exports.getAPI(1) : undefined;
}
