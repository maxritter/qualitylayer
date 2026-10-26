import { Fragment, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { AGENT_TOOLS, COMPARISONS, ROUNDUP_FAQS, ROUNDUP_PATH, SPEC_TOOLS, type Comparison, type ComparisonSource } from "@/lib/comparisons";
import { SITE_URL } from "@/lib/product";
import { pageMetadata } from "@/lib/seo";
import { faqStructuredData } from "@/lib/structured-data";
import "@/styles/comparisons.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
};
/** The earliest and the latest date these comparisons were checked. */
const span = (comparisons: Comparison[]) => {
  const dates = comparisons.map((c) => c.checked).sort();
  return { from: dates[0], checked: dates.at(-1)! };
};

function Sources({ sources, checked, from }: { sources: ComparisonSource[]; checked: string; from?: string }) {
  return (
    <section className="cp-sources" aria-labelledby="sources">
      <h2 id="sources">Sources, checked {MONTHS[Number(checked.slice(5, 7)) - 1]} {checked.slice(0, 4)}</h2>
      <p>{from !== undefined && from !== checked ? <>Checked between {longDate(from)} and <time dateTime={checked}>{longDate(checked)}</time></> : <>Checked on <time dateTime={checked}>{longDate(checked)}</time></>}. This compares public documentation; it is not a hands-on benchmark. QualityLayer's claims follow its <a href="/docs/steps/plan">Plan</a>, <a href="/docs/steps/verify">Verify</a>, <a href="/docs/steps/review">Review</a> and <a href="/docs/steps/pull-request">pull request</a> guides.</p>
      <ol>
        {sources.map(({ label, url }, index) => <li key={url} id={`source-${index + 1}`}><a href={url}>{label}</a></li>)}
      </ol>
    </section>
  );
}

/** Every comparison as a card: the tool, what it is best for and the link. */
function ComparisonCards({ current }: { current?: string }) {
  return (
    <ul className="cp-cards">
      {COMPARISONS.filter(({ slug }) => slug !== current).map(({ slug, name, bestFor }) => (
        <li key={slug}>
          <Link to={`/compare/${slug}`}>
            <span className="cp-card-name">QualityLayer vs {name}</span>
            <span className="cp-card-fit">{bestFor}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const QUALITYLAYER_ROW = {
  bestFor: "Approving a visual Plan, then reviewing evidence that the change works",
  plansWith: "Discuss, Research and a Plan with diagrams and clickable artifacts",
  runsIn: "Claude Code, Codex, Cursor, Grok, Antigravity, Pi and OpenCode, with the App",
};

/** One row per tool, QualityLayer first, the same three questions for each. */
function Glance({ tools, label }: { tools: Comparison[]; label: string }) {
  return (
    <div className="cp-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="cp-glance">
        <thead><tr><th scope="col">Tool</th><th scope="col">Consider it for</th><th scope="col">Plans with</th><th scope="col">Runs in</th></tr></thead>
        <tbody>
          <tr className="cp-ours"><th scope="row">QualityLayer</th><td>{QUALITYLAYER_ROW.bestFor}</td><td>{QUALITYLAYER_ROW.plansWith}</td><td>{QUALITYLAYER_ROW.runsIn}</td></tr>
          {tools.map(({ slug, name, bestFor, plansWith, runsIn }) => (
            <tr key={slug}><th scope="row"><Link to={`/compare/${slug}`} aria-label={`QualityLayer vs ${name}`}>{name}</Link></th><td>{bestFor}</td><td>{plansWith}</td><td>{runsIn}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The two products a head-to-head page compares, for search engines. */
function comparedProducts(c: Comparison) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `QualityLayer vs ${c.name}`,
    itemListElement: [
      { "@type": "ListItem", position: 1, item: { "@type": "SoftwareApplication", name: "QualityLayer", url: SITE_URL, applicationCategory: "DeveloperApplication" } },
      { "@type": "ListItem", position: 2, item: { "@type": "SoftwareApplication", name: c.name, url: c.sources[0].url, applicationCategory: "DeveloperApplication" } },
    ],
  };
}

/** Every comparison the hub lists, in its order. */
const comparisonList = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "QualityLayer comparisons",
  itemListElement: COMPARISONS.map(({ slug, name }, index) => ({
    "@type": "ListItem", position: index + 1, name: `QualityLayer vs ${name}`, url: `${SITE_URL}/compare/${slug}`,
  })),
};

/** What QualityLayer carries from the approved Plan to the merged pull request, said once per page. */
function ProofAndReview() {
  return (
    <section className="cp-proof" aria-labelledby="proof">
      <h2 id="proof">How QualityLayer carries proof into review</h2>
      <ul>
        <li><b>Before code</b><span>You approve the Plan: what changes, what stays, and how you will know it works.</span></li>
        <li><b>After the build</b><span>The <a href="/docs/steps/verify">Verify step</a> records output, screenshots or files for each agreed outcome. Checks that fail or cannot run stay visible in <a href="/docs/steps/review">Review</a>. An agent that did not write the code checks every change, unless you turn that off in Settings.</span></li>
        <li><b>Until it merges</b><span>With GitHub's <code>gh</code> CLI, QualityLayer <a href="/docs/steps/pull-request">follows the pull request</a> through checks and review. QualityLayer never merges it.</span></li>
      </ul>
    </section>
  );
}

function Frame({ title, lead, sources, checked, from, children, faq = false, data = [] }: {
  title: string;
  lead: string;
  sources: ComparisonSource[];
  checked: string;
  from?: string;
  /** Structured data this page adds: what it compares, or the comparisons it lists. */
  data?: Record<string, unknown>[];
  children: ReactNode;
  faq?: boolean;
}) {
  const { pathname } = useLocation();
  const metadata = pageMetadata(pathname);
  const breadcrumbs = [{ name: "Home", path: "/" }, { name: "Compare", path: "/compare" }];
  if (pathname !== "/compare") breadcrumbs.push({ name: title, path: pathname });
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${metadata.canonicalUrl}#webpage`,
      url: metadata.canonicalUrl,
      name: metadata.title,
      description: metadata.description,
      inLanguage: "en",
      lastReviewed: checked,
      dateModified: checked,
      publisher: { "@type": "Organization", name: "QualityLayer", url: SITE_URL },
      citation: sources.map(({ url }) => url),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map(({ name, path }, index) => ({
        "@type": "ListItem", position: index + 1, name, item: `${SITE_URL}${path}`,
      })),
    },
    ...(faq ? [faqStructuredData(ROUNDUP_FAQS)] : []),
    ...data,
  ];
  return (
    <>
      <SEO structuredData={structuredData} />
      <Page className="cp-page">
        <article className="w7-wrap cp-article">
          <nav aria-label="Breadcrumb" className="cp-breadcrumb">
            <ol>{breadcrumbs.map(({ name, path }, index) => <li key={path}>{index === breadcrumbs.length - 1 ? <span aria-current="page">{name}</span> : <Link to={path}>{name}</Link>}</li>)}</ol>
          </nav>
          <header className="cp-header">
            <h1>{title}</h1>
            <p className="w7-lead">{lead}</p>
          </header>
          {children}
          <Sources sources={sources} checked={checked} {...(from !== undefined ? { from } : {})} />
        </article>
      </Page>
    </>
  );
}

function HeadToHead({ comparison: c }: { comparison: Comparison }) {
  return (
    <Frame title={`QualityLayer vs ${c.name}`} lead={c.lead} sources={c.sources} checked={c.checked} data={[comparedProducts(c)]}>
      <section aria-labelledby="workflow">
        <h2 id="workflow">At a glance</h2>
        <div className="cp-table-scroll" role="region" aria-label={`${c.name} and QualityLayer workflow table`} tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Your task</th><th scope="col">QualityLayer</th><th scope="col">{c.name}</th></tr></thead>
            <tbody>
              <tr><th scope="row">Consider it for</th><td>{QUALITYLAYER_ROW.bestFor}</td><td>{c.bestFor}</td></tr>
              {c.rows.map(({ topic, qualitylayer, other, source }) => (
                <tr key={topic}><th scope="row">{topic}</th><td>{qualitylayer}</td><td>{other} <a href={`#source-${source}`}>[{source}]</a></td></tr>
              ))}
              <tr><th scope="row">Runs in</th><td>{QUALITYLAYER_ROW.runsIn}</td><td>{c.runsIn} <a href={`#source-${c.runsInSource ?? c.sources.length}`}>[{c.runsInSource ?? c.sources.length}]</a></td></tr>
            </tbody>
          </table>
        </div>
        <p className="cp-note">{c.agents}</p>
      </section>
      <section aria-labelledby="choose">
        <h2 id="choose">Which fits your work?</h2>
        <div className="cp-choose">
          <div>
            <h3>Where {c.name} is strong</h3>
            <p>{c.strengths}{(c.strengthsSources ?? [1]).map((n) => <Fragment key={n}>{" "}<a href={`#source-${n}`}>[{n}]</a></Fragment>)}</p>
            <p>{c.chooseOther}</p>
          </div>
          <div className="cp-ours">
            <h3>Where QualityLayer fits</h3>
            <p>{c.chooseQualityLayer}</p>
            <p className="cp-cta"><Link to="/download">Download the App</Link><Link to="/pricing">See pricing</Link></p>
          </div>
        </div>
      </section>
      <ProofAndReview />
      <section aria-labelledby="related">
        <h2 id="related">Other comparisons</h2>
        <ComparisonCards current={c.slug} />
        <p className="cp-more"><Link to="/compare">All comparisons</Link><Link to={ROUNDUP_PATH}>Spec-driven development tools by use case</Link></p>
      </section>
    </Frame>
  );
}

function CompareIndex() {
  return (
    <Frame title="Compare QualityLayer" lead="QualityLayer plans a change with you, builds it with your coding agent and checks the result before you approve it. Here is how it compares with spec-driven development tools, the agents' own plan modes and other coding agents." sources={COMPARISONS.map((c) => c.sources.at(-1)!)} {...span(COMPARISONS)} data={[comparisonList]}>
      <section aria-labelledby="glance">
        <h2 id="glance">At a glance</h2>
        <p>Each tool's name opens its side-by-side comparison.</p>
        <h3>Spec-driven tools and plan modes</h3>
        <Glance tools={SPEC_TOOLS} label="Spec-driven development tools at a glance" />
        <h3>Coding agents and agent managers</h3>
        <Glance tools={AGENT_TOOLS} label="Coding agents and agent managers at a glance" />
        <p className="cp-more"><Link to={ROUNDUP_PATH}>Spec-driven development tools by use case</Link><a href="/docs/steps/verify">How Verify works</a></p>
      </section>
      <ProofAndReview />
    </Frame>
  );
}

function Roundup() {
  const sources = SPEC_TOOLS.flatMap((c) => c.sources);
  return (
    <Frame title="Best spec-driven development tools for your workflow" lead={`The best fit depends on where you want structure: writing specs, coordinating agents or reviewing evidence. Here is how QualityLayer and ${SPEC_TOOLS.length} other tools, from GitHub Spec Kit and Superpowers to Kiro and the agents' own plan modes, approach that work.`} sources={sources} {...span(SPEC_TOOLS)} faq>
      <section aria-labelledby="criteria">
        <h2 id="criteria">How to choose</h2>
        <p>Compare the tools on the same change: define an outcome, inspect the plan, build it and ask what proves it works. This guide uses the public docs linked below. It assigns no scores or performance ranking.</p>
        <p>Ask where the specs live, which agent executes the work, who checks the implementation and what happens when a check cannot run. Human approval and a useful AI code review process depend on those details.</p>
      </section>
      <section aria-labelledby="tools">
        <h2 id="tools">Tools by use case</h2>
        <div className="cp-table-scroll" role="region" aria-label="Spec-driven development tools by use case" tabIndex={0}>
          <table>
            <caption>A starting point for evaluating your own workflow</caption>
            <thead><tr><th scope="col">Tool</th><th scope="col">Consider it for</th><th scope="col">What the docs describe</th></tr></thead>
            <tbody>
              {SPEC_TOOLS.map(({ slug, name, bestFor, plansWith, sources: [docs] }) => <tr key={slug}><th scope="row"><Link to={`/compare/${slug}`}>{name}</Link></th><td>{bestFor}</td><td>Plans with: {plansWith}. <a href={docs.url}>Docs</a></td></tr>)}
              <tr><th scope="row"><Link to="/">QualityLayer</Link></th><td>Visual planning and human review with recorded proof</td><td>Approve the Plan, check agreed outcomes in Verify and review the evidence before opening a pull request. <a href="/docs/steps/review">Docs</a></td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="agent-fit">
        <h2 id="agent-fit">Keeping Claude Code or Codex</h2>
        <p>QualityLayer, <a href="https://github.com/humanlayer/skills#rpi">HumanLayer's RPI skills</a>, <a href="https://github.github.io/spec-kit/reference/integrations.html">Spec Kit</a> and <a href="https://openspec.dev/docs/supported-tools">OpenSpec</a> all support Claude Code and Codex. This is an overlap to evaluate honestly.</p>
        <p><a href="https://kiro.dev/docs/specs/">Kiro's docs</a> describe specs across its own IDE, CLI and web surfaces. Consider Kiro if you want that integrated environment; compare the other options if you want a process in your existing agent session.</p>
      </section>
      <section aria-labelledby="verify-code">
        <h2 id="verify-code">How to verify AI generated code</h2>
        <p>A specification makes intent reviewable. To check the result, turn acceptance criteria into observable behavior, run your project's tests, types, lint and build, then exercise the relevant behavior in the running program.</p>
        <p>Keep the evidence with the change. A review should distinguish checks that passed, checks that failed and checks that the environment blocked. Ask whether the reviewer wrote the code and whether a second reviewer is required for the risk involved.</p>
        <p>The tools overlap here too. <a href="https://github.github.io/spec-kit/reference/agentic-sdd.html">Spec Kit has convergence checks</a>; <a href="https://openspec.dev/docs/skills#openspec-verify-change">OpenSpec has optional verification</a>; <a href="https://kiro.dev/docs/specs/correctness/">Kiro documents property-based testing in its IDE</a>. Compare the evidence and approval process around those checks.</p>
      </section>
      <ProofAndReview />
      <section aria-labelledby="questions">
        <h2 id="questions">Common questions</h2>
        {ROUNDUP_FAQS.map(({ question, answer }) => <div key={question}><h3>{question}</h3><p>{answer}</p></div>)}
      </section>
      <section aria-labelledby="next">
        <h2 id="next">Evaluate it on a real change</h2>
        <p>Use a task with a testable outcome and an edge case. Compare how much you understand before implementation and what you can verify afterward.</p>
        <p><Link to="/compare">Read the detailed comparisons</Link>, including coding agents such as Cline, Aider and Devin, explore <a href="/docs/steps/verify">Verify</a> and <a href="/docs/steps/review">Review</a>, or check <Link to="/pricing">QualityLayer pricing</Link>.</p>
      </section>
    </Frame>
  );
}

export default function Compare() {
  const { pathname } = useLocation();
  if (pathname === ROUNDUP_PATH) return <Roundup />;
  const comparison = COMPARISONS.find(({ slug }) => pathname === `/compare/${slug}`);
  return comparison ? <HeadToHead comparison={comparison} /> : <CompareIndex />;
}
