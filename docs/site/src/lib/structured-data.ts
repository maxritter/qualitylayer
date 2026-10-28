import type { Faq } from "./content";
import { PLANS, PRICE_CURRENCY } from "./pricing";
import { AUTHOR_NAME, AUTHOR_URL, SHARE_DESCRIPTION, SITE_URL } from "./product";

export const SOFTWARE_APPLICATION = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: "QualityLayer",
  description: SHARE_DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  author: { "@type": "Person", name: AUTHOR_NAME, url: AUTHOR_URL },
  url: `${SITE_URL}/`,
  image: `${SITE_URL}/og.png`,
};

export const PRICING_APPLICATION = {
  ...SOFTWARE_APPLICATION,
  offers: PLANS.flatMap((plan) => {
    if (plan.price === "Custom") return [];
    const { monthly, yearly } = plan.price;
    return (["monthly", "yearly"] as const).map((billing) => ({
      "@type": "Offer",
      name: `${plan.name} — ${billing}`,
      description: `${plan.audience} Billed ${billing}.`,
      url: `${SITE_URL}/pricing#plans`,
      price: billing === "yearly" ? yearly : monthly,
      priceCurrency: PRICE_CURRENCY,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: billing === "yearly" ? yearly : monthly,
        priceCurrency: PRICE_CURRENCY,
        billingDuration: billing === "yearly" ? "P1Y" : "P1M",
      },
    }));
  }),
};

export function faqStructuredData(faqs: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

