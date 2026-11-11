import React, { type ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Admonition from "@theme/Admonition";
import DocusaurusTabs from "@theme/Tabs";
import TabItem from "@theme/TabItem";
import { Icon, type IconName } from "./icons";
import styles from "./kit.module.css";

/*
 * The docs style kit: cards, steps, callouts, tabs, screenshots, a left-to-right flow and next steps.
 * Import it in an .mdx page (front matter `mdx: { format: mdx }`):
 *   import { Card, CardGroup, Steps, Step, Tip, Note, Warning, Tabs, Tab, Screenshot, Flow, NextSteps } from "@site/src/components/kit";
 */

export type { IconName };
/** The step a card or flow node belongs to; it tints the icon with the App's step colour. */
type Tone = "plan" | "implement" | "verify";

type CardProps = { title: string; icon?: IconName; href?: string; tone?: Tone; children?: ReactNode };

/** One idea: an icon, a title and a line. The whole card is the link when it has one. */
export function Card({ title, icon, href, tone, children }: CardProps): ReactNode {
  const body = (
    <>
      <span className={styles.cardHead}>
        {icon && <span className={clsx(styles.cardIcon, tone && styles[tone])}><Icon name={icon} /></span>}
        <span className={styles.cardTitle}>{title}</span>
        {href && <span className={styles.cardArrow}><Icon name="arrow-right" size={15} /></span>}
      </span>
      {children && <span className={styles.cardBody}>{children}</span>}
    </>
  );
  return href
    ? <Link className={clsx(styles.card, styles.cardLink)} to={href}>{body}</Link>
    : <div className={styles.card}>{body}</div>;
}

/** Cards side by side: two or three columns on a desktop, one on a phone. */
export function CardGroup({ cols = 3, children }: { cols?: 2 | 3; children: ReactNode }): ReactNode {
  return <div className={clsx(styles.cardGroup, cols === 2 ? styles.cols2 : styles.cols3)}>{children}</div>;
}

/** Numbered steps on a rail. Each Step has a short title; its body can hold text, code and tabs. */
export function Steps({ children }: { children: ReactNode }): ReactNode {
  return <ol className={styles.steps}>{children}</ol>;
}

export function Step({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <li className={styles.step}>
      <p className={styles.stepTitle}>{title}</p>
      {children && <div className={styles.stepBody}>{children}</div>}
    </li>
  );
}

function Callout({ type, label, icon, children }: { type: "tip" | "info" | "warning"; label: string; icon: IconName; children: ReactNode }): ReactNode {
  return (
    <Admonition type={type} className={styles.callout} icon={<Icon name={icon} size={17} />} title={<span className={styles.srOnly}>{label}</span>}>
      {children}
    </Admonition>
  );
}

/** A shortcut or a better way to do something. */
export const Tip = ({ children }: { children: ReactNode }): ReactNode => <Callout type="tip" label="Tip" icon="lightbulb">{children}</Callout>;
/** A fact worth knowing that the steps do not depend on. */
export const Note = ({ children }: { children: ReactNode }): ReactNode => <Callout type="info" label="Note" icon="info">{children}</Callout>;
/** Something that goes wrong or costs work if skipped. */
export const Warning = ({ children }: { children: ReactNode }): ReactNode => <Callout type="warning" label="Warning" icon="triangle-alert">{children}</Callout>;

/**
 * Docusaurus Tabs, styled as the App's segmented tabs. Tabs with the same groupId switch together
 * across the page and are remembered, so a reader who picks "In your own agent" or "Linux" once keeps it.
 * Children must be <Tab value="…" label="…"> directly.
 */
export function Tabs(props: React.ComponentProps<typeof DocusaurusTabs>): ReactNode {
  return <DocusaurusTabs {...props} className={clsx(styles.tabs, props.className)} />;
}
export const Tab = TabItem;

type ScreenshotProps = {
  /** The capture's base name in static/img/app, such as "plan" for plan-light.webp and plan-dark.webp. */
  name?: string;
  alt: string;
  caption?: ReactNode;
  /** Instead of a picture: what the missing capture must show. Draws a placeholder frame. */
  todo?: string;
};

/**
 * An App capture in the theme the reader uses. The files already carry the shared frame from the
 * screenshot pipeline, so the kit adds none. A `todo` draws a placeholder until the capture exists.
 */
export function Screenshot({ name, alt, caption, todo }: ScreenshotProps): ReactNode {
  const light = useBaseUrl(`/img/app/${name}-light.webp`);
  const dark = useBaseUrl(`/img/app/${name}-dark.webp`);
  if (todo || !name) {
    // A placeholder is for review on the dev server; a production page must ship the real capture.
    if (process.env.NODE_ENV === "production") throw new Error(`Screenshot placeholder in a production page: ${todo ?? alt}`);
    return (
      <figure className={styles.shot}>
        <div className={styles.placeholder} role="img" aria-label={`Picture to capture: ${alt}`}>
          <Icon name="image" size={22} />
          <span className={styles.placeholderLabel}>Picture to capture</span>
          <span className={styles.placeholderText}>{todo ?? alt}</span>
        </div>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  }
  return (
    <figure className={styles.shot}>
      {(["light", "dark"] as const).map((theme) => (
        <a key={theme} className={clsx(styles.shotLink, styles[theme])} href={theme === "light" ? light : dark} target="_blank" rel="noopener noreferrer" aria-label={`Open full size: ${alt}`}>
          <img src={theme === "light" ? light : dark} alt={alt} loading={theme === "light" ? "eager" : "lazy"} decoding="async" />
        </a>
      ))}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

type FlowNode = { icon: IconName; label: string; detail?: string; tone?: Tone };

/** A small left-to-right diagram of icon nodes; it turns top to bottom on a phone. `via` labels the arrows. */
export function Flow({ nodes, via = [], label }: { nodes: FlowNode[]; via?: string[]; label: string }): ReactNode {
  return (
    <figure className={styles.flow} aria-label={label}>
      {nodes.map((node, index) => (
        <React.Fragment key={node.label}>
          {index > 0 && (
            <span className={styles.flowArrow} aria-hidden={!via[index - 1]}>
              {via[index - 1] && <span className={styles.flowVia}>{via[index - 1]}</span>}
              <span className={styles.flowLine} />
            </span>
          )}
          <span className={styles.flowNode}>
            <span className={clsx(styles.cardIcon, node.tone && styles[node.tone])}><Icon name={node.icon} /></span>
            <span className={styles.flowLabel}>{node.label}</span>
            {node.detail && <span className={styles.flowDetail}>{node.detail}</span>}
          </span>
        </React.Fragment>
      ))}
    </figure>
  );
}

/** Where to go from here, as compact link cards (title, one line, arrow) at the bottom of the page. */
export function NextSteps({ items }: { items: Array<{ title: string; href: string; text: string }> }): ReactNode {
  return (
    <nav className={styles.next} aria-label="Next steps">
      <p className={styles.nextLabel}>Next</p>
      <CardGroup cols={items.length === 2 ? 2 : 3}>
        {items.map((item) => <Card key={item.href} title={item.title} href={item.href}>{item.text}</Card>)}
      </CardGroup>
    </nav>
  );
}
