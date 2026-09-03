import * as vscode from 'vscode';

export interface ErrorAction {
	title: string;
	command: string;
}

/** An error with a next step attached, per FR-16. */
export class KomitError extends Error {
	readonly actions: ErrorAction[];

	constructor(message: string, actions: ErrorAction[] = []) {
		super(message);
		this.name = 'KomitError';
		this.actions = actions;
	}
}

export const MANAGE_TRUST: ErrorAction = {
	title: 'Manage Workspace Trust',
	command: 'workbench.trust.manage',
};

export const SELECT_PROVIDER: ErrorAction = {
	title: 'Select Provider',
	command: 'komit.selectProvider',
};

export const SELECT_MODEL: ErrorAction = {
	title: 'Select Model',
	command: 'komit.selectModel',
};

export async function showError(error: unknown): Promise<void> {
	if (error instanceof vscode.CancellationError) {
		return;
	}

	const err = error instanceof KomitError
		? error
		: new KomitError(error instanceof Error ? error.message : String(error));

	const picked = await vscode.window.showErrorMessage(
		`Komit: ${err.message}`,
		...err.actions.map(a => a.title),
	);

	const action = err.actions.find(a => a.title === picked);
	if (action) {
		await vscode.commands.executeCommand(action.command);
	}
}
