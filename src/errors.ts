import * as vscode from 'vscode';

export interface ErrorAction {
	title: string;
	command: string;
}

/** An error with a next step attached, per FR-16. */
export class AiCommitError extends Error {
	readonly actions: ErrorAction[];

	constructor(message: string, actions: ErrorAction[] = []) {
		super(message);
		this.name = 'AiCommitError';
		this.actions = actions;
	}
}

export const MANAGE_TRUST: ErrorAction = {
	title: 'Manage Workspace Trust',
	command: 'workbench.trust.manage',
};

export const SELECT_PROVIDER: ErrorAction = {
	title: 'Select Provider',
	command: 'aicommit.selectProvider',
};

export const SELECT_MODEL: ErrorAction = {
	title: 'Select Model',
	command: 'aicommit.selectModel',
};

export async function showError(error: unknown): Promise<void> {
	if (error instanceof vscode.CancellationError) {
		return;
	}

	const err = error instanceof AiCommitError
		? error
		: new AiCommitError(error instanceof Error ? error.message : String(error));

	const picked = await vscode.window.showErrorMessage(
		`AI Commit: ${err.message}`,
		...err.actions.map(a => a.title),
	);

	const action = err.actions.find(a => a.title === picked);
	if (action) {
		await vscode.commands.executeCommand(action.command);
	}
}
