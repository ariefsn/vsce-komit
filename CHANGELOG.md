# Change Log

## [0.3.1]

- Use a codicon for the toolbar button, which fixes it sometimes rendering blank
- Make bullet counts and line lengths configurable under `aicommit.limits`
- Say "provider" everywhere instead of mixing it with "backend"

## [0.3.0]

- Generate a PR title and description for the whole branch, opened in an editor and copied to the clipboard
- Fill in `.github/pull_request_template.md` when the repository has one
- Add `AI Commit: Regenerate Commit Message` for a different take

## [0.2.1]

- Show the active provider inline in the picker instead of on a second line

## [0.2.0]

- Use the ticket key from the branch name as the scope, e.g. `feat(PAP-51):`
- Exclude `.env`, private keys and other secret files by default, while still sending `.env.example`
- Add `AI Commit: Configure`, putting every setting in one place at user or workspace scope
- Make the privacy notice configurable: once, always, or never
- Drop trailers whose variables resolve to nothing, instead of committing a bare `Refs:`

## [0.1.2]

- Conventional Commits prefix and a bullet body by default, both configurable
- Add `AI Commit: Edit Prompt` and `AI Commit: Edit Signature`
- Support git trailers such as `Co-authored-by`, appended exactly

## [0.1.1]

- Fix the button never enabling, and generate real messages from staged changes
- Add provider setup, model selection and API key storage

## [0.0.3]

- Custom toolbar icon, so the button is distinguishable from other AI extensions

## [0.0.2]

- Move the button to the Source Control title toolbar and the Commit dropdown
- Work in untrusted workspaces with reduced capability

## [0.0.1]

- Initial scaffold
