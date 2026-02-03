import { describe, expect, it } from "vitest"

import {
  buildPermissionKeyboardSpec,
  buildPermissionSummary,
  formatPermissionDecision,
  parsePermissionCallback,
} from "../src/bot-logic.js"

describe("permission button model", () => {
  it("builds the expected button spec without always", () => {
    const spec = buildPermissionKeyboardSpec("req-1", false)
    expect(spec).toEqual({
      buttons: [
        { text: "Approve once", data: "perm:req-1:once" },
        { text: "Reject", data: "perm:req-1:reject" },
      ],
    })
  })

  it("builds the expected button spec with always inserted in the middle", () => {
    const spec = buildPermissionKeyboardSpec("req-2", true)
    expect(spec).toEqual({
      buttons: [
        { text: "Approve once", data: "perm:req-2:once" },
        { text: "Approve always", data: "perm:req-2:always" },
        { text: "Reject", data: "perm:req-2:reject" },
      ],
    })
  })
})

describe("permission callback parsing", () => {
  it("parses valid permission callbacks", () => {
    expect(parsePermissionCallback("perm:abc:once")).toEqual({
      requestId: "abc",
      reply: "once",
    })
    expect(parsePermissionCallback("perm:abc:always")).toEqual({
      requestId: "abc",
      reply: "always",
    })
    expect(parsePermissionCallback("perm:abc:reject")).toEqual({
      requestId: "abc",
      reply: "reject",
    })
  })

  it("rejects invalid permission callbacks", () => {
    expect(parsePermissionCallback("nope")).toBeNull()
    expect(parsePermissionCallback("perm::once")).toBeNull()
    expect(parsePermissionCallback("perm:abc:wat")).toBeNull()
    expect(parsePermissionCallback("perm:abc:once:extra")).toBeNull()
  })
})

describe("permission summary", () => {
  it("includes patterns and always scopes only when present", () => {
    expect(
      buildPermissionSummary({
        permission: "fs.read",
        patterns: [],
        always: [],
      }),
    ).toBe("OpenCode permission request\nPermission: fs.read")

    expect(
      buildPermissionSummary({
        permission: "fs.write",
        patterns: ["src/**"],
        always: ["/repo"],
      }),
    ).toBe(
      "OpenCode permission request\nPermission: fs.write\nPatterns: src/**\nAlways scopes: /repo",
    )
  })
})

describe("permission decision formatting", () => {
  it("formats the decision label", () => {
    expect(formatPermissionDecision("once")).toBe("Approved (once)")
    expect(formatPermissionDecision("always")).toBe("Approved (always)")
    expect(formatPermissionDecision("reject")).toBe("Rejected")
  })
})
