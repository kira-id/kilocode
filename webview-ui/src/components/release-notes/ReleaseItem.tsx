// kilocode_change - new file: Component to display individual release note items
import React from "react"
import { ReleaseItem } from "@roo-code/types"
import { REPOSITORY_URL } from "@/utils/kilocode/repository"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ReleaseItemProps {
	item: ReleaseItem
}

export const ReleaseItemComponent: React.FC<ReleaseItemProps> = ({ item }) => {
	const { t } = useAppTranslation()

	return (
		<div className="mb-2">
			<div className="text-sm text-vscode-editor-foreground">
				• {item.description}
				{item.prNumber && (
					<a
						href={`${REPOSITORY_URL}/pull/${item.prNumber}`}
						target="_blank"
						rel="noopener noreferrer"
						className="ml-2 text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline">
						#{item.prNumber}
					</a>
				)}
				{item.commitHash && (
					<a
						href={`${REPOSITORY_URL}/commit/${item.commitHash}`}
						target="_blank"
						rel="noopener noreferrer"
						className="ml-1 text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline font-mono">
						{item.commitHash}
					</a>
				)}
				{item.author && (
					<span className="ml-1 text-xs text-vscode-descriptionForeground">
						{t("kilocode:releaseNotes.byAuthor")}{" "}
						<a
							href={`https://github.com/${item.author}`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline">
							@{item.author}
						</a>
					</span>
				)}
			</div>
		</div>
	)
}
