// kilocode_change - new file: Component to display a section of release notes
import React from "react"
import { ReleaseItem } from "@roo-code/types"
import { ReleaseItemComponent } from "./ReleaseItem"

interface ReleaseSectionProps {
	items: ReleaseItem[]
	icon?: React.ReactNode
}

export const ReleaseSection: React.FC<ReleaseSectionProps> = ({ items, icon }) => {
	if (items.length === 0) return null

	return (
		<div className="mb-4">
			<h3 className="text-base font-medium text-vscode-editor-foreground mb-2 flex items-center gap-2">{icon}</h3>
			<div className="ml-2">
				{items.map((item, index) => (
					<ReleaseItemComponent key={index} item={item} />
				))}
			</div>
		</div>
	)
}
