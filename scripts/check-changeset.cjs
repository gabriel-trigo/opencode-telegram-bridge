#!/usr/bin/env node
const { execSync } = require("node:child_process")
const fs = require("node:fs")

const readEventPayload = () => {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    return null
  }

  try {
    const raw = fs.readFileSync(eventPath, "utf8")
    return JSON.parse(raw)
  } catch (error) {
    console.warn("Failed to read GitHub event payload", error)
    return null
  }
}

const resolveDiffRange = () => {
  const eventName = process.env.GITHUB_EVENT_NAME
  const payload = readEventPayload()

  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const base = payload?.pull_request?.base?.sha
    const head = payload?.pull_request?.head?.sha
    if (base && head) {
      return { type: "range", base, head }
    }
  }

  if (eventName === "push") {
    const before = payload?.before
    const after = payload?.after
    if (before && after) {
      return { type: "push", before, after }
    }
  }

  return null
}

const isZeroSha = (value) => /^0+$/.test(value)

const runGitCommand = (command) =>
  execSync(command, { encoding: "utf8" })

const getChangedFiles = () => {
  let output = ""
  const diffRange = resolveDiffRange()

  try {
    if (diffRange?.type === "range") {
      output = runGitCommand(
        `git diff --name-only ${diffRange.base}...${diffRange.head}`,
      )
    } else if (diffRange?.type === "push") {
      if (isZeroSha(diffRange.before)) {
        output = runGitCommand(
          `git show --name-only --pretty="" ${diffRange.after}`,
        )
      } else {
        output = runGitCommand(
          `git diff --name-only ${diffRange.before}...${diffRange.after}`,
        )
      }
    } else {
      output = runGitCommand("git diff --name-only origin/main...HEAD")
    }
  } catch (error) {
    output = runGitCommand("git diff --name-only HEAD~1")
  }

  return output.split("\n").map((line) => line.trim()).filter(Boolean)
}

const isChangesetFile = (file) =>
  file.startsWith(".changeset/") && file.endsWith(".md")

const isIgnoredFile = (file) =>
  file.startsWith("docs/") ||
  file.startsWith(".github/") ||
  file === "README.md" ||
  file === "AGENTS.md"

const changedFiles = getChangedFiles()
const hasChangeset = changedFiles.some(isChangesetFile)
const hasRelevantChange = changedFiles.some(
  (file) => !isChangesetFile(file) && !isIgnoredFile(file),
)

if (hasRelevantChange && !hasChangeset) {
  console.error("Missing changeset. Run `npx changeset`.")
  process.exit(1)
}
