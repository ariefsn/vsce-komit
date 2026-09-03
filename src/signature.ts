import { render, type TemplateVars } from './prompt/render';

const TRAILER = /^[A-Za-z][A-Za-z0-9-]*:\s*\S/;

/**
 * Appends git trailers to the finished message.
 *
 * These are added here rather than asked of the model. A trailer has to be exact
 * for git and GitHub to parse it, and a model will paraphrase names, mistype
 * addresses, or drop the line on a long diff.
 */
export function appendSignature(message: string, lines: string[], vars: TemplateVars): string {
	if (lines.length === 0) {
		return message;
	}

	const existing = message.split('\n').map(l => l.trim());

	const trailers = lines
		.map(line => render(line, vars).trim())
		// A variable that resolves to nothing leaves a bare "Refs:", so drop it
		// rather than commit a malformed trailer.
		.filter(line => TRAILER.test(line) && !existing.includes(line));

	return trailers.length ? `${message}\n\n${trailers.join('\n')}` : message;
}
