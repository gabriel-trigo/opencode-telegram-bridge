import { describe, expect, it } from "vitest"

import {
  formatCommandOutput,
  formatModelList,
  formatProjectList,
} from "../src/bot-logic.js"

describe("formatProjectList", () => {
  it("prints a friendly empty message", () => {
    expect(formatProjectList([], "home")).toBe("No projects configured.")
  })

  it("marks the active alias with *", () => {
    const text = formatProjectList(
      [
        { alias: "home", path: "/home/user" },
        { alias: "work", path: "/repo/work" },
      ],
      "work",
    )

    expect(text).toContain("Projects (active marked with *):")
    expect(text).toContain("  home: /home/user")
    expect(text).toContain("* work: /repo/work")
  })
})

describe("formatModelList", () => {
  it("prints No models available when empty", () => {
    expect(formatModelList([])).toBe("Available models:\nNo models available.")
  })

  it("sorts providers and models and includes display name", () => {
    const text = formatModelList([
      {
        id: "zeta",
        models: {
          "b": { name: "Model B" },
          "a": { name: "Model A" },
        },
      },
      {
        id: "alpha",
        models: {
          "x": { name: "X" },
        },
      },
    ])

    const lines = text.split("\n")
    expect(lines[0]).toBe("Available models:")
    expect(lines.slice(1)).toEqual([
      "alpha/x (X)",
      "zeta/a (Model A)",
      "zeta/b (Model B)",
    ])
  })
})

describe("formatCommandOutput", () => {
  it("returns null for empty output", () => {
    expect(formatCommandOutput(undefined)).toBeNull()
    expect(formatCommandOutput("")).toBeNull()
    expect(formatCommandOutput("   ")).toBeNull()
  })

  it("trims and truncates long output", () => {
    const long = "a".repeat(900)
    const formatted = formatCommandOutput(`\n${long}\n`)
    expect(formatted).toBe("a".repeat(800) + "...")
  })
})
