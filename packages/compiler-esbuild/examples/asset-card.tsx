import * as React from "react";
import { createReactRequirement, defineReactComponent } from "@componentonce/react";
import styles from "./asset-card.module.css";
import logoUrl from "./asset-logo.svg";

interface AssetCardProps {
  readonly title: string;
}

/** Example React definition using an embedded CSS Module, SVG, and font URL. */
export const definition = defineReactComponent<AssetCardProps, unknown, unknown>({
  manifest: {
    id: "example/asset-card",
    version: "1.0.0",
    requirements: [createReactRequirement(React.version)],
  },
  component({ props }) {
    return (
      <article className={styles.card}>
        <img src={logoUrl} alt="" />
        <strong>{props.title}</strong>
      </article>
    );
  },
});
