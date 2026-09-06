const PREAMBLES = [
	/^here(?:'s| is) (?:the |a )?(?:suggested |proposed )?commit message:?\s*/i,
	/^(?:suggested |proposed )?commit message:?\s*/i,
	/^sure[,!.]?\s*/i,
];

/** Cleans model output before it goes into the commit box (FR-15). */
export function normalize(raw: string): string {
	let text = raw.replace(/\r\n/g, '\n').trim();

	text = stripCodeFence(text);

	for (const preamble of PREAMBLES) {
		text = text.replace(preamble, '');
	}

	text = stripWrappingQuotes(text.trim());

	text = text
		.split('\n')
		.map(line => line.replace(/\s+$/, ''))
		.join('\n')
		.trim();

	return unwrap(text);
}

/** Starts a block of its own, so it never continues the line above. */
const BLOCK_START = /^(?:[-*+]\s|\d+[.)]\s|#|>|[A-Za-z][A-Za-z-]*:\s)/;

/**
 * Models often satisfy a character limit by hard-wrapping a bullet across
 * lines. The commit box and `git log` soft-wrap already, so those breaks are
 * noise: fold every continuation line back onto the line it belongs to.
 */
function unwrap(text: string): string {
	const out: string[] = [];
	let fenced = false;

	for (const line of text.split('\n')) {
		if (line.trimStart().startsWith('```')) {
			fenced = !fenced;
			out.push(line);
			continue;
		}

		const previous = out[out.length - 1];
		const continuation = !fenced
			&& line.trim() !== ''
			&& previous !== undefined
			&& previous.trim() !== ''
			&& !BLOCK_START.test(line.trimStart());

		if (continuation) {
			out[out.length - 1] = `${previous} ${line.trimStart()}`;
		} else {
			out.push(line);
		}
	}

	return out.join('\n');
}

function stripCodeFence(text: string): string {
	const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
	return fenced ? fenced[1] : text;
}

function stripWrappingQuotes(text: string): string {
	const pairs: [string, string][] = [['"', '"'], ["'", "'"], ['`', '`']];
	for (const [open, close] of pairs) {
		if (text.length > 1 && text.startsWith(open) && text.endsWith(close)) {
			const inner = text.slice(1, -1);
			// Only strip when the quotes actually wrap the whole string.
			if (!inner.includes(close)) {
				return inner;
			}
		}
	}
	return text;
}
