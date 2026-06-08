#!/bin/bash

set -euo pipefail

OUTPUT=""
TITLE=""
GOAL=""
AUDIENCE=""
ARTIFACT=""
QUERY=""
UPDATED="$(date +%F)"
declare -a SOURCES=()
declare -a EXCLUSIONS=()
declare -a DIRECTIONS=()

usage() {
	echo "Usage: notebooklm-pack.sh --output <file> --title <title> --goal <goal> --audience <audience> [options]"
	echo ""
	echo "Options:"
	echo "  --artifact <type>     Artifact type, e.g. briefing, podcast, onboarding"
	echo "  --query <text>        Recall query that led to this source pack"
	echo "  --source <path|url>   Add a source; repeat for multiple sources"
	echo "  --exclude <text>      Add an exclusion note; repeat for multiple items"
	echo "  --direction <text>    Add prompt direction; repeat for multiple items"
	echo "  -h, --help            Show this help"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--output)
			OUTPUT="${2:-}"
			shift 2
			;;
		--title)
			TITLE="${2:-}"
			shift 2
			;;
		--goal)
			GOAL="${2:-}"
			shift 2
			;;
		--audience)
			AUDIENCE="${2:-}"
			shift 2
			;;
		--artifact)
			ARTIFACT="${2:-}"
			shift 2
			;;
		--query)
			QUERY="${2:-}"
			shift 2
			;;
		--source)
			SOURCES+=("${2:-}")
			shift 2
			;;
		--exclude)
			EXCLUSIONS+=("${2:-}")
			shift 2
			;;
		--direction)
			DIRECTIONS+=("${2:-}")
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown argument: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done

if [[ -z "$OUTPUT" || -z "$TITLE" || -z "$GOAL" || -z "$AUDIENCE" ]]; then
	usage >&2
	exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"

{
	echo "---"
	echo "title: \"$TITLE\""
	echo 'type: "source-pack"'
	echo 'status: "draft"'
	echo "updated: $UPDATED"
	echo 'summary: "Curated source pack for a specific NotebookLM artifact."'
	echo "---"
	echo
	echo "# NotebookLM Source Pack"
	echo
	echo "## Goal"
	echo
	echo "$GOAL"
	echo
	if [[ -n "$ARTIFACT" ]]; then
		echo "## Artifact Type"
		echo
		echo "$ARTIFACT"
		echo
	fi
	echo "## Audience"
	echo
	echo "$AUDIENCE"
	echo
	if [[ -n "$QUERY" ]]; then
		echo "## Recall Query"
		echo
		echo "$QUERY"
		echo
	fi
	echo "## Source Pack"
	echo
	if [[ ${#SOURCES[@]} -gt 0 ]]; then
		for source in "${SOURCES[@]}"; do
			echo "- $source"
		done
	else
		echo "- [add-source-path-or-url]"
	fi
	echo
	echo "## Why These Sources"
	echo
	if [[ ${#SOURCES[@]} -gt 0 ]]; then
		for source in "${SOURCES[@]}"; do
			echo "- $source:"
		done
	else
		echo "- Source 1:"
		echo "- Source 2:"
	fi
	echo
	echo "## Exclusions"
	echo
	if [[ ${#EXCLUSIONS[@]} -gt 0 ]]; then
		for exclusion in "${EXCLUSIONS[@]}"; do
			echo "- $exclusion"
		done
	else
		echo "- What was intentionally left out and why"
	fi
	echo
	echo "## Prompt Direction"
	echo
	if [[ ${#DIRECTIONS[@]} -gt 0 ]]; then
		for direction in "${DIRECTIONS[@]}"; do
			echo "- $direction"
		done
	else
		echo "- Tone"
		echo "- Depth"
		echo "- Format"
		echo "- Constraints"
	fi
	echo
	echo "## Write-Back Plan"
	echo
	echo "- What should be written back into Markdown if the artifact produces durable value"
} >"$OUTPUT"

echo "Created NotebookLM source pack: $OUTPUT"
