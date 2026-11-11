import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import "@/styles/shared.css";

/**
 * Every /s/<id> link lands here. Public share links are retired: the page reads neither the link's
 * id nor its key, fetches nothing and decrypts nothing. /api/share keeps answering older Apps.
 */
const Shared = () => (
  <Page className="sh-page" compact>
    <SEO title="Shared link retired | QualityLayer" description="QualityLayer no longer opens shared links." />
    <Helmet>
      <meta name="robots" content="noindex" />
    </Helmet>
    <div className="sh-status">
      <h1>This shared link has been retired</h1>
      <p>QualityLayer no longer opens shared links. Ask the person who sent it to you for the work itself.</p>
      <Button asChild size="lg">
        <Link to="/">Go to qualitylayer.dev</Link>
      </Button>
    </div>
  </Page>
);

export default Shared;
