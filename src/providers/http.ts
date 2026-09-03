import * as vscode from 'vscode';
import { KomitError, SELECT_MODEL, SELECT_PROVIDER } from '../errors';
import type { Provider, ProviderProfile } from './types';

/** Shared request plumbing for the HTTP-based provider classes. */
abstract class HttpProvider implements Provider {
	constructor(
		readonly profile: ProviderProfile,
		protected readonly apiKey: string,
		protected readonly timeoutMs: number,
	) { }

	get destination(): string {
		try {
			return new URL(this.baseUrl).host;
		} catch {
			return this.baseUrl;
		}
	}

	protected get baseUrl(): string {
		const url = this.profile.baseUrl;
		if (!url) {
			throw new KomitError(`Provider "${this.profile.label}" has no base URL configured.`, [SELECT_PROVIDER]);
		}
		return url.replace(/\/+$/, '');
	}

	abstract generate(instruction: string, token: vscode.CancellationToken): Promise<string>;

	protected async request(path: string, init: RequestInit, token: vscode.CancellationToken): Promise<unknown> {
		const controller = new AbortController();
		const subscription = token.onCancellationRequested(() => controller.abort());
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);

		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
		} catch (err) {
			if (token.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			if (err instanceof Error && err.name === 'AbortError') {
				throw new KomitError(
					`${this.destination} did not respond within ${Math.round(this.timeoutMs / 1000)}s. Change komit.timeoutSeconds to allow longer.`,
				);
			}
			throw new KomitError(`Could not reach ${this.destination}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			clearTimeout(timer);
			subscription.dispose();
		}

		if (!response.ok) {
			throw await this.describeFailure(response);
		}

		return response.json();
	}

	private async describeFailure(response: Response): Promise<KomitError> {
		const body = await response.text().catch(() => '');
		const detail = body.slice(0, 300).trim();

		switch (response.status) {
			case 401:
			case 403:
				return new KomitError(
					`${this.destination} rejected the API key. Re-enter it for "${this.profile.label}".`,
					[SELECT_PROVIDER],
				);
			case 404:
				return new KomitError(
					`${this.destination} does not know the model "${this.profile.model}". Pick a different one.`,
					[SELECT_MODEL],
				);
			case 429:
				return new KomitError(`${this.destination} is rate limiting this key. Wait and try again.`);
			default:
				return new KomitError(`${this.destination} returned ${response.status}. ${detail}`);
		}
	}
}

interface OpenAiResponse {
	choices?: { message?: { content?: string } }[];
}

interface OpenAiModels {
	data?: { id?: string }[];
}

export class OpenAiProvider extends HttpProvider {
	async generate(instruction: string, token: vscode.CancellationToken): Promise<string> {
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (this.apiKey) {
			headers.authorization = `Bearer ${this.apiKey}`;
		}

		const json = await this.request('/chat/completions', {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: this.profile.model,
				messages: [{ role: 'user', content: instruction }],
				max_tokens: 512,
			}),
		}, token) as OpenAiResponse;

		const text = json.choices?.[0]?.message?.content;
		if (!text) {
			throw new KomitError(`${this.destination} returned an empty response.`);
		}
		return text;
	}

	async listModels(): Promise<string[]> {
		const headers: Record<string, string> = {};
		if (this.apiKey) {
			headers.authorization = `Bearer ${this.apiKey}`;
		}

		const source = new vscode.CancellationTokenSource();
		try {
			const json = await this.request('/models', { method: 'GET', headers }, source.token) as OpenAiModels;
			return (json.data ?? []).map(m => m.id).filter((id): id is string => Boolean(id)).sort();
		} finally {
			source.dispose();
		}
	}
}

interface AnthropicResponse {
	content?: { type?: string; text?: string }[];
}

export class AnthropicProvider extends HttpProvider {
	async generate(instruction: string, token: vscode.CancellationToken): Promise<string> {
		const json = await this.request('/v1/messages', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: this.profile.model,
				max_tokens: 512,
				messages: [{ role: 'user', content: instruction }],
			}),
		}, token) as AnthropicResponse;

		const text = json.content?.find(block => block.type === 'text')?.text;
		if (!text) {
			throw new KomitError(`${this.destination} returned an empty response.`);
		}
		return text;
	}
}
