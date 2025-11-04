// kilocode_change - new file: Static presentation component for showing release notes button
import React from "react"
import { FileText, Bell } from "lucide-react"
import { Button } from "../ui"

interface ShowReleaseNotesButtonInnerProps {
	buttonText: string
	className?: string
	showBadge: boolean
	onClick: () => void
}

export const ShowReleaseNotesButtonInner: React.FC<ShowReleaseNotesButtonInnerProps> = ({
	buttonText,
	className,
	showBadge,
	onClick,
}) => {
	return (
		<Button onClick={onClick} className={`relative ${className}`}>
			<FileText className="p-0.5" />
			{buttonText}
			{showBadge && (
				<div className="absolute -top-2 -right-2 size-4 bg-yellow-500 rounded-full flex items-center justify-center">
					<Bell size={24} fill="currentColor" className="p-0.5" />
				</div>
			)}
		</Button>
	)
}
