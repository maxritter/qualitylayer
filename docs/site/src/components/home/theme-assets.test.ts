import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEEP_DIVE, SITE_URL } from "@/lib/product";

const root = resolve(import.meta.dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const contrast = (foreground: string, background: string) => {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map((channel) => Number.parseInt(channel, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
};

describe("illustrations in both themes", () => {
  it("keeps the drawn artifact and its thumbnails on the site's theme palette", () => {
    const css = read("docs/site/src/styles/closeup.css");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => /\.cu-(?:dp|dz)/.test(selector));
    expect(rules.length).toBeGreaterThan(12);
    for (const [rule, selector] of rules) {
      expect(rule, selector).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i);
    }
  });

  it("keeps README theme pairs and a directly linked video poster", () => {
    const markdown = read("README.md");
    const pictures = [...markdown.matchAll(/<picture>([\s\S]*?)<\/picture>/g)];
    expect(pictures.length).toBeGreaterThan(0);
    const poster = /<a href="https:\/\/qualitylayer-media\.max-ritter\.workers\.dev\/[^"]+\.mp4"[^>]*><img src="docs\/img\/film-poster-dark\.webp"[^>]*><\/a>/;
    expect(markdown, "README film poster plays the video").toMatch(poster);
    expect(existsSync(resolve(root, "docs/img/film-poster-dark.webp"))).toBe(true);
    const deepDive = new RegExp(`<a href="${SITE_URL}${DEEP_DIVE.href}"><img src="docs/img/inside-qualitylayer-deep-dive.svg"[^>]*></a>`);
    expect(markdown).toMatch(deepDive);
    expect(existsSync(resolve(root, "docs/img/inside-qualitylayer-deep-dive.svg"))).toBe(true);
    const standalone = markdown.replace(/<picture>[\s\S]*?<\/picture>/g, "")
      .replace(poster, "")
      .replace(deepDive, "")
      .replace(/<img\b[^>]*src="https:\/\/img\.shields\.io\/[^>]*>/g, "");
    expect(standalone).not.toMatch(/<img\b/);
    for (const [, picture] of pictures) {
      expect(picture).toContain('(prefers-color-scheme: dark)');
      const source = picture.match(/srcset="([^"]+)"/)?.[1];
      const fallback = picture.match(/src="([^"]+)"/)?.[1];
      expect(source).toBeTruthy();
      expect(fallback).toBeTruthy();
      expect(source).not.toBe(fallback);
      for (const path of [source, fallback]) {
        if (path!.startsWith("https://")) expect(path).toMatch(/^https:\/\/img\.shields\.io\//);
        else expect(existsSync(resolve(root, path!)), path).toBe(true);
      }
    }
  });

  it("frames an authored light still as a dimmed preview only in dark mode", () => {
    const css = read("docs/site/src/styles/shared.css");
    expect(css).toMatch(/:root\{--sh-preview-brightness:1\}/);
    expect(css).toMatch(/@media\(prefers-color-scheme:dark\).*:root:not\(\[data-theme="light"\]\)/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\{--sh-preview-brightness:/);
    expect(css).toMatch(/\.sh-frame img\{[^}]*filter:brightness\(var\(--sh-preview-brightness\)\)/);
  });

  it("uses the stronger accent for text on tinted surfaces and themes the docs footer itself", () => {
    for (const file of ["tour.css", "closeup.css", "shared.css", "factory.css"]) {
      const css = read(`docs/site/src/styles/${file}`);
      for (const [rule] of css.matchAll(/[^{}]+\{[^{}]*\}/g)) {
        if (/background:var\(--ql-accent-soft\)|background:color-mix\(in srgb,var\(--ql-accent\)/.test(rule)) {
          expect(rule, file).not.toMatch(/(?<![-\w])color:var\(--ql-accent\)/);
        }
      }
    }
    expect(read("docs/docusaurus/src/css/custom.css")).toMatch(/\.footer\s*\{[^}]*--ifm-footer-background-color:\s*var\(--ql-bg-sunken\)/);
  });

  it("pairs every docs illustration with the same diagram in the other theme", () => {
    const docs = "docs/docusaurus/docs";
    for (const file of readdirSync(resolve(root, docs), { recursive: true }).filter((file) => String(file).endsWith(".md"))) {
      const markdown = read(`${docs}/${file}`);
      for (const [, base, theme, extension] of markdown.matchAll(/\]\(pathname:\/\/\/(img\/[^)]+?)-(light|dark)\.(svg|png)\)/g)) {
        const path = `${base}-${theme}.${extension}`;
        const other = `${base}-${theme === "light" ? "dark" : "light"}.${extension}`;
        expect(markdown, String(file)).toContain(`pathname:///${other}`);
        expect(existsSync(resolve(root, "docs/docusaurus/static", path)), path).toBe(true);
      }
    }
  });

  it("keeps dark diagrams free of white page surfaces and their labels readable", () => {
    const diagrams = "docs/docusaurus/static/img/diagrams";
    const source = read("docs/docusaurus/scripts/diagrams.py");
    for (const theme of ["light", "dark"]) {
      const palette = source.match(new RegExp(`'${theme}': dict\\(([\\s\\S]*?)\\)`))![1];
      const color = (key: string) => palette.match(new RegExp(`\\b${key}='(#[0-9a-f]{6})'`))![1];
      for (const background of ["bg", "card"]) {
        for (const foreground of ["text", "muted", "dim"]) {
          expect(contrast(color(foreground), color(background)), `${theme} ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(color("onblue"), color("blue")), `${theme} button text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color("blueink"), color("bluef")), `${theme} blue label on blue surface`).toBeGreaterThanOrEqual(4.5);
    }
    for (const file of readdirSync(resolve(root, diagrams)).filter((file) => file.endsWith("-dark.svg"))) {
      expect(read(`${diagrams}/${file}`), file).not.toMatch(/<rect\b[^>]*\bfill="#ffffff"/);
    }
    for (const file of readdirSync(resolve(root, diagrams)).filter((file) => file.endsWith(".svg"))) {
      const background = file.endsWith("-dark.svg") ? "#0d1117" : "#ffffff";
      const rootTag = read(`${diagrams}/${file}`).match(/<svg\b[^>]*>/)?.[0] ?? "";
      const color = rootTag.match(/\bstyle="[^"]*background:\s*(#[\da-f]+)/i)?.[1];
      const fullHex = color?.length === 4 ? `#${[...color.slice(1)].map((digit) => digit + digit).join("")}` : color;
      expect(fullHex, `Full-size ${file}`).toBe(background);
    }
  });
});
