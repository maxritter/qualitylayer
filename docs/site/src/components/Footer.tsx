import { Link } from "react-router-dom";
import { Logo } from "@/components/NavBar";
import { CHANGELOG_URL, CONTACT_EMAIL, DOCS_URL, GITHUB_URL } from "@/lib/product";

const Footer = () => (
  <footer className="w7-ftr">
    <div className="w7-ftr-wrap">
      <div className="w7-ftr-row">
        <Logo small />
        <nav className="w7-ftr-nav" aria-label="Footer">
          <a href={DOCS_URL}>Docs</a>
          <Link to="/pricing">Pricing</Link>
          <Link to="/compare">Compare</Link>
          <a href="/blog">Blog</a>
          <a href={GITHUB_URL}>GitHub</a>
          <a href={CHANGELOG_URL}>Changelog</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </nav>
        <p className="w7-legal">
          © 2026 QualityLayer · by <a href="https://www.maxritter.net/">Max Ritter</a> · <Link to="/imprint">Imprint</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
        </p>
      </div>
    </div>
  </footer>
);

export default Footer;
