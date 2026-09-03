/**
 * Turns exclusion globs into git pathspecs so filtering happens at diff time
 * rather than afterwards (FR-10).
 */
export function toPathspecs(globs: string[]): string[] {
	const specs = ['.'];
	for (const glob of globs) {
		const trimmed = glob.trim();
		if (trimmed) {
			specs.push(`:(exclude,glob)${trimmed}`);
		}
	}
	return specs;
}
