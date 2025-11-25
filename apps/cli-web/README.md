# Kilo Code Web UI

A Next.js wrapper that exposes the `@kilocode/cli` experience through a browser. The app automatically builds the CLI if needed, runs it in autonomous JSON mode, and streams output chunks back to the page.

## Getting started

```bash
pnpm install
pnpm --filter @kilocode/cli-web dev
```

Then open http://localhost:3000 and provide a prompt. By default, the CLI runs from the repository root; supply a workspace path to target a specific project.
