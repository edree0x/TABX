# Contributing to TabX

Thanks for taking the time to contribute. TabX is a community project — every contribution, no matter how small, makes the extension better for everyone.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) and keep our community open and welcoming.

---

## Ways to contribute

- 🐞 **Report bugs** — open an issue with steps to reproduce, expected vs. actual behavior, and your browser version.
- 💡 **Propose features** — describe the problem you're solving and a rough idea of the UX.
- 🧪 **Fix bugs & add features** — fork, code, test, and open a pull request.
- 🌍 **Translate** — add or improve a locale under `_locales/`.
- 📚 **Docs** — improve this README, the guide, or add code comments.

## Getting started

1. Fork the repository: <https://github.com/edree0x/TABX/fork>
2. Clone your fork locally:

   ```bash
   git clone https://github.com/<you>/TABX.git
   cd TABX
   ```

3. Create a branch for your work:

   ```bash
   git checkout -b feat/my-change
   ```

4. Load the extension:

   - Open `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the project folder

5. Make your changes, then reload the extension from `chrome://extensions/` to see them.

> TabX is a build-free extension — no npm install, no bundler. Edit, reload, done.

## Testing

The repository ships a validation suite for the Toby import/export path:

```bash
node tests/toby.test.js path/to/your-toby-export.json
```

When you touch import/export code, the data format, or the background message layer, run the suite and make sure the validation sections still pass.

## Commit & PR guidelines

- Write clear, conventional commit messages (e.g. `feat: add OneTab import`, `fix: restore badge after bin empty`).
- Keep pull requests focused: one logical change per PR.
- Mention how you manually verified the change (browser version, reproduction steps).
- Update the README or `_locales/` when your change affects documented behavior or strings.

## Translation checklist

- Copy `_locales/en/messages.json` as your starting point for a new locale.
- Keep the placeholder structure (`$1`, `$2`, …) intact.
- Don't translate `extensionName` or `extensionDescription` changes without checking the manifest.
- Add your locale folder to the list in the README if it isn't already there.

## Reviewing

All PRs need at least one other pair of eyes. If you're a maintainer, prefer merging with a
`reviewed-by` note; if you're a first-time contributor, don't worry — we'll help you land your first merge.

---

Questions? Open a [discussion](https://github.com/edree0x/TABX/discussions) or an [issue](https://github.com/edree0x/TABX/issues).