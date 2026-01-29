#!/usr/bin/env node
const { execSync } = require("node:child_process")

const getChangedFiles = () => {
  let output = ""
  try {
    output = execSync("git diff --name-only origin/main...HEAD", {
      encoding: "utf8",
    })
  } catch (error) {
    output = execSync("git diff --name-only HEAD~1", { encoding: "utf8" })
  }

  return output.split("\n").map((line) => line.trim()).filter(Boolean)
}

const isChangesetFile = (file) =>
  file.startsWith(".changeset/") && file.endsWith(".md")

const isIgnoredFile = (file) =>
  file.startsWith("docs/") ||
  file.startsWith(".github/") ||
  file === "README.md"

const changedFiles = getChangedFiles()
const hasChangeset = changedFiles.some(isChangesetFile)
const hasRelevantChange = changedFiles.some(
  (file) => !isChangesetFile(file) && !isIgnoredFile(file),
)

if (hasRelevantChange && !hasChangeset) {
  console.error("Missing changeset. Run `npx changeset`.")
  process.exit(1)
}
