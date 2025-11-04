// kilocode_change - new file: Container component that handles release notes button logic
import React, { useState } from "react"
import { ShowReleaseNotesButtonInner } from "./ShowReleaseNotesButtonInner"
import { ReleaseNotesModal } from "./ReleaseNotesModal"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useReleaseNotes } from "../../hooks/useReleaseNotes"
import { useExtensionState } from "../../context/ExtensionStateContext"

interface ShowReleaseNotesButtonProps {
	buttonText?: string
	className?: string
}

export const ShowReleaseNotesButton: React.FC<ShowReleaseNotesButtonProps> = ({ buttonText, className = "w-40" }) => {
	const { t } = useAppTranslation()
	const [showModal, setShowModal] = useState(false)
	const { releases, loadReleases, loading, markAsViewed, currentVersion } = useReleaseNotes()
	const { lastViewedReleaseVersion } = useExtensionState()
	const displayText = buttonText || t("kilocode:releaseNotes.viewReleaseNotes")

	// Badge shows when there's a version mismatch
	const showBadge = lastViewedReleaseVersion !== currentVersion && currentVersion !== "0.0.0"

	const handleOpenModal = () => {
		loadReleases()
		setShowModal(true)
		// Mark as viewed when modal opens
		if (currentVersion) {
			markAsViewed(currentVersion)
		}
	}

	return (
		<>
			<ShowReleaseNotesButtonInner
				buttonText={displayText}
				className={className}
				showBadge={showBadge}
				onClick={handleOpenModal}
			/>

			<ReleaseNotesModal
				isOpen={showModal}
				onClose={() => setShowModal(false)}
				releases={releases}
				loading={loading}
				currentVersion={currentVersion}
				onMarkAsViewed={markAsViewed}
			/>
		</>
	)
}
