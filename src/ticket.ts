export const DEFAULT_TICKET_PATTERN = '[A-Za-z]{2,}[A-Za-z0-9]*-\\d+';

/**
 * Pulls a ticket key out of the branch name — `feat/PAP-51-login` → `PAP-51`.
 *
 * Done here rather than asked of the model: a model told to find the ticket will
 * occasionally reformat it, grab an adjacent number, or invent one when the
 * branch has none.
 */
export function extractTicket(branch: string, pattern: string, uppercase: boolean): string | undefined {
	if (!branch || branch === 'HEAD') {
		return undefined;
	}

	let regex: RegExp;
	try {
		regex = new RegExp(pattern);
	} catch {
		// A malformed user pattern means "no ticket", never a failed generation.
		return undefined;
	}

	const match = regex.exec(branch);
	if (!match) {
		return undefined;
	}

	const key = match[0];
	return uppercase ? key.toUpperCase() : key;
}
