// kilocode_change start - new file: Simple hook for release notes loading pre-generated JSON
import { useState } from "react"
import { ReleaseNote } from "@roo-code/types"
import { useExtensionState } from "../context/ExtensionStateContext"
import { vscode } from "../utils/vscode"

// Global cache
let releasesCache: ReleaseData | null = null

const NULL_VERSION = "0.0.0"

interface ReleaseData {
	currentVersion: string
	releases: ReleaseNote[]
}

export const useReleaseNotes = () => {
	const [loading, setLoading] = useState(false)
	const { lastViewedReleaseVersion } = useExtensionState()

	const loadReleases = async (): Promise<ReleaseData> => {
		if (releasesCache) {
			return releasesCache
		}

		setLoading(true)
		try {
			// Load pre-generated JSON from build
			const data = await import("../generated/releases/releases.json")
			releasesCache = data.default as ReleaseData
			return releasesCache
		} catch (error) {
			console.error("Failed to load release notes:", error)
			releasesCache = { currentVersion: NULL_VERSION, releases: [] }
			return releasesCache
		} finally {
			setLoading(false)
		}
	}
	// kilocode_change end

	const hasUnviewedReleases = async (): Promise<boolean> => {
		const data = await loadReleases()
		// If no last viewed version, or current version is different, there are unviewed releases
		return !lastViewedReleaseVersion || lastViewedReleaseVersion !== data.currentVersion
	}

	const markAsViewed = async (version: string): Promise<void> => {
		// Use the generic updateGlobalState message to persist the last viewed version
		vscode.postMessage({
			type: "updateGlobalState",
			stateKey: "lastViewedReleaseVersion",
			stateValue: version,
		})
	}

	return {
		releases: releasesCache?.releases || [],
		currentVersion: releasesCache?.currentVersion || NULL_VERSION,
		loading,
		loadReleases,
		hasUnviewedReleases,
		markAsViewed,
	}
}
