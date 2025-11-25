import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

export interface ExtensionPaths {
	extensionBundlePath: string // Path to extension.js
	extensionRootPath: string // Path to extension root
}

/**
 * Resolves extension paths for the CLI.
 * Prefers the packaged dist/kilocode/ bundle but gracefully falls back to
 * the local VS Code extension source so developers can run the CLI without
 * manually copying files first.
 *
 * Search order:
 * 1. cli/dist/kilocode/ (packaged bundle used in releases)
 * 2. bin-unpacked/extension (output of vsix:unpacked)
 * 3. src/ (local extension workspace with dist/extension.js)
 */
export function resolveExtensionPaths(): ExtensionPaths {
	// Get the directory where this compiled file is located
	const currentFile = fileURLToPath(import.meta.url)
	const currentDir = path.dirname(currentFile)

	// When bundled with esbuild, all code is in dist/index.js
	// When compiled with tsc, this file is in dist/utils/extension-paths.js
	// Check if we're in a utils subdirectory or directly in dist
	const isInUtilsSubdir = currentDir.endsWith("utils")

	// Navigate to dist directory
	const distDir = isInUtilsSubdir ? path.resolve(currentDir, "..") : currentDir

	const candidateRoots = [
		path.join(distDir, "kilocode"),
		path.resolve(distDir, "..", "bin-unpacked", "extension"),
		path.resolve(distDir, "..", "src"),
		// When running the CLI from the repository root, the extension lives at ../../src
		path.resolve(distDir, "..", "..", "src"),
	]

	const extensionRootPath = candidateRoots.find((candidate) =>
		fs.existsSync(path.join(candidate, "dist", "extension.js")),
	)

	if (!extensionRootPath) {
		throw new Error(
			`Unable to locate extension bundle. Checked: ${candidateRoots
				.map((candidate) => path.join(candidate, "dist", "extension.js"))
				.join(", ")}`,
		)
	}

	const extensionBundlePath = path.join(extensionRootPath, "dist", "extension.js")

	return {
		extensionBundlePath,
		extensionRootPath,
	}
}
