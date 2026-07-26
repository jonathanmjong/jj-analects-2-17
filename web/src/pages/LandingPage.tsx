import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Plus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Logo } from "../components/ui/Logo";
import { Reveal } from "../components/landing/Reveal";
import { HeroPreviewMockup, RankedTableMockup, WaterfallMockup, WatchlistMockup, WeightSlidersMockup } from "../components/landing/Mockups";
import { cn } from "../lib/utils";

const NAV_SECTIONS = [
  { id: "features", label: "Features" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

/** Highlights whichever section's midpoint is currently crossing a thin band near the top of the viewport. */
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 },
    );
    const elements = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  return active;
}

function ScrollSpyNav() {
  const active = useScrollSpy(NAV_SECTIONS.map((s) => s.id));
  return (
    <nav className="hidden items-center gap-1 rounded-full border border-border bg-surface-muted p-1 md:flex">
      {NAV_SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
            active === s.id ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold">Analects 2.17</span>
        </Link>
        <ScrollSpyNav />
        <nav className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
          <Link to="/login">
            <Button size="sm" className="rounded-full px-4">
              Get started
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

const HERO_BADGES = ["70+ metrics", "Live weight sliders", "Updated daily"];

function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-24 pt-20 text-center sm:px-6 sm:pb-32 sm:pt-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,color-mix(in_srgb,var(--color-accent)_12%,transparent),transparent)]" />
      <div className="mx-auto max-w-4xl">
        <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
          Every company.
          <br />
          <span className="text-accent">Ranked, scored,</span> and explained.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
          A multi-factor stock screener for value investing and fundamental analysis — scoring every mid and
          large-cap company on valuation, momentum, profitability, growth, and more — then showing you exactly why.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {HERO_BADGES.map((t) => (
            <span key={t} className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link to="/login">
            <Button size="lg" className="rounded-full px-7">
              Get started <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <span className="text-sm text-muted-foreground">7-day free trial · $2/month after · Cancel anytime</span>
        </div>
      </div>
      <Reveal delayMs={150}>
        <HeroPreviewMockup />
      </Reveal>
    </section>
  );
}

const FEATURE_CARDS = [
  {
    tag: "RANKINGS",
    title: "Every company, every metric.",
    body: "~70 metrics across valuation, momentum, profitability, growth, cash generation, financial strength, capital allocation, efficiency, earnings quality, and competitive moat — normalized cross-sectionally into one score per company.",
    visual: <RankedTableMockup />,
  },
  {
    tag: "CUSTOM MODELS",
    title: "Make the model yours.",
    body: "Disagree with the default weighting? Drag the sliders. Reweight entire categories or individual metrics, and the whole universe re-ranks live.",
    visual: <WeightSlidersMockup />,
  },
  {
    tag: "COMPANY DEEP-DIVE",
    title: "See exactly where the money goes.",
    body: "An income waterfall breaks revenue down to operating income to net income for every company, alongside a full history of every metric behind the score.",
    visual: <WaterfallMockup />,
  },
  {
    tag: "WATCHLIST",
    title: "Never lose track of what matters.",
    body: "Star the companies you're following and check back any time — scores and ranks update as new filings and prices come in.",
    visual: <WatchlistMockup />,
  },
];

function FeatureGrid() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Built for <span className="text-accent">value investing</span> and fundamental analysis.
        </h2>
        <p className="mt-4 text-balance text-base text-muted-foreground sm:text-lg">
          Every tool in this stock screener is built around one idea: show the number, then show exactly why.
        </p>
      </Reveal>
      <div className="mt-14 grid gap-5 sm:grid-cols-2">
        {FEATURE_CARDS.map((f, i) => (
          <Reveal key={f.tag} delayMs={i * 80} className="flex flex-col rounded-card border border-border bg-surface p-6 transition-shadow hover:shadow-md">
            <div className="flex justify-center rounded-md bg-surface-muted p-6">{f.visual}</div>
            <p className="mt-5 text-xs font-semibold tracking-wide text-accent">{f.tag}</p>
            <h3 className="mt-1.5 text-xl font-semibold tracking-tight">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-2xl scroll-mt-16 px-4 py-20 text-center sm:px-6 sm:py-28">
      <Reveal>
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Simple, transparent pricing</h2>
        <div className="mt-8 rounded-card border border-border bg-surface p-8 shadow-sm">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-5xl font-semibold tracking-tight">$2</span>
            <span className="text-muted-foreground">/month</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">First 7 days free. Cancel anytime.</p>
          <ul className="mx-auto mt-6 flex max-w-xs flex-col gap-2 text-left text-sm">
            {[
              "Every mid & large-cap company, ranked",
              "Full metric breakdown per company",
              "Live weight sliders & custom models",
              "CSV / JSON / XLSX export",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                <span className="text-foreground/80">{f}</span>
              </li>
            ))}
          </ul>
          <Link to="/login" className="mt-7 block">
            <Button size="lg" className="w-full rounded-full">
              Start your free trial
            </Button>
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

const FAQS = [
  {
    q: 'What counts as "mid and large-cap"?',
    a: "The ranked universe is data-driven: every SEC-registered company is screened, and anything above roughly a $2B market cap qualifies — no hand-picked index list.",
  },
  {
    q: "Where does the stock data come from?",
    a: "Live prices from Yahoo Finance and official financial statements from SEC EDGAR — refreshed daily.",
  },
  {
    q: "How is the stock ranking score calculated?",
    a: "Each fundamental metric is ranked cross-sectionally against every other company (percentile or z-score), combined across up to 5 fiscal years with heavier weight on recent years, then rolled up into category and overall scores using the weights you choose.",
  },
  {
    q: "Can I customize the stock screener's weighting for value investing?",
    a: "Yes — every category and individual metric has a live weight slider on the Rankings page. The whole universe re-ranks instantly, no waiting for a batch job.",
  },
  {
    q: "Is this investment advice?",
    a: "No. Analects 2.17 is a research and screening tool, not investment advice.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, from the billing portal — no phone calls, no retention flow.",
  },
];

function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28">
      <Reveal>
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Frequently asked questions</h2>
        <div className="mt-8 divide-y divide-border rounded-card border border-border">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                {f.q}
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero />
      <FeatureGrid />
      <PricingSection />
      <FaqSection />

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border px-4 py-6 text-sm sm:px-6">
        <Link to="/preview" className="text-muted-foreground hover:text-foreground">
          See today's top 20 (no signup)
        </Link>
        <Link to="/vs/finviz" className="text-muted-foreground hover:text-foreground">
          Analects 2.17 vs Finviz
        </Link>
        <Link to="/vs/stock-rover" className="text-muted-foreground hover:text-foreground">
          Analects 2.17 vs Stock Rover
        </Link>
      </div>

      <footer className="border-t border-border px-4 py-8 text-center text-xs text-muted-foreground sm:px-6">
        Analects 2.17 — "When you know a thing, to hold that you know it; and when you do not know a thing, to
        allow that you do not know it — this is knowledge." Data from Yahoo Finance and SEC EDGAR; not investment
        advice.
      </footer>
    </div>
  );
}
