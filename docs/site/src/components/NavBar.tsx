import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Link, useLocation } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { useNarrow } from "@/hooks/useNarrow";
import { useTheme } from "@/hooks/useTheme";
import { DOCS_URL, GITHUB_URL } from "@/lib/product";

type NavLink = { label: string; to: string; external?: boolean };

const LINKS: NavLink[] = [
  { label: "Your agents", to: "/#agents" },
  { label: "How it works", to: "/#tour" },
  { label: "Teams", to: "/#team" },
  { label: "Docs", to: DOCS_URL, external: true },
];

const Item = ({ link, onClick }: { link: NavLink; onClick?: () => void }) => {
  const { pathname } = useLocation();
  if (link.external) return <a href={link.to}>{link.label}</a>;
  return <Link to={link.to} onClick={onClick} aria-current={pathname === link.to ? "page" : undefined}>{link.label}</Link>;
};

export const Logo = ({ small }: { small?: boolean }) => (
  <Link className={`w7-logo${small ? " sm" : ""}`} to="/" aria-label="QualityLayer home">
    <span className="w7-mark" aria-hidden="true" />qualitylayer
  </Link>
);

/** The GitHub mark (Octicons, MIT). */
const GitHubMark = () => (
  <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

function Icons({ themeOnly = false }: { themeOnly?: boolean }) {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <>
      {themeOnly ? null : <Button asChild variant="ghost" size="icon-lg" className="w7-icon"><a href={GITHUB_URL} aria-label="GitHub repository"><GitHubMark /></a></Button>}
      <Button type="button" variant="ghost" size="icon-lg" className="w7-icon" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
        {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </Button>
    </>
  );
}

const NavBar = ({ compact = false }: { compact?: boolean }) => {
  const [open, setOpen] = useState(false);
  // The menu only exists on narrow screens: a shadcn/ui Sheet that traps focus, closes on Escape, and every link in it closes it.
  const narrow = useNarrow();

  return (
    <header className="w7-hdr">
      <div className="w7-hdr-row">
        <Logo />
        {compact ? <div className="w7-hdr-tools"><Icons themeOnly /></div> : narrow ? (
          <div className="w7-hdr-tools">
            <Icons />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="lg" className="w7-menu">Menu</Button>
              </SheetTrigger>
              <SheetContent side="right" className="w7-sheet">
                <SheetTitle className="w7-sr">Menu</SheetTitle>
                <SheetDescription className="w7-sr">Pages of the QualityLayer site</SheetDescription>
                <nav className="w7-mnav" aria-label="Mobile">
                  {LINKS.map((link) => <Item key={link.label} link={link} onClick={() => setOpen(false)} />)}
                  <Button asChild size="xl" className="w7-nav-cta"><Link to="/download" onClick={() => setOpen(false)}>Download</Link></Button>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        ) : (
          <nav className="w7-nav" aria-label="Main">
            {LINKS.map((link) => <Item key={link.label} link={link} />)}
            <span className="w7-hdr-tools"><Icons /></span>
            <Button asChild size="lg" className="w7-nav-cta"><Link to="/download">Download</Link></Button>
          </nav>
        )}
      </div>
    </header>
  );
};

export default NavBar;
