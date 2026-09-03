import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { AiCommitError } from '../errors';
import type { Provider, ProviderProfile } from './types';

export class CliProvider implements Provider {
	constructor(readonly profile: ProviderProfile, private readonly timeoutMs: number) { }

	get destination(): string {
		return `the ${this.profile.command} CLI on this machine`;
	}

	generate(instruction: string, token: vscode.CancellationToken): Promise<string> {
		const command = this.profile.command;
		if (!command) {
			throw new AiCommitError(`Provider "${this.profile.label}" has no command configured.`);
		}

		const args = [...(this.profile.promptArgs ?? []), ...(this.profile.extraArgs ?? [])];

		return new Promise<string>((resolve, reject) => {
			const child = spawn(command, args, { shell: false });
			let stdout = '';
			let stderr = '';
			let settled = false;

			const finish = (fn: () => void) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					subscription.dispose();
					fn();
				}
			};

			const timer = setTimeout(() => {
				child.kill();
				finish(() => reject(new AiCommitError(
					`${command} did not respond within ${Math.round(this.timeoutMs / 1000)}s. Change aicommit.timeoutSeconds to allow longer.`,
				)));
			}, this.timeoutMs);

			const subscription = token.onCancellationRequested(() => {
				child.kill();
				finish(() => reject(new vscode.CancellationError()));
			});

			child.stdout.on('data', chunk => { stdout += chunk; });
			child.stderr.on('data', chunk => { stderr += chunk; });

			child.on('error', (err: NodeJS.ErrnoException) => {
				finish(() => reject(err.code === 'ENOENT'
					? new AiCommitError(
						`"${command}" was not found on PATH. The editor does not always inherit your shell's PATH, so try launching it from a terminal, or set an absolute path in aicommit.providers.`,
					)
					: new AiCommitError(`Could not start ${command}: ${err.message}`),
				));
			});

			child.on('close', code => {
				finish(() => {
					if (code !== 0) {
						const detail = stderr.trim() || `exit code ${code}`;
						reject(/not.*(logged in|authenticated)|unauthorized|login/i.test(detail)
							? new AiCommitError(`${command} is not authenticated. Run "${command}" once in a terminal to log in.`)
							: new AiCommitError(`${command} failed: ${detail}`),
						);
					} else if (!stdout.trim()) {
						reject(new AiCommitError(`${command} returned nothing.`));
					} else {
						resolve(stdout);
					}
				});
			});

			child.stdin.on('error', () => { /* closed early; the exit handler reports it */ });
			child.stdin.end(instruction);
		});
	}
}
