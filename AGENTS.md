# Agent Notes

- Use `agent-browser` for browser QA of the app. Open the local dev server and verify the UI flow in-browser before shipping user-facing app changes.
- Do not build release artifacts locally. The GitHub Actions release workflow builds macOS, Windows, and Linux assets from pushed tags or manual workflow dispatch.
- For releases, validate locally with normal checks, commit the source/version changes, push, and push the release tag so CI can build and publish the assets.
- Skip commit signing in this project. Use the repo-local Git config or `--no-gpg-sign` when committing.
