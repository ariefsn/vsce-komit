import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { KomitError } from '../errors';
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

	return repoOwningActiveEditor(repos) ?? repos[0];
}

/** Longest matching root wins, so a repository nested inside another still claims its own files. */
function repoOwningActiveEditor(repos: GitRepository[]): GitRepository | undefined {
	const active = vscode.window.activeTextEditor?.document.uri;
	if (!active) {
		return undefined;
	}

	return repos
		.filter(r => active.fsPath.startsWith(r.rootUri.fsPath))
		.sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
}

/** Folder name of the repository, which is what people call it in conversation. */
export function repoName(repo: GitRepository): string {
	return basename(repo.rootUri.fsPath);
}

/**
 * Name to put in front of a progress or result message, so that with several
 * repositories open it is clear which one is running. Undefined for a lone
 * repository, where the name would be noise.
 */
export function repoLabel(api: GitAPI, repo: GitRepository): string | undefined {
	return api.repositories.length > 1 ? repoName(repo) : undefined;
}

interface RepoItem extends vscode.QuickPickItem {
	repo: GitRepository;
}

/**
 * Resolves the repository, asking when there is real ambiguity. VS Code exposes
 * no way to read which Source Control section has focus, so a command invoked
 * from the palette in a multi-repository workspace has to ask rather than guess.
 * A command invoked from a repository's own SCM menu carries its rootUri and
 * never prompts.
 */
export async function pickRepository(
	api: GitAPI,
	rootUri: vscode.Uri | undefined,
): Promise<GitRepository | undefined> {
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

	// Only the editor owner earns the check. resolveRepository's last resort is
	// "whichever came first", which is exactly the guess this picker exists to
	// stop making, so it must not be dressed up as a recommendation.
	const guess = repoOwningActiveEditor(repos);
	const ordered = [...repos].sort((a, b) => rank(a, guess) - rank(b, guess));

	// detail always renders on a second row, so the check goes in the label.
	const items: RepoItem[] = ordered.map(repo => ({
		label: repo === guess ? `$(check) ${repoName(repo)}` : `$(repo) ${repoName(repo)}`,
		description: [repo.state.HEAD?.name, repo === guess ? 'active editor' : undefined]
			.filter(Boolean).join(' · '),
		detail: vscode.workspace.asRelativePath(repo.rootUri, true),
		repo,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		title: 'Komit: which repository?',
		placeHolder: 'Pick the repository to work on',
		matchOnDetail: true,
	});

	return picked?.repo;
}

/** Best guess first, then repositories with staged changes, then the rest. */
function rank(repo: GitRepository, guess: GitRepository | undefined): number {
	if (repo === guess) {
		return 0;
	}
	return hasStagedChanges(repo) ? 1 : 2;
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

export interface BasePreselection {
	branch: string;
	/** Where the suggestion came from, shown next to it in the picker. */
	source: string;
}

/**
 * Suggests the branch a PR would target. A wrong base quietly produces a
 * description of somebody else's work, so this only pre-selects and the user
 * confirms. Every candidate is checked against this repository, which is what
 * lets one workspace hold repositories with different bases: a `komit.baseBranch`
 * of `dev` simply does not apply to a repository that has no `dev`.
 */
export async function resolveBaseBranch(
	gitPath: string,
	cwd: string,
	configured: string,
	lastUsed: string | undefined,
): Promise<BasePreselection | undefined> {
	if (lastUsed?.trim() && await refExists(gitPath, cwd, lastUsed.trim())) {
		return { branch: lastUsed.trim(), source: 'last used' };
	}

	if (configured.trim() && await refExists(gitPath, cwd, configured.trim())) {
		return { branch: configured.trim(), source: 'from komit.baseBranch' };
	}

	const remoteHead = (await runGit(gitPath, cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
		.catch(() => '')).trim();
	if (remoteHead) {
		return { branch: remoteHead.replace('refs/remotes/', ''), source: 'detected' };
	}

	for (const candidate of ['main', 'master', 'develop']) {
		if (await refExists(gitPath, cwd, candidate)) {
			return { branch: candidate, source: 'detected' };
		}
	}

	return undefined;
}

function refExists(gitPath: string, cwd: string, ref: string): Promise<boolean> {
	return runGit(gitPath, cwd, ['rev-parse', '--verify', '--quiet', ref])
		.then(() => true)
		.catch(() => false);
}

/**
 * Local and remote branches. Remotes have to be in here: the detected base is
 * usually `origin/main`, which `git branch` alone would never list.
 */
export async function listBranches(gitPath: string, cwd: string): Promise<string[]> {
	const out = await runGit(gitPath, cwd, [
		'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes',
	]).catch(() => '');

	return out.split('\n')
		.map(l => l.trim())
		.filter(l => l && !l.endsWith('/HEAD'));
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
		child.on('error', err => reject(new KomitError(`Could not run git: ${err.message}`)));
		child.on('close', code => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new KomitError(`git ${args[0]} failed: ${stderr.trim() || `exit code ${code}`}`));
			}
		});
	});
}
