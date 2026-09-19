import { defineDomComponent } from "@componentonce/dom";

export const plainCard = defineDomComponent<
  { readonly title: string },
  { readonly format: (value: string) => string },
  { readonly count: number }
>({
  manifest: {
    id: "example/plain-card",
    version: "1.0.0",
    requirements: [{ name: "browser-dom", version: "1" }],
  },
  implementation: {
    mount(target, input) {
      const render = (next: typeof input) => {
        target.textContent = next.context.format(next.props.title) + " (" + next.payload.count + ")";
      };
      render(input);
      return {
        update(next) { render(next); },
        destroy() { target.replaceChildren(); },
      };
    },
  },
});
