import { describe, expect, it } from "vitest"

import {
  formatCommandOutput,
  formatModelList,
  formatProjectList,
  formatStatusReply,
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

describe("formatStatusReply", () => {
  it("prints project/model/session and context usage", () => {
    expect(
      formatStatusReply({
        project: { alias: "home", path: "/home/user" },
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
        sessionId: "session-1",
        tokens: {
          input: 1234,
          output: 456,
          reasoning: 0,
          cache: { read: 10, write: 2 },
        },
        contextLimit: 8192,
      }),
    ).toBe(
      [
        "Project: home: /home/user",
        "Model: openai/gpt-5.3-codex",
        "Session: session-1",
        "Context (input): 1234 / 8192 (15.1%)",
        "Tokens (last assistant): in=1234 out=456 reasoning=0 cache(r/w)=10/2",
      ].join("\n"),
    )
  })

  it("prints a clear message when no assistant message exists yet", () => {
    expect(
      formatStatusReply({
        project: { alias: "home", path: "/home/user" },
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
        sessionId: "session-1",
        tokens: null,
        contextLimit: 8192,
      }),
    ).toBe(
      [
        "Project: home: /home/user",
        "Model: openai/gpt-5.3-codex",
        "Session: session-1",
        "Context (input): unavailable (no assistant message yet). Limit: 8192",
      ].join("\n"),
    )
  })
})
