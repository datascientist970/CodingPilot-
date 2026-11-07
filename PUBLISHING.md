# Publishing DevPilot so everyone can use it

Current version: 1.4.1. The installable file is `devpilot-1.4.1.vsix`
(install in VS Code via Extensions → `...` → Install from VSIX).

There are two ways to make it public. Option A is the real VS Code
Marketplace listing (searchable inside VS Code). Option B is faster and
needs no Microsoft account.

## Option A — VS Code Marketplace (recommended for "everyone can use it")

### Step 0 — Before publishing, replace the placeholders (required)

In `package.json`, change these two fields to YOUR OWN values.
Do NOT publish with the placeholders:

```json
"publisher": "YOUR-PUBLISHER-NAME",
"repository": { "type": "git", "url": "https://github.com/YOUR-USERNAME/devpilot" }
```

- `publisher` — a unique Marketplace publisher name (lowercase, no spaces).
  A good choice is your GitHub username, e.g. `datascientist970`, but only
  if that publisher name is still free on the Marketplace.
- `repository` — a real GitHub repo containing this code, so users can
  report issues. Create it first, push this code, then use its URL here.
  Also set `"homepage"` to the same repo URL if you want it shown.

After changing them, rebuild and repackage:

```bash
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
```

### Step 1 — Create the publisher (once, in your browser)

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with YOUR Microsoft account (the one you want to own the listing).
3. Click **Create publisher**, enter the publisher name from Step 0,
   and confirm. This name cannot be changed later, so choose carefully.

### Step 2 — Create a Personal Access Token (PAT, once)

1. Go to https://dev.azure.com — sign in with the SAME Microsoft account.
2. If you have no organization, create one (any name, e.g. `devpilot`).
3. Top-right profile → **Personal access tokens** → **New Token**.
4. Name it e.g. `vsce-publish`, set an expiry (90 days is fine for a
   first publish; you can rotate it later).
5. Under **Scopes**, choose **Custom defined** → show all scopes →
   check **Marketplace → Manage**. Nothing else is needed.
6. Click **Create** and COPY the token immediately — it is shown only once.
   Never paste it into chat, an issue, or a public file.

### Step 3 — Publish

From this project folder, with the PAT as an environment variable
(so it never lands in your shell history file in plain text, use the
prompt form below):

```bash
npx @vscode/vsce publish -p <PASTE-YOUR-PAT-HERE>
```

Or publish the VSIX you already built, without rebuilding:

```bash
npx @vscode/vsce publish --packagePath ./devpilot-1.4.1.vsix -p <PASTE-YOUR-PAT-HERE>
```

What happens next:

- First publish takes a few minutes to appear. Search VS Code Extensions
  for "DevPilot" — if several extensions share the name, search by
  `publisher:YOUR-PUBLISHER-NAME`.
- The listing page uses `README.md`, the icon (`media/icon.png`), and
  the categories/keywords from `package.json`. Update README screenshots
  later if you want a richer page — the listing works without them.
- Every later version: bump `"version"` in `package.json`, rebuild,
  repackage, and run the same `vsce publish` command. Do NOT republish
  the same version number — the Marketplace rejects it; use
  `vsce publish minor` / `vsce publish patch` to bump automatically.

### Troubleshooting

- `Publisher not found` → the publisher in `package.json` does not match
  the one you created in Step 1, or you signed into Azure DevOps with a
  different Microsoft account.
- `401 / Invalid PAT` → the PAT expired, was copied wrong, or does not
  have Marketplace → Manage scope. Create a new one.
- `Version already exists` → bump the version first (see above).
- `Missing repository` warning → either set a real `repository` URL or
  publish with `--allow-missing-repository` (not recommended for a
  public listing).

## Option B — GitHub Release (fast, no Microsoft account)

If you only want people to be able to install it right now:

1. Create a GitHub repo (e.g. `github.com/YOUR-USERNAME/devpilot`) and
   push this code.
2. On GitHub → Releases → Draft a new release → tag `v1.4.1` →
   upload `devpilot-1.4.1.vsix` as a release asset → Publish.
3. Share the release link. Anyone can download the VSIX and install it
   via Extensions → `...` → Install from VSIX. No Marketplace account
   needed, but it will NOT appear in VS Code's extension search.

Option B can be done today, and Option A later with the same VSIX —
the version number just needs to be bumped if it was already published
somewhere under the same publisher.

## What is already ready in this package

- [x] `displayName`, `description`, `icon` (128×128 PNG), `categories`,
      `keywords`, `license` (MIT), dark gallery banner
- [x] `README.md`, `CHANGELOG.md`, `LICENSE`
- [x] VSIX packages cleanly (20 files, no `node_modules`, no source maps)
- [ ] `publisher` — still the placeholder `devpilot` (change in Step 0)
- [ ] `repository` — still the placeholder `github.com/devpilot/devpilot`
      (change in Step 0)
