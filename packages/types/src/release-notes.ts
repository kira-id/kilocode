// kilocode_change - new file
export interface ReleaseItem {
	description: string
	prNumber?: number
	commitHash?: string
	author?: string
}

export interface ReleaseNote {
	version: string
	changes: ReleaseItem[]
}

export interface ReleaseData {
	currentVersion: string
	releases: ReleaseNote[]
}
