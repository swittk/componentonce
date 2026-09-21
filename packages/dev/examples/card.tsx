import * as React from "react";
import { defineReactComponent, createReactRequirement } from "@componentonce/react";
import styles from "./card.module.css";
import logo from "./logo.svg";

interface Props { readonly title: string; readonly actionLabel: string }
interface Payload { readonly amount: number; readonly project: string }
interface Context { readonly formatAmount: (value: number) => string }

/** A portable interactive card exercising CSS Modules, images, host functions and hooks. */
export const definition = defineReactComponent<Props, Context, Payload>({
  manifest: {
    id: "example/project-card", version: "1.0.0", displayName: "Project card",
    requirements: [createReactRequirement(React.version), { name: "example-host", version: "1" }],
  },
  validateProps(input) {
    if (typeof input !== "object" || input === null || !("title" in input) || typeof input.title !== "string") throw new TypeError("Props need a title string.");
    return { title: input.title, actionLabel: "actionLabel" in input && typeof input.actionLabel === "string" ? input.actionLabel : "Approve milestone" };
  },
  validatePayload(input) {
    if (typeof input !== "object" || input === null || !("amount" in input) || typeof input.amount !== "number" || !Number.isFinite(input.amount)) throw new TypeError("Payload needs a finite amount.");
    return { amount: input.amount, project: "project" in input && typeof input.project === "string" ? input.project : "Untitled project" };
  },
  component({ props, payload, context }) {
    const [approved, setApproved] = React.useState(0);
    return <article className={styles.card}>
      <div className={styles.eyebrow}><img src={logo} alt="" width="34" height="34" /><span>YOUR WORK, IN CONTEXT</span><span className={styles.badge}>Active</span></div>
      <h1>{props.title}</h1><p className={styles.description}>One portable component. Real host context. Change the source or the fixture and see it here.</p>
      <div className={styles.project}><span>PROJECT</span><strong>{payload.project}</strong></div>
      <div className={styles.numbers}><div><span>Budget</span><strong>{context.formatAmount(payload.amount)}</strong></div><div><span>Milestones approved</span><strong data-testid="approved">{approved}</strong></div></div>
      <div className={styles.progress}><div style={{ width: `${Math.min(approved, 5) * 20}%` }} /></div>
      <div className={styles.bottom}><span>Interactive React state</span><button onClick={() => setApproved((count) => count + 1)}>{props.actionLabel}</button></div>
    </article>;
  },
});
