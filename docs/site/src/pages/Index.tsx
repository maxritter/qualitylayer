import { lazy, Suspense } from "react";
import Hero from "@/components/home/Hero";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { FAQS } from "@/lib/content";
import { GITHUB_URL, SHARE_DESCRIPTION, SITE_URL } from "@/lib/product";
import { faqStructuredData, SOFTWARE_APPLICATION } from "@/lib/structured-data";

const ABOUT = SHARE_DESCRIPTION;

// Below the fold: one chunk, loaded after first paint.
const Sections = lazy(() => import("@/components/home/Sections"));

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "QualityLayer",
    url: `${SITE_URL}/`,
    description: ABOUT,
    inLanguage: "en-US",
    publisher: {
      "@type": "Organization",
      name: "QualityLayer",
      url: `${SITE_URL}/`,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` },
      sameAs: [GITHUB_URL, "https://www.linkedin.com/in/rittermax/"],
    },
  },
  SOFTWARE_APPLICATION,
  faqStructuredData(FAQS),
];

const Index = () => (
  <>
    <SEO structuredData={structuredData} />
    <Page className="mx-home">
      <Hero />
      <Suspense fallback={<div aria-hidden="true" style={{ minHeight: "40vh" }} />}>
        <Sections />
      </Suspense>
    </Page>
  </>
);

export default Index;
