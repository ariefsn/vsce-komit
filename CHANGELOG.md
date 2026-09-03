# Change Log

## [0.2.0]

- Use the ticket key from the branch name as the scope, e.g. `feat(PAP-51):`
- Exclude `.env`, private keys and other secret files by default, while still sending `.env.example`
- Add `AI Commit: Configure` — every setting in one place, at user or workspace scope
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
