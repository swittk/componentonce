import { defineReactDevHost } from "@componentonce/dev/host";
import "./host.css";

interface ContextInput { readonly locale: string; readonly currency: string }

/** This module runs only in the browser; replace with the real application's SDK and providers. */
export default defineReactDevHost({
  name: "Portfolio workspace",
  capabilities: [{ name: "example-host", version: "1" }],
  themes: [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
  applyTheme(value) {
    document.documentElement.dataset.theme = value;
  },
  fixtures: [
    { name: "Brand project · USD", props: { title: "Build something worth sharing", actionLabel: "Approve milestone" }, payload: { project: "Studio North · Brand refresh", amount: 4200 }, context: { locale: "en-US", currency: "USD" } },
    { name: "Local project · THB", props: { title: "A different host, same component", actionLabel: "Approve milestone" }, payload: { project: "Independent studio · New website", amount: 48000 }, context: { locale: "th-TH", currency: "THB" } },
  ],
  createContext(input: ContextInput) {
    const formatter = new Intl.NumberFormat(input.locale, { style: "currency", currency: input.currency, maximumFractionDigits: 0 });
    return { formatAmount: (value: number) => formatter.format(value) };
  },
});
