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

	return text
		.split('\n')
		.map(line => line.replace(/\s+$/, ''))
		.join('\n')
		.trim();
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
