import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BellRing, Boxes, Check, ChevronDown, ClipboardCheck, Clock, Mail, Wallet } from 'lucide-react';
import './landing.css';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Stagger delay for the reveal and letter animations, set as a CSS custom property.
const delay = (ms: number) => ({ '--delay': `${ms}ms` }) as React.CSSProperties;

// Counts up from 0 once the number scrolls into view. Shows the final value straight away when reduced motion is on.
const Counter: React.FC<{ to: number; suffix?: string }> = ({ to, suffix = '' }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(() => (reducedMotion() ? to : 0));

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    let frame = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 2000);
          setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to]);

  return (
    <span ref={ref}>
      {value.toLocaleString('en-IN')}
      {suffix}
    </span>
  );
};

// Splits a line into per-letter spans so each letter fades in one after another, 50ms apart.
// Returns the letters and how many there are, so the next line can continue the count.
const Letters: React.FC<{ text: string; start: number }> = ({ text, start }) => {
  let index = start;
  return (
    <>
      {text.split(' ').map((word, w, words) => (
        <React.Fragment key={w}>
          <span className="lp-word" aria-hidden="true">
            {[...word].map((letter) => {
              const i = index;
              index += 1;
              return (
                <span key={i} className="lp-char" style={delay(i * 50)}>
                  {letter}
                </span>
              );
            })}
          </span>
          {w < words.length - 1 ? ' ' : null}
        </React.Fragment>
      ))}
    </>
  );
};

const HEADLINE_LINE_1 = 'Labs Run on Chaos.';
const HEADLINE_LINE_2 = 'We Fix It.';
const LINE_1_LETTERS = HEADLINE_LINE_1.replace(/ /g, '').length;

const problems = [
  { icon: Clock, title: 'Shortages mid-experiment', text: 'A reagent runs out the night before a run. Nobody noticed, because the count lives in a notebook.' },
  { icon: Mail, title: 'Orders lost in email', text: 'Purchase requests travel through inboxes, and no one can say which order actually went out.' },
  { icon: Wallet, title: 'Budgets checked too late', text: 'Overspending shows up after the invoice arrives, when the money is already gone.' },
];

const features = [
  { icon: Boxes, title: 'Live stock ledger', text: 'Every issue and receipt is recorded, so the count on the shelf always matches the system.' },
  { icon: BellRing, title: 'Reorder alerts', text: 'Suggestions based on usage and lead time, raised before an item reaches zero.' },
  { icon: Wallet, title: 'Budget guardrails', text: "Each order is checked against the lab's budget, with warnings at 75, 90 and 100 percent." },
  { icon: ClipboardCheck, title: 'Orders to receipt', text: 'Send a purchase order to the supplier, receive goods against it, and match the invoice.' },
];

const steps = [
  { title: 'Add products and suppliers', text: 'Import or enter your catalogue once. Each product keeps its unit, cost and preferred supplier.' },
  { title: 'Set reorder levels and budgets', text: 'Choose when a product needs topping up and how much each lab can spend this period.' },
  { title: 'Approve orders in one click', text: 'Requests become purchase orders. Approvers see the budget impact before they say yes.' },
  { title: 'Receive and match', text: 'Log what arrives, match the invoice, and the stock and spend update together.' },
];

// Product facts, not customer claims.
const stats = [
  { to: 4, label: 'Steps from request to receipt' },
  { to: 3, label: 'Budget warning levels' },
  { to: 2, label: 'Account roles: admin and staff' },
  { to: 100, suffix: '%', label: 'Stock changes written to the audit log' },
];

const sectionIds = ['problem', 'features', 'how-it-works'];

// Floating orbs in the hero background. Each one sits at its own position and size.
const orbs = [
  { top: '12%', left: '4%', size: 220, duration: 7 },
  { top: '60%', left: '38%', size: 140, duration: 9 },
  { top: '75%', left: '2%', size: 180, duration: 8 },
  { top: '8%', left: '55%', size: 100, duration: 6 },
];

export const LandingPage: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [floatOn, setFloatOn] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = reducedMotion();

    // Reveal each element once. Timeline steps get is-done from the scroll handler instead.
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }),
      { threshold: 0.15 },
    );
    root.querySelectorAll<HTMLElement>('.lp-reveal').forEach((el) => {
      if (reduce) el.classList.add('is-in');
      else io.observe(el);
    });

    // Scroll spy: the section crossing the middle of the screen is the active nav link.
    const spy = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }),
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sectionIds.forEach((id) => {
      const el = root.querySelector(`#${id}`);
      if (el) spy.observe(el);
    });

    const hero = root.querySelector<HTMLElement>('.lp-hero');
    const timeline = root.querySelector<HTMLElement>('.lp-timeline');
    const stepEls = Array.from(root.querySelectorAll<HTMLElement>('.lp-step'));
    const parallax = root.querySelector<HTMLElement>('.lp-parallax');
    const solution = root.querySelector<HTMLElement>('.lp-solution');
    const footer = root.querySelector<HTMLElement>('.lp-footer');

    const onScroll = () => {
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      root.style.setProperty('--progress', String(max > 0 ? Math.min(1, y / max) : 0));
      setScrolled(y > 40);
      setPastHero(y > window.innerHeight * 0.8);
      setFloatOn(y > 500 && !(footer && footer.getBoundingClientRect().top < window.innerHeight));

      if (timeline) {
        const rect = timeline.getBoundingClientRect();
        const fill = reduce ? 1 : Math.min(1, Math.max(0, (window.innerHeight * 0.6 - rect.top) / rect.height));
        timeline.style.setProperty('--fill', fill.toFixed(3));
        // Checkmarks appear as the line reaches each step: 20%, 40%, 60%, 80%.
        stepEls.forEach((el, i) => el.classList.toggle('is-done', reduce || fill >= 0.2 + i * 0.2));
      }
      if (!reduce && parallax && solution) {
        const shift = Math.max(-30, Math.min(30, solution.getBoundingClientRect().top * -0.15));
        parallax.style.setProperty('--py', `${shift.toFixed(1)}px`);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // Pointer effects: the hero glow follows the cursor, and feature cards tilt toward it (max 5 degrees).
    const onHeroMove = (e: MouseEvent) => {
      if (!hero || reduce) return;
      const x = (e.clientX / window.innerWidth - 0.5) * 30;
      const y = (e.clientY / window.innerHeight - 0.5) * 30;
      hero.style.setProperty('--mx', `${x.toFixed(1)}px`);
      hero.style.setProperty('--my', `${y.toFixed(1)}px`);
    };
    const cardHandlers = Array.from(root.querySelectorAll<HTMLElement>('.lp-tilt')).map((card) => {
      const move = (e: MouseEvent) => {
        if (reduce) return;
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty('--ry', `${(px * 10).toFixed(2)}deg`);
        card.style.setProperty('--rx', `${(-py * 10).toFixed(2)}deg`);
      };
      const leave = () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      };
      card.addEventListener('mousemove', move);
      card.addEventListener('mouseleave', leave);
      return { card, move, leave };
    });
    hero?.addEventListener('mousemove', onHeroMove);

    return () => {
      io.disconnect();
      spy.disconnect();
      window.removeEventListener('scroll', onScroll);
      hero?.removeEventListener('mousemove', onHeroMove);
      cardHandlers.forEach(({ card, move, leave }) => {
        card.removeEventListener('mousemove', move);
        card.removeEventListener('mouseleave', leave);
      });
    };
  }, []);

  const navLink = (id: string) => (activeId === id ? 'is-active' : '');

  return (
    <div ref={rootRef} className="lp" id="top">
      <div className="lp-progress" aria-hidden="true" />

      <nav className={`lp-nav ${scrolled ? 'is-solid' : ''}`} aria-label="Main">
        <a href="#top" className="lp-brand" aria-label="StockSense home">
          <span className="lp-brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            StockSense
            <small className="block">Labs</small>
          </span>
        </a>
        <div className="lp-navlinks">
          <a href="#problem" className={navLink('problem')} aria-current={activeId === 'problem' ? 'true' : undefined}>
            Problem
          </a>
          <a href="#features" className={navLink('features')} aria-current={activeId === 'features' ? 'true' : undefined}>
            Features
          </a>
          <a href="#how-it-works" className={navLink('how-it-works')} aria-current={activeId === 'how-it-works' ? 'true' : undefined}>
            How it works
          </a>
        </div>
        <Link to="/login" className="lp-btn lp-btn-primary" style={{ padding: '10px 18px' }}>
          Sign in
        </Link>
      </nav>

      <section className="lp-hero" aria-labelledby="lp-headline">
        <div className="lp-hero-wash" aria-hidden="true" />
        {orbs.map((orb, i) => (
          <span
            key={i}
            className="lp-orb"
            aria-hidden="true"
            style={{ top: orb.top, left: orb.left, width: orb.size, height: orb.size, animationDuration: `${orb.duration}s` }}
          />
        ))}
        <div className="lp-hero-glow" aria-hidden="true" />

        <div className="lp-hero-copy">
          <p className="lp-eyebrow">WELCOME TO STOCKSENSE</p>
          <h1 id="lp-headline" aria-label={`${HEADLINE_LINE_1} ${HEADLINE_LINE_2}`} style={{ marginTop: 12 }}>
            <span className="block">
              <Letters text={HEADLINE_LINE_1} start={0} />
            </span>
            <span className="block">
              <Letters text={HEADLINE_LINE_2} start={LINE_1_LETTERS} />
            </span>
          </h1>
          <p className="lp-lede" style={{ animationDelay: '1.3s' }}>
            StockSense tracks every reagent, warns you before stock runs out, and turns approved orders into received goods, with budgets checked at each step.
          </p>
          <div className="lp-hero-actions" style={{ animationDelay: '1.6s' }}>
            <Link to="/login" className="lp-btn lp-btn-primary">
              Sign in <ArrowRight size={18} />
            </Link>
            <a href="#how-it-works" className="lp-btn lp-btn-outline">
              See demo
            </a>
          </div>
        </div>

        <div className="lp-visual" aria-hidden="true">
          <div className="lp-visual-card lp-visual-main">
            <p className="text-sm font-semibold text-[#2d5016]">Stock movement, last six weeks</p>
            <div className="lp-bar-row">
              {[55, 70, 45, 85, 62, 95].map((h, i) => (
                <div key={i} className="lp-bar" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="lp-visual-card lp-visual-side">
            <p className="text-center text-sm font-semibold text-[#2d5016]">Budget used</p>
            <div className="lp-ring">
              <span>56%</span>
            </div>
          </div>
        </div>

        <a href="#problem" className={`lp-scroll-hint ${pastHero ? 'is-hidden' : ''}`} aria-label="Scroll to the next section">
          <ChevronDown size={28} />
        </a>
      </section>

      <section id="problem" className="lp-section lp-band">
        <div className="lp-section-head lp-reveal lp-up">
          <h2>The Lab Inventory Problem</h2>
          <p>Shortages, lost orders and surprise overspend usually come from the same gap: no shared record of what is in stock and what has been ordered.</p>
        </div>
        <div className="lp-problem-grid">
          {problems.map((p, i) => (
            <div key={p.title} className="lp-problem-cell lp-reveal lp-slide" style={delay(i * 150)}>
              <div className="lp-problem-card">
                <p.icon className="lp-problem-icon" size={48} strokeWidth={1.6} aria-hidden="true" />
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="lp-section lp-solution">
        <div className="lp-parallax" aria-hidden="true" />
        <div className="lp-section-head lp-reveal lp-up">
          <h2>One record for stock and spend</h2>
          <p>Everything the lab needs to keep shelves full without overspending, in four connected parts.</p>
        </div>
        <div className="lp-feature-grid">
          {features.map((f, i) => (
            <div key={f.title} className="lp-feature-cell lp-reveal lp-scale-up" style={delay(i * 100)}>
              <div className="lp-tilt">
                <span className="lp-icon-box" aria-hidden="true">
                  <f.icon size={32} strokeWidth={1.8} />
                </span>
                <ArrowRight className="lp-arrow" size={24} aria-hidden="true" />
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="lp-section lp-band">
        <div className="lp-section-head lp-reveal lp-up">
          <h2>How It Works</h2>
          <p>From first setup to a stocked shelf, in four steps.</p>
        </div>
        <div className="lp-timeline">
          <div className="lp-timeline-line" aria-hidden="true">
            <div className="lp-timeline-fill" />
          </div>
          {steps.map((s, i) => (
            <div key={s.title} className="lp-step lp-reveal lp-slide-right" style={delay(i * 150)}>
              <span className="lp-step-node" aria-hidden="true">
                <Check className="lp-check" size={24} strokeWidth={3} />
              </span>
              <div className="lp-step-card">
                <p className="lp-step-title">{s.title}</p>
                <p>{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section lp-impact">
        <div className="lp-section-head lp-reveal lp-up">
          <h2>Impact in Numbers</h2>
        </div>
        <div className="lp-stats">
          {stats.map((s, i) => (
            <div key={s.label} className="lp-glass lp-reveal lp-up" style={delay(i * 100)}>
              <p className="lp-stat-value">
                <Counter to={s.to} suffix={s.suffix} />
              </p>
              <p className="lp-stat-label">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section lp-cta">
        <div className="lp-cta-inner lp-reveal lp-up">
          <h2>Ready to stop running out?</h2>
          <p>Sign in to your lab, or ask your administrator for an invitation to join.</p>
          <div className="lp-cta-actions">
            <Link to="/login" className="lp-btn lp-btn-primary">
              Sign in <ArrowRight size={18} />
            </Link>
            <Link to="/signup" className="lp-btn lp-btn-outline">
              Create account
            </Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div>
          <p className="lp-brand lp-brand-light">StockSense</p>
          <small>Lab inventory and procurement</small>
        </div>
        <div>
          <Link to="/login">Sign in</Link>
          <Link to="/signup">Create account</Link>
          <a href="#top">Back to top</a>
        </div>
        <small>© 2026 StockSense</small>
      </footer>

      <aside className={`lp-float-cta ${floatOn ? 'is-in' : ''}`} aria-label="Quick sign in" aria-hidden={!floatOn}>
        <h3>Ready to fix your lab?</h3>
        <Link to="/login" className="lp-btn lp-btn-mid" tabIndex={floatOn ? 0 : -1}>
          Sign in
        </Link>
      </aside>
    </div>
  );
};
