import { describe, expect, it } from "vitest";
import {
  isComponentOnceCompatible,
  satisfiesComponentOnceCapabilitySemverRange,
  semverComponentOnceCapabilityCompatibility,
} from "../src/index.js";

describe("stable capability SemVer ranges", () => {
  it("supports exact, partial and wildcard ranges", () => {
    expect(satisfiesComponentOnceCapabilitySemverRange("*", "19.2.6")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("x", "18.2.0")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("18", "18.9.3")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("18", "19.0.0")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange("18.2", "18.2.99")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("18.2", "18.3.0")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange("18.x", "18.99.0")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("18.2.x", "18.2.9")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("18.2.3", "18.2.3")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("18.2.3", "18.2.4")).toBe(false);
  });

  it("supports comparator conjunctions and OR", () => {
    expect(satisfiesComponentOnceCapabilitySemverRange(">=18 <20", "18.2.0")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange(">=18 <20", "19.9.9")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange(">=18 <20", "20.0.0")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange(">=18.2.0 <18.3.0", "18.2.7")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange(">18", "18.9.9")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange(">18", "19.0.0")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("<=18", "18.9.9")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("<=18", "19.0.0")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange(">18.2", "18.2.99")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange(">18.2", "18.3.0")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("^18 || ^19", "19.4.1")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("^18 || ^19", "20.0.0")).toBe(false);
  });

  it("supports caret semantics including zero majors", () => {
    expect(satisfiesComponentOnceCapabilitySemverRange("^18", "18.99.0")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("^18", "19.0.0")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange("^0.2", "0.2.9")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("^0.2", "0.3.0")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange("^0.0.3", "0.0.3")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("^0.0.3", "0.0.4")).toBe(false);
  });

  it("supports tilde semantics", () => {
    expect(satisfiesComponentOnceCapabilitySemverRange("~18", "18.8.0")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("~18", "19.0.0")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange("~18.2", "18.2.99")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange("~18.2", "18.3.0")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange("~18.2.3", "18.2.9")).toBe(true);
  });

  it("accepts stable build metadata and rejects prerelease/invalid versions", () => {
    expect(satisfiesComponentOnceCapabilitySemverRange(">=18 <20", "19.2.6+host.1")).toBe(true);
    expect(satisfiesComponentOnceCapabilitySemverRange(">=18 <20", "19.2.6-beta.1")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange(">=18 <20", "19.2.6+bad!meta")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange(">=18 <20", "wat")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange("wat", "19.2.6")).toBe(false);
    expect(satisfiesComponentOnceCapabilitySemverRange("01.2.3", "1.2.3")).toBe(false);
  });

  it("is opt-in and never changes the default exact compatibility rule", () => {
    const manifest = {
      id: "portable/card",
      version: "1.0.0",
      requirements: [{ name: "react", version: ">=18 <20" }],
    } as const;
    const capabilities = [{ name: "react", version: "19.2.6" }] as const;

    expect(isComponentOnceCompatible(manifest, capabilities)).toBe(false);
    expect(
      isComponentOnceCompatible(
        manifest,
        capabilities,
        semverComponentOnceCapabilityCompatibility,
      ),
    ).toBe(true);
    expect(
      semverComponentOnceCapabilityCompatibility(
        { name: "react", version: ">=18 <20" },
        { name: "other", version: "19.2.6" },
      ),
    ).toBe(false);
  });
});
