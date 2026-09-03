# AI Commit

Commit messages and PR descriptions written from your actual changes — using whatever AI backend you already have.

```
feat(PAP-51): add commit message generation

- Wire the generate button into the Source Control toolbar
- Add cli, openai and anthropic provider classes
- Store API keys in SecretStorage, never in settings.json
```

## Privacy

- **Your staged diff is sent to whichever provider you configure.** With a hosted API that means it leaves your machine. With a local model (Ollama, LM Studio) or a CLI agent it does not. The extension names the destination and asks for acknowledgement before the first request.
- **Zero telemetry.** No analytics, no usage pings, no crash reporting.
- **API keys live in VS Code's `SecretStorage`**, never in `settings.json`. Set once — it persists across restarts.
- **Secret files are excluded by default** — `.env`, `*.pem`, `*.key`, `id_rsa` and similar never leave your machine. But exclusions are a filter, not a guarantee: a secret pasted into an ordinary source file would still be sent.

## Getting started

1. Stage some changes.
2. Click the AI Commit icon in the Source Control toolbar, just above the commit box.
3. Pick a backend. Any AI CLI already on your `PATH` — `claude`, `codex`, `gemini`, `opencode` — appears at the top and **needs no API key**, because it uses the CLI's own login. That is the fastest route.

   ![Choosing a backend on first run](https://raw.githubusercontent.com/ariefsn/vsce-aicommit/main/assets/showcase/select-provider-engine.png)

4. The message appears in the commit box. Edit it if you like, then commit.

Not happy with what you got? **AI Commit: Regenerate Commit Message** asks again for a different angle, rather than rewording the same one.

There is no configuration step. Everything below is optional.

## Commands

- AI Commit: Generate Commit Message
  > Write a message from the staged changes. Also the toolbar button.
- AI Commit: Regenerate Commit Message
  > Not happy with it? Get a genuinely different take, not a rephrasing.
- AI Commit: Generate PR Description
  > Write a PR title and description for the whole branch.
- AI Commit: Configure
  > Every setting in one list, each showing its current value.
- AI Commit: Select Provider
  > Switch backends, or add a new one.
- AI Commit: Select Model
  > Pick a model for the active provider.
- AI Commit: Edit Prompt
  > Customize the instructions, for you or for the repository.
- AI Commit: Edit Signature
  > Add trailers such as `Co-authored-by`.
- AI Commit: Open Settings
  > Jump to the settings page.

## Providers

| Class | How it talks | Auth | Works with |
| --- | --- | --- | --- |
| `cli` | Spawns the binary, context via stdin | The CLI's own login — no API key | `claude`, `codex`, `gemini`, `opencode` |
| `openai` | `POST {baseUrl}/chat/completions` | Bearer token | OpenAI, OpenRouter, Groq, DeepSeek, GLM (Zhipu), SumoPod, Together, Ollama, LM Studio, vLLM |
| `anthropic` | `POST {baseUrl}/v1/messages` | `x-api-key` | Anthropic API |

Because the `openai` class takes an arbitrary `baseUrl`, any OpenAI-compatible endpoint works — including ones not listed. Add one via **AI Commit: Select Provider → Add custom provider…**

Keep as many as you like and switch between them in one command — a fast cheap model for routine commits, a stronger one when it matters:

![Switching the active provider](https://raw.githubusercontent.com/ariefsn/vsce-aicommit/main/assets/showcase/select-provider.png)

Defaults aim at the cheapest model that still writes a good message. Change it with **AI Commit: Select Model**, which lists whatever the provider actually offers:

![Picking a model](https://raw.githubusercontent.com/ariefsn/vsce-aicommit/main/assets/showcase/select-model.png)

Where an endpoint has no model catalogue, the picker falls back to plain text entry rather than erroring.

## PR descriptions

**AI Commit: Generate PR Description** writes the title and body for a whole branch, opens it in a Markdown editor, and copies it to the clipboard — so it works with the GitHub web UI, the CLI, or any other workflow.

```markdown
feat(PAP-51): rework auth with token refresh

## Summary
- Replaces session cookies with short-lived tokens so expiry no longer
  bounces users back to sign-in

## Changes
- Adds the login form, validation and error states
- Refreshes expired tokens in the auth interceptor
- Covers the refresh path and expiry boundary with unit tests
```

![Generating a PR description](https://raw.githubusercontent.com/ariefsn/vsce-aicommit/main/assets/showcase/generate-pr.png)

It reads your commits for the narrative, the file summary for scope, and the diff for detail. Changes are grouped by concern rather than listed per file, so the description stays the same length whether the branch touched 3 files or 30.

The diff is taken from the merge base (`base...HEAD`), so anything that landed on the base branch after you branched off stays out of your description.

The base branch is detected from `origin/HEAD`, then `main`, `master` or `develop`; set `aicommit.baseBranch` to pin it, and the branch actually used is named in the progress message. If your repository has a `.github/pull_request_template.md`, that structure is filled in instead of the default sections.

## Configuring

Three routes, all equivalent:

- **AI Commit: Configure** — every setting in one QuickPick, with a scope switch at the top for user vs. workspace.
- **Settings UI** — search for "AI Commit".
- **`settings.json`** — edit directly.

Workspace settings give per-repository values, so a work signature in one repo and a personal one in another needs nothing special.

### Ticket scopes

If your branch names carry a ticket key, it becomes the scope automatically:

| Branch | Message |
| --- | --- |
| `feat/PAP-51-add-login` | `feat(PAP-51): add login form` |
| `feat/pap-51-add-login` | `feat(PAP-51): …` — uppercased |
| `main` | `fix(providers): …` — falls back to the code area |

The key is extracted from the branch name in code, not guessed by the model. Adjust `aicommit.ticketPattern` for other trackers, or set `aicommit.scopeSource` to `ticket`, `path` or `none`.

### Signatures

Add trailers with **AI Commit: Edit Signature**, including "Add `Co-authored-by` from git config" which reads your real name and email:

```jsonc
"aicommit.signature": [
  "Co-authored-by: Your Name <you@example.com>",
  "Refs: {{ticket}}"
]
```

Appended after generation, so they are always byte-exact rather than paraphrased. A trailer whose variables resolve to nothing — `Refs: {{ticket}}` on a branch with no ticket — is dropped rather than committed half-empty. Independent of git's own `git.alwaysSignOff`.

### Team conventions

Put a prompt in `.aicommit.md` at the repository root and it travels with the repo, so every contributor with the extension writes messages the same way. **AI Commit: Edit Prompt → Create `.aicommit.md`** seeds it with the current template so you edit rather than start from an empty file.

Templates support `{{diff}}`, `{{stat}}`, `{{recentCommits}}`, `{{branch}}`, `{{userHint}}`, `{{language}}`, `{{ticket}}` and `{{styleRules}}`.

> A custom template that omits `{{styleRules}}` takes full control of the format, and the style settings below no longer apply to it. Include that variable to keep them.

### Not using Conventional Commits?

Set `aicommit.conventionalCommits` to `false`. The message then matches the style of your existing commits instead of forcing a `type(scope):` prefix.

## Settings

```jsonc
{
  // Message shape
  "aicommit.conventionalCommits": true,       // require a type(scope): prefix
  "aicommit.commitTypes": [/* feat, fix, … */], // add your own, e.g. hotfix
  "aicommit.bodyStyle": "bullets",            // bullets | prose | none
  "aicommit.scopeSource": "auto",             // auto | ticket | path | none
  "aicommit.ticketPattern": "[A-Za-z]{2,}[A-Za-z0-9]*-\\d+",
  "aicommit.ticketUppercase": true,
  "aicommit.language": "English",

  // Prompt and signature
  "aicommit.prompt": "",                      // full template override
  "aicommit.signature": [],                   // git trailers

  // PR descriptions
  "aicommit.baseBranch": "",                  // empty = detect it
  "aicommit.prPrompt": "",                    // PR template override
  "aicommit.maxPrDiffBytes": 120000,          // branch diffs are bigger

  // What gets sent
  "aicommit.excludeGlobs": [/* secrets, lockfiles, generated, build output */],
  "aicommit.excludeGlobs.additional": [],     // append instead of replacing
  "aicommit.includeGlobs": [/* .env.example, … */],
  "aicommit.recentCommitCount": 10,
  "aicommit.maxDiffBytes": 60000,

  // Behaviour
  "aicommit.timeoutSeconds": 90,
  "aicommit.overwriteExistingMessage": false, // false = refine what you typed
  "aicommit.privacyNotice": "once",           // once | always | never

  // Providers — set these through the commands, not by hand
  "aicommit.providers": [],
  "aicommit.activeProvider": ""
}
```

There is deliberately no setting that accepts an API key — it would end up committed.

## FAQ

**Do I have to set up my key again every time?**
No. It is stored in your OS keychain and survives restarts. You will re-enter it on a second machine (Settings Sync does not sync secrets), if you use VS Code and VSCodium side by side, or after uninstalling.

**Nothing is staged — why is the button greyed out?**
By design. Stage something first.

**Does it work in an untrusted workspace?**
Yes, with limits. Hosted and local API providers keep working using your user-level settings. Workspace-level settings and repo-local instruction files are ignored, and CLI providers are refused, because both would let a repository choose what runs on your machine. Trust the folder to enable them.

## License

[MIT](LICENSE)
