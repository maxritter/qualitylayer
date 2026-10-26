import React from "react";
import Head from "@docusaurus/Head";
import Metadata from "@theme-original/DocItem/Metadata";
import { useDoc } from "@docusaurus/plugin-content-docs/client";

const ORIGIN = "https://qualitylayer.dev";

/** Describe each docs page as a TechArticle, next to the breadcrumb Docusaurus already emits. */
export default function DocItemMetadata() {
  const { metadata, frontMatter, assets } = useDoc();
  const url = `${ORIGIN}${metadata.permalink.replace(/\/$/, "")}`;
  const image = assets.image ?? frontMatter.image;
  const data = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: metadata.title,
    description: metadata.description,
    url,
    mainEntityOfPage: url,
    inLanguage: "en",
    ...(image ? { image: new URL(image, ORIGIN).toString() } : { image: `${ORIGIN}/og.png` }),
    ...(metadata.lastUpdatedAt ? { dateModified: new Date(metadata.lastUpdatedAt).toISOString() } : {}),
    author: { "@type": "Person", name: "Max Ritter", url: "https://www.maxritter.net/" },
    publisher: { "@type": "Organization", name: "QualityLayer", url: ORIGIN, logo: `${ORIGIN}/logo.png` },
    about: { "@type": "SoftwareApplication", name: "QualityLayer", url: ORIGIN, applicationCategory: "DeveloperApplication" },
    isPartOf: { "@type": "WebSite", name: "QualityLayer Docs", url: `${ORIGIN}/docs` },
  };
  return (
    <>
      <Metadata />
      <Head>
        <script type="application/ld+json">{JSON.stringify(data).replaceAll("<", "\\u003c")}</script>
      </Head>
    </>
  );
}
