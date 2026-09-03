import * as vscode from 'vscode';
import { DEFAULT_COMMIT_TYPES, type BodyStyle, type Limits, type ScopeSource, type StyleOptions } from './prompt/default';
import { DEFAULT_TICKET_PATTERN, extractTicket } from './ticket';

export type PrivacyNotice = 'once' | 'always' | 'never';

function config() {
	return vscode.workspace.getConfiguration('komit');
}

function counts(key: string, fallback: number[]): number[] {
	const value = config().get<number[]>(key);
	return Array.isArray(value) && value.length && value.every(n => Number.isFinite(n) && n > 0)
		? value
		: fallback;
}

export function limits(): Limits {
	return {
		bodyBullets: counts('limits.bodyBullets', [2, 4]),
		prSummaryBullets: counts('limits.prSummaryBullets', [1, 2]),
		prChangesBullets: counts('limits.prChangesBullets', [3, 6]),
		bulletChars: config().get<number>('limits.bulletChars') ?? 80,
		subjectChars: config().get<number>('limits.subjectChars') ?? 72,
	};
}

export function styleOptions(branch = ''): StyleOptions {
	const types = config().get<string[]>('commitTypes');

	return {
		conventionalCommits: config().get<boolean>('conventionalCommits') ?? true,
		commitTypes: types?.length ? types : DEFAULT_COMMIT_TYPES,
		bodyStyle: config().get<BodyStyle>('bodyStyle') ?? 'bullets',
		scopeSource: config().get<ScopeSource>('scopeSource') ?? 'auto',
		limits: limits(),
		ticket: ticketFor(branch),
	};
}

export function ticketFor(branch: string): string | undefined {
	return extractTicket(
		branch,
		config().get<string>('ticketPattern') || DEFAULT_TICKET_PATTERN,
		config().get<boolean>('ticketUppercase') ?? true,
	);
}

export function signature(): string[] {
	return (config().get<string[]>('signature') ?? [])
		.map(line => line.trim())
		.filter(Boolean);
}

export function privacyNotice(): PrivacyNotice {
	return config().get<PrivacyNotice>('privacyNotice') ?? 'once';
}
