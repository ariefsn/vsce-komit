import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { AiCommitError } from '../errors';
import type { GitAPI, GitRepository } from './api';
import { toPathspecs } from './pathspec';

export interface StagedContext {
	stat: string;
	diff: string;
	truncated: boolean;
	recentCommits: string[];
	branch: string;
}

/**
 * Resolves which repository the command applies to (FR-13): the SourceControl the
 * button was clicked in, else the sole repository, else the one owning the active
 * editor, else the first.
 */
export function resolveRepository(api: GitAPI, rootUri: vscode.Uri | undefined): GitRepository | undefined {
	const repos = api.repositories;
	if (repos.length === 0) {
		return undefined;
	}

	if (rootUri) {
		const match = repos.find(r => r.rootUri.toString() === rootUri.toString());
		if (match) {
			return match;
		}
	}

	if (repos.length === 1) {
		return repos[0];
	}

	const active = vscode.window.activeTextEditor?.document.uri;
	if (active) {
		const owner = repos
			.filter(r => active.fsPath.startsWith(r.rootUri.fsPath))
			.sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
		if (owner) {
			return owner;
		}
	}

	return repos[0];
}

export function hasStagedChanges(repo: GitRepository): boolean {
	return repo.state.indexChanges.length > 0;
}

export async function collectContext(
	gitPath: string,
	repo: GitRepository,
	options: { excludeGlobs: string[]; includeGlobs: string[]; maxDiffBytes: number; recentCommitCount: number },
): Promise<StagedContext> {
	const cwd = repo.rootUri.fsPath;
	const pathspecs = toPathspecs(options.excludeGlobs);

	// Git pathspec has no re-include — an exclusion always beats a positive
	// pathspec for the same path — so anything in includeGlobs needs its own
	// pass, which is then concatenated. This is what keeps .env excluded while
	// .env.example still reaches the model.
	const included = options.includeGlobs.filter(g => g.trim());
	const includeSpecs = included.map(g => `:(glob)${g.trim()}`);
	const extra = (args: string[]) => includeSpecs.length
		? runGit(gitPath, cwd, [...args, '--', ...includeSpecs]).catch(() => '')
		: Promise.resolve('');

	const [stat, rawDiff, extraStat, extraDiff, log, branch] = await Promise.all([
		runGit(gitPath, cwd, ['diff', '--cached', '--stat', '--', ...pathspecs]),
		runGit(gitPath, cwd, ['diff', '--cached', '--no-color', '--', ...pathspecs]),
		extra(['diff', '--cached', '--stat']),
		extra(['diff', '--cached', '--no-color']),
		options.recentCommitCount > 0
			? runGit(gitPath, cwd, ['log', '-n', String(options.recentCommitCount), '--format=%s']).catch(() => '')
			: Promise.resolve(''),
		runGit(gitPath, cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
	]);

	const merged = join(rawDiff, extraDiff);
	const truncated = Buffer.byteLength(merged, 'utf8') > options.maxDiffBytes;
	const diff = truncated
		? Buffer.from(merged, 'utf8').subarray(0, options.maxDiffBytes).toString('utf8')
		: merged;

	return {
		stat: join(stat, extraStat).trim(),
		diff: diff.trim(),
		truncated,
		recentCommits: log.split('\n').map(l => l.trim()).filter(Boolean),
		branch: branch.trim(),
	};
}

function join(primary: string, extra: string): string {
	const a = primary.trimEnd();
	const b = extra.trim();
	if (!b) {
		return primary;
	}
	return a ? `${a}\n${b}\n` : `${b}\n`;
}

export function runGit(gitPath: string, cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(gitPath, args, { cwd });
		let stdout = '';
		let stderr = '';

		child.stdout.on('data', chunk => { stdout += chunk; });
		child.stderr.on('data', chunk => { stderr += chunk; });
		child.on('error', err => reject(new AiCommitError(`Could not run git: ${err.message}`)));
		child.on('close', code => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new AiCommitError(`git ${args[0]} failed: ${stderr.trim() || `exit code ${code}`}`));
			}
		});
	});
}
