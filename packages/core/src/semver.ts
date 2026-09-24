import type {
  ComponentOnceCapability,
  ComponentOnceRequirement,
} from "./index.js";

interface StableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

interface PartialVersion extends StableVersion {
  readonly specified: 1 | 2 | 3;
  readonly wildcardAt?: 1 | 2 | 3;
}

function numericPart(value: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parsePartialVersion(value: string): PartialVersion | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (text === "*" || /^x$/i.test(text)) {
    return { major: 0, minor: 0, patch: 0, specified: 1, wildcardAt: 1 };
  }

  const parts = text.split(".");
  if (parts.length < 1 || parts.length > 3) return undefined;
  const values = [0, 0, 0];
  let wildcardAt: 1 | 2 | 3 | undefined;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (part === "*" || /^x$/i.test(part)) {
      wildcardAt = (index + 1) as 1 | 2 | 3;
      if (index !== parts.length - 1) return undefined;
      break;
    }
    if (wildcardAt !== undefined) return undefined;
    const parsed = numericPart(part);
    if (parsed === undefined) return undefined;
    values[index] = parsed;
  }

  return {
    major: values[0]!,
    minor: values[1]!,
    patch: values[2]!,
    specified: parts.length as 1 | 2 | 3,
    ...(wildcardAt === undefined ? {} : { wildcardAt }),
  };
}

function parseAvailableVersion(value: string): StableVersion | undefined {
  const text = value.trim();
  const buildIndex = text.indexOf("+");
  const core = buildIndex < 0 ? text : text.slice(0, buildIndex);
  const build = buildIndex < 0 ? undefined : text.slice(buildIndex + 1);
  if (core.includes("-")) return undefined;
  if (
    build !== undefined &&
    !/^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/.test(build)
  ) {
    return undefined;
  }
  const parsed = parsePartialVersion(core);
  if (!parsed || parsed.wildcardAt !== undefined) return undefined;
  return parsed;
}

function compare(left: StableVersion, right: StableVersion): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return 0;
}

function nextMajor(version: StableVersion): StableVersion {
  return { major: version.major + 1, minor: 0, patch: 0 };
}

function nextMinor(version: StableVersion): StableVersion {
  return { major: version.major, minor: version.minor + 1, patch: 0 };
}

function nextPatch(version: StableVersion): StableVersion {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
  };
}

function partialUpperBound(
  version: PartialVersion,
): StableVersion | undefined {
  const wildcardAt = version.wildcardAt;
  if (wildcardAt === 1) return undefined;
  if (wildcardAt === 2) return nextMajor(version);
  if (wildcardAt === 3) return nextMinor(version);
  if (version.specified === 1) return nextMajor(version);
  if (version.specified === 2) return nextMinor(version);
  return undefined;
}

function matchesPartial(
  available: StableVersion,
  required: PartialVersion,
): boolean {
  if (required.wildcardAt === 1) return true;
  const lower = compare(available, required) >= 0;
  if (!lower) return false;
  const upper = partialUpperBound(required);
  return upper === undefined ? compare(available, required) === 0 : compare(available, upper) < 0;
}

function caretUpperBound(version: PartialVersion): StableVersion | undefined {
  if (version.wildcardAt === 1) return undefined;
  if (version.major > 0) return nextMajor(version);
  if (version.specified === 1) return nextMajor(version);
  if (version.minor > 0) return nextMinor(version);
  if (version.specified === 2) return nextMinor(version);
  return nextPatch(version);
}

function tildeUpperBound(version: PartialVersion): StableVersion | undefined {
  if (version.wildcardAt === 1) return undefined;
  if (version.specified === 1 || version.wildcardAt === 2) {
    return nextMajor(version);
  }
  return nextMinor(version);
}

function matchesComparator(
  available: StableVersion,
  token: string,
): boolean {
  const match = token.match(/^(>=|<=|>|<|=)?(.+)$/);
  if (!match) return false;
  const operator = match[1] ?? "";
  const value = parsePartialVersion(match[2]!);
  if (!value) return false;

  if (!operator || operator === "=") {
    return matchesPartial(available, value);
  }
  if (value.wildcardAt !== undefined) return false;

  const order = compare(available, value);
  if (operator === ">=") return order >= 0;
  if (operator === "<") return order < 0;
  if (operator === ">") {
    if (value.specified === 1) return compare(available, nextMajor(value)) >= 0;
    if (value.specified === 2) return compare(available, nextMinor(value)) >= 0;
    return order > 0;
  }
  if (operator === "<=") {
    if (value.specified === 1) return compare(available, nextMajor(value)) < 0;
    if (value.specified === 2) return compare(available, nextMinor(value)) < 0;
    return order <= 0;
  }
  return false;
}

function matchesSet(available: StableVersion, input: string): boolean {
  const text = input.trim();
  if (!text) return false;

  if (text.startsWith("^")) {
    const required = parsePartialVersion(text.slice(1));
    if (!required) return false;
    if (required.wildcardAt === 1) return true;
    const upper = caretUpperBound(required);
    return (
      compare(available, required) >= 0 &&
      (upper === undefined || compare(available, upper) < 0)
    );
  }

  if (text.startsWith("~")) {
    const required = parsePartialVersion(text.slice(1));
    if (!required) return false;
    if (required.wildcardAt === 1) return true;
    const upper = tildeUpperBound(required);
    return (
      compare(available, required) >= 0 &&
      (upper === undefined || compare(available, upper) < 0)
    );
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => matchesComparator(available, token));
}

/**
 * Match one stable numeric capability version against a small npm-like range.
 *
 * Supported forms:
 * - exact/partial: `18`, `18.2`, `18.2.3`
 * - wildcard: `*`, `18.x`, `18.2.x`
 * - comparator sets: `>=18 <20`
 * - caret/tilde: `^18.2.0`, `~18.2`
 * - OR: `^18 || ^19`
 *
 * Available versions may contain build metadata (for example `19.2.0+host`).
 * Prereleases are intentionally not accepted: hosts needing prerelease policy
 * should supply their own ComponentOnceCapabilityCompatibility.
 */
export function satisfiesComponentOnceCapabilitySemverRange(
  range: string,
  availableVersion: string,
): boolean {
  const available = parseAvailableVersion(availableVersion);
  if (!available) return false;
  return range
    .split("||")
    .some((set) => matchesSet(available, set));
}

/**
 * Capability compatibility using stable SemVer range syntax for the version
 * field. Component identities/registry versions remain exact and unaffected.
 */
export function semverComponentOnceCapabilityCompatibility(
  requirement: ComponentOnceRequirement,
  available: ComponentOnceCapability,
): boolean {
  return (
    requirement.name === available.name &&
    satisfiesComponentOnceCapabilitySemverRange(
      requirement.version,
      available.version,
    )
  );
}
