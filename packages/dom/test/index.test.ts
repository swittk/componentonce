import { ComponentOnceCapabilityVersionError } from "@componentonce/core";
import { describe, expect, it, vi } from "vitest";
import {
  defineDomComponent,
  mountDomComponent,
  mountDomComponentBoundary,
} from "../src/index.js";

interface Props { readonly label: string }
interface Context { readonly prefix: string }
interface Payload { readonly value: number }

function target() {
  return { textContent: "" } as unknown as Element;
}

function definition() {
  return defineDomComponent<Props, Context, Payload>({
    manifest: {
      id: "example/dom-card",
      version: "1.0.0",
      requirements: [{ name: "browser-dom", version: "1" }],
    },
    implementation: {
      mount(element, input) {
        const node = element as unknown as { textContent: string };
        const render = (next: typeof input) => {
          node.textContent = next.context.prefix + next.props.label + ":" + next.payload.value;
        };
        render(input);
        return {
          update(next) { render(next); },
          destroy() { node.textContent = ""; },
        };
      },
    },
    validateProps(input) {
      if (typeof input !== "object" || input === null || !("label" in input)) {
        throw new TypeError("Expected label");
      }
      return { label: String((input as { label: unknown }).label).trim() };
    },
    validatePayload(input) {
      if (typeof input !== "object" || input === null || !("value" in input)) {
        throw new TypeError("Expected value");
      }
      return { value: Number((input as { value: unknown }).value) };
    },
  });
}

describe("DOM adapter", () => {
  it("mounts, updates, and destroys ordinary DOM content", () => {
    const element = target();
    const mounted = mountDomComponent({
      definition: definition(),
      target: element,
      props: { label: "item" },
      context: { prefix: "#" },
      payload: { value: 1 },
      hostCapabilities: [{ name: "browser-dom", version: "1" }],
    });
    expect((element as unknown as { textContent: string }).textContent).toBe("#item:1");
    mounted.update({ props: { label: "next" }, context: { prefix: "!" }, payload: { value: 2 } });
    expect((element as unknown as { textContent: string }).textContent).toBe("!next:2");
    mounted.destroy();
    expect((element as unknown as { textContent: string }).textContent).toBe("");
  });

  it("rejects an incompatible capability before mount", () => {
    const mount = vi.fn();
    const component = defineDomComponent<Props, Context, Payload>({
      manifest: {
        id: "example/dom-v2",
        version: "1.0.0",
        requirements: [{ name: "browser-dom", version: "2" }],
      },
      implementation: { mount },
    });
    expect(() =>
      mountDomComponent({
        definition: component,
        target: target(),
        props: { label: "x" },
        context: { prefix: "" },
        payload: { value: 1 },
        hostCapabilities: [{ name: "browser-dom", version: "1" }],
      }),
    ).toThrow(ComponentOnceCapabilityVersionError);
    expect(mount).not.toHaveBeenCalled();
  });

  it("validates raw boundary values once", () => {
    const component = definition();
    const element = target();
    const mounted = mountDomComponentBoundary({
      definition: component,
      target: element,
      props: { label: " raw " },
      context: { prefix: "[" },
      payload: { value: "7" },
      hostCapabilities: [{ name: "browser-dom", version: "1" }],
    });
    expect((element as unknown as { textContent: string }).textContent).toBe("[raw:7");
    mounted.destroy();
  });
});
