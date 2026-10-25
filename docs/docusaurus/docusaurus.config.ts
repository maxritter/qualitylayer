import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { docsSourceUrl } from "./source-links";

const config: Config = {
  title: "QualityLayer",
  tagline: "Guides and reference for QualityLayer, the software factory with you in the loop",
  favicon: "img/favicon.png",

  url: "https://qualitylayer.dev",
  baseUrl: "/",
  // Match Vercel's `trailingSlash: false` so canonicals point to the actually-served URL.
  // Without this, Docusaurus emits canonical=/docs/X/ but Vercel 308-redirects to /docs/X.
  // Google sees the conflict and declines to index the entry point.
  trailingSlash: false,

  organizationName: "maxritter",
  projectName: "pilot-shell",

  onBrokenLinks: "throw",

  markdown: {
    format: "md",
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  themes: ["@easyops-cn/docusaurus-search-local"],

  scripts: [
    {
      src: "https://analytics.ahrefs.com/analytics.js",
      "data-key": "z+ZckeCmmFW1kMjAfQEXLA",
      async: true,
    },
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
          editUrl: ({ docPath }) => docsSourceUrl(docPath),
        },
        blog: {
          routeBasePath: "blog",
          path: "./blog",
          blogTitle: "QualityLayer Blog",
          blogDescription:
            "Engineering notes and guides. Earlier posts retain their original Pilot Shell context.",
          blogSidebarTitle: "Recent posts",
          blogSidebarCount: "ALL",
          postsPerPage: 12,
          showReadingTime: true,
          feedOptions: {
            type: ["rss", "atom"],
            title: "QualityLayer Blog",
            description:
              "QualityLayer engineering notes and earlier Pilot Shell articles.",
            copyright: `Copyright © ${new Date().getFullYear()} QualityLayer.`,
          },
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
        sitemap: {
          changefreq: "weekly",
          priority: 0.7,
          ignorePatterns: ["/tags/**"],
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "https://qualitylayer.dev/og.png",
    metadata: [
      {
        name: "keywords",
        content:
          "QualityLayer, software factory, agentic software factory, human in the loop, coding agents, SDLC, shift left, planning, test-first development, QualityLayer App, Claude Code, Codex, independent review, team plan review",
      },
      { property: "og:image:alt", content: "QualityLayer, quality by design: the software factory with you in the loop. Seven steps: Discuss, Research, Plan, Outline, Implement, Verify, Review" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@maxritter" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "QualityLayer" },
    ],
    colorMode: {
      defaultMode: "light",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "QualityLayer",
      logo: {
        alt: "QualityLayer",
        src: "img/qualitylayer-mark.svg",
        srcDark: "img/qualitylayer-mark-dark.svg",
        href: "/docs/",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          to: "/blog",
          label: "Blog",
          position: "left",
        },
        {
          href: "https://github.com/maxritter/qualitylayer/releases",
          label: "Changelog",
          position: "left",
        },
        {
          href: "https://qualitylayer.dev",
          label: "Home",
          position: "right",
        },
        {
          href: "https://github.com/maxritter/qualitylayer",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Install", to: "/docs/install" },
            { label: "Workflow", to: "/docs#the-seven-steps" },
            { label: "Command reference", to: "/docs/reference/commands" },
            { label: "Changelog", href: "https://github.com/maxritter/qualitylayer/releases" },
            { label: "Blog", to: "/blog" },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/maxritter/qualitylayer",
            },
          ],
        },
        {
          title: "More",
          items: [
            { label: "Home", href: "https://qualitylayer.dev" },
            { label: "Download", href: "https://qualitylayer.dev/download" },
            { label: "Compare", href: "https://qualitylayer.dev/compare" },
            { label: "Spec-driven development tools", href: "https://qualitylayer.dev/best-spec-driven-development-tools" },
          ],
        },
        {
          title: "Legal",
          items: [
            { label: "Imprint", href: "https://qualitylayer.dev/imprint" },
            { label: "Privacy", href: "https://qualitylayer.dev/privacy" },
            { label: "Terms", href: "https://qualitylayer.dev/terms" },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} QualityLayer.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.vsDark,
      additionalLanguages: ["bash", "json", "python", "toml"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
