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

	// Git pathspec has no re-include, and an exclusion always beats a positive
	// pathspec for the same path. So includeGlobs needs its own pass, which gets
	// concatenated. That is what keeps .env out while .env.example still goes.
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

export interface BranchContext {
	base: string;
	commits: string[];
	stat: string;
	diff: string;
	truncated: boolean;
	branch: string;
}

/**
 * Resolves the branch a PR would target. A wrong base quietly produces a
 * description of somebody else's work, so the result is shown to the user.
 */
export async function resolveBaseBranch(
	gitPath: string,
	cwd: string,
	configured: string,
): Promise<string | undefined> {
	if (configured.trim()) {
		return configured.trim();
	}

	const remoteHead = (await runGit(gitPath, cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
		.catch(() => '')).trim();
	if (remoteHead) {
		return remoteHead.replace('refs/remotes/', '');
	}

	for (const candidate of ['main', 'master', 'develop']) {
		const exists = await runGit(gitPath, cwd, ['rev-parse', '--verify', '--quiet', candidate])
			.then(() => true)
			.catch(() => false);
		if (exists) {
			return candidate;
		}
	}

	return undefined;
}

export async function listBranches(gitPath: string, cwd: string): Promise<string[]> {
	const out = await runGit(gitPath, cwd, ['branch', '--format=%(refname:short)']).catch(() => '');
	return out.split('\n').map(l => l.trim()).filter(Boolean);
}

export async function collectBranchContext(
	gitPath: string,
	repo: GitRepository,
	base: string,
	options: { excludeGlobs: string[]; includeGlobs: string[]; maxDiffBytes: number },
): Promise<BranchContext> {
	const cwd = repo.rootUri.fsPath;
	const pathspecs = toPathspecs(options.excludeGlobs);

	const included = options.includeGlobs.filter(g => g.trim()).map(g => `:(glob)${g.trim()}`);
	const extra = (args: string[]) => included.length
		? runGit(gitPath, cwd, [...args, '--', ...included]).catch(() => '')
		: Promise.resolve('');

	// Three dots: diff from the merge-base, so this shows only what the branch
	// changed. Two dots would fold in whatever landed on the base meanwhile.
	const range = `${base}...HEAD`;

	const [log, stat, rawDiff, extraStat, extraDiff, branch] = await Promise.all([
		runGit(gitPath, cwd, ['log', `${base}..HEAD`, '--format=%s%n%b%n--']).catch(() => ''),
		runGit(gitPath, cwd, ['diff', range, '--stat', '--', ...pathspecs]),
		runGit(gitPath, cwd, ['diff', range, '--no-color', '--', ...pathspecs]),
		extra(['diff', range, '--stat']),
		extra(['diff', range, '--no-color']),
		runGit(gitPath, cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
	]);

	const merged = join(rawDiff, extraDiff);
	const truncated = Buffer.byteLength(merged, 'utf8') > options.maxDiffBytes;

	return {
		base,
		commits: log.split('\n--\n').map(c => c.trim()).filter(Boolean),
		stat: join(stat, extraStat).trim(),
		diff: truncated
			? Buffer.from(merged, 'utf8').subarray(0, options.maxDiffBytes).toString('utf8')
			: merged.trim(),
		truncated,
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
