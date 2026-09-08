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

	return stripPostamble(unwrap(text));
}

const LIST_OR_HEADING = /^(?:[-*+]\s|\d+[.)]\s|#|>)/;
const TRAILER = /^[A-Za-z][A-Za-z-]*:\s/;

/** Starts a block of its own, so it never continues the line above. */
function startsBlock(line: string): boolean {
	return LIST_OR_HEADING.test(line) || TRAILER.test(line);
}

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
			&& !startsBlock(line.trimStart());

		if (continuation) {
			out[out.length - 1] = `${previous} ${line.trimStart()}`;
		} else {
			out.push(line);
		}
	}

	return out.join('\n');
}

/**
 * Openings that only ever introduce the model talking about its own answer.
 * Words that plausibly open a real body -- "however", "actually", a bare
 * "revised" -- are deliberately absent.
 */
const COMMENTARY = [
	/^notes?:/i,
	/^p\.?s\.?\b/i,
	/^here(?:'s| is)\b/i,
	/^alternatively\b/i,
	/^alternative(?: version)?:/i,
	/^or[,:]\s/i,
	/^if you (?:prefer|want|need)\b/i,
	/^(?:sorry|apologies)\b/i,
	/^let me know\b/i,
	/^(?:revised|shorter|updated|corrected)\b.*\bversion\b/i,
];

/**
 * A model that second-guesses a format rule tends to answer twice: the message,
 * a line explaining itself, then another message. Keep the first one and drop
 * everything from the explanation on.
 */
function stripPostamble(text: string): string {
	const lines = text.split('\n');
	const subject = lines[0]?.trim();
	let fenced = false;

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();

		if (line.startsWith('```')) {
			fenced = !fenced;
			continue;
		}

		// Only a paragraph of its own can be commentary; a bullet is body text.
		const opensParagraph = line !== '' && lines[i - 1].trim() === '';
		if (fenced || !opensParagraph || LIST_OR_HEADING.test(line)) {
			continue;
		}

		if (line === subject || COMMENTARY.some(marker => marker.test(line))) {
			return lines.slice(0, i).join('\n').trimEnd();
		}
	}

	return text;
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
