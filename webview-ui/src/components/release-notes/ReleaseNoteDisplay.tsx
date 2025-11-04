// kilocode_change - new file: Component to display a complete release note
import React from "react"
import { ReleaseNote } from "@roo-code/types"
import { ReleaseSection } from "./ReleaseSection"
import { REPOSITORY_URL } from "@/utils/kilocode/repository"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ReleaseNoteDisplayProps {
	release: ReleaseNote
	isLatest?: boolean
}

export const ReleaseNoteDisplay: React.FC<ReleaseNoteDisplayProps> = ({ release, isLatest }) => {
	const { t } = useAppTranslation()
	const { version, changes = [] } = release

	return (
		<div className="mb-6 pb-4 border-b border-vscode-panel-border last:border-b-0">
			<div className="flex items-center gap-2 mb-3">
				<a
					href={`${REPOSITORY_URL}/releases/tag/v${version}`}
					target="_blank"
					rel="noopener noreferrer"
					className="text-lg font-medium text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline">
					v{version}
				</a>
				{isLatest && (
					<span className="px-2 py-1 text-xs bg-vscode-button-background text-vscode-button-foreground rounded">
						{t("kilocode:releaseNotes.latestBadge")}
					</span>
				)}
			</div>

			<ReleaseSection items={changes} />
		</div>
	)
}
