import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Footer from "@/components/Footer";
import NavBar from "@/components/NavBar";

/** The frame every page shares. The wrapper is the size container the responsive rules key on. */
const Page = ({ children, className, compact = false }: { children: ReactNode; className?: string; compact?: boolean }) => (
  <div className={className ? `w7-root ${className}` : "w7-root"}>
    <a className="w7-skip" href="#main">Skip to content</a>
    <NavBar compact={compact} />
    <main id="main">{children}</main>
    {compact ? <footer className="sh-footer"><span>QualityLayer</span><div><a href="mailto:hello@qualitylayer.dev">hello@qualitylayer.dev</a><Link to="/imprint">Imprint</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></footer> : <Footer />}
  </div>
);

export default Page;
