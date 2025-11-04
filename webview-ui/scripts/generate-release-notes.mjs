#!/usr/bin/env node
// kilocode_change - new file: Build-time script to parse CHANGELOG.md and generate releases.json

import fs from 'fs'
import path from 'path'
import process from 'process'
import { fileURLToPath } from 'url'
import { remark } from 'remark'
import { visit } from 'unist-util-visit'

// Limit to the last 10 releases to keep build size manageable
const MAX_RELEASES = 10

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const changelogPath = path.resolve(__dirname, '../../CHANGELOG.md')
const outputDir = path.resolve(__dirname, '../src/generated/releases')

console.log('🚀 Starting changelog parsing...')
console.log('📖 Reading changelog from:', changelogPath)
console.log('📁 Output directory:', outputDir)

// Check if changelog exists
if (!fs.existsSync(changelogPath)) {
    console.error('❌ Changelog not found at:', changelogPath)
    process.exit(1)
}

// Read and parse changelog
const changelogContent = fs.readFileSync(changelogPath, 'utf-8')
console.log('📄 Changelog loaded, length:', changelogContent.length, 'characters')

const tree = remark().parse(changelogContent)
const releases = []
let currentRelease = null

// Traverse the AST to extract releases
visit(tree, (node) => {
    // Look for version headers (## [vX.X.X])
    if (node.type === 'heading' && node.depth === 2) {
        const text = node.children?.[0]?.value
        const versionMatch = text?.match(/^\[v(\d+\.\d+\.\d+)\]$/)

        if (versionMatch) {
            if (currentRelease && currentRelease.changes.length > 0) {
                releases.push(currentRelease)
            }
            currentRelease = { version: versionMatch[1], changes: [] }
        }
    }

    // Look for list items (changes)
    if (node.type === 'listItem' && currentRelease) {
        const change = parseChangeFromListItem(node)
        if (change) {
            currentRelease.changes.push(change)
        }
    }
})

// Don't forget the last release
if (currentRelease && currentRelease.changes.length > 0) {
    releases.push(currentRelease)
}

function parseChangeFromListItem(node) {
    let description = ''
    let prNumber = null
    let commitHash = null
    let author = null

    // Extract text and links from the list item
    visit(node, (child) => {
        if (child.type === 'text') {
            description += child.value
        } else if (child.type === 'link') {
            const url = child.url
            const text = child.children?.[0]?.value

            // Extract PR number
            if (url?.includes('/pull/')) {
                prNumber = parseInt(text?.replace('#', ''))
            }
            // Extract commit hash
            else if (url?.includes('/commit/')) {
                commitHash = text?.replace(/`/g, '')
            }
            // Extract author
            else if (url?.includes('github.com/') && text?.startsWith('@')) {
                author = text.replace('@', '')
            }

            description += text
        }
    })

    // Extract the actual description after "! - "
    const descMatch = description.match(/! - (.+)$/)
    if (descMatch) {
        description = descMatch[1].trim()
    }

    // Only return changes that have a PR number (main changes, not patch notes)
    if (!prNumber) {
        return null
    }

    return {
        description: description.trim(),
        ...(prNumber && { prNumber }),
        ...(commitHash && { commitHash }),
        ...(author && { author })
    }
}

const limitedReleases = releases.slice(0, MAX_RELEASES)
console.log(`✅ Found ${releases.length} releases`)
console.log(`🔢 Limiting to ${limitedReleases.length} most recent releases (from ${releases.length} total)`)

// Create output directory
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
    console.log('📁 Created output directory')
}

// Generate single releases.json file with current version and all releases
const releaseData = {
    currentVersion: limitedReleases[0]?.version || "0.0.0",
    releases: limitedReleases
}

const releasesPath = path.join(outputDir, 'releases.json')
fs.writeFileSync(releasesPath, JSON.stringify(releaseData, null, 2))

console.log(`💾 Generated releases.json with ${limitedReleases.length} releases`)
console.log(`📋 Current version: ${releaseData.currentVersion}`)
console.log('🎉 Changelog parsing completed successfully!')
