import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BellRing, Boxes, Check, ChevronDown, ClipboardCheck, Clock, Mail, Wallet } from 'lucide-react';
import './landing.css';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Stagger delay for the reveal animation, set as a CSS custom property.
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
          const t = Math.min(1, (now - start) / 1600);
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

export const LandingPage: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = reducedMotion();

    // Reveal each element once. Timeline steps also get is-done, which fills their check mark.
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          el.classList.add('is-in');
          if (el.classList.contains('lp-step')) el.classList.add('is-done');
          io.unobserve(el);
        }),
      { threshold: 0.15 },
    );
    root.querySelectorAll<HTMLElement>('.lp-reveal').forEach((el) => {
      if (reduce) {
        el.classList.add('is-in');
        if (el.classList.contains('lp-step')) el.classList.add('is-done');
      } else {
        io.observe(el);
      }
    });

    const hero = root.querySelector<HTMLElement>('.lp-hero');
    const timeline = root.querySelector<HTMLElement>('.lp-timeline');
    const parallax = root.querySelector<HTMLElement>('.lp-parallax');
    const solution = root.querySelector<HTMLElement>('.lp-solution');

    const onScroll = () => {
      setScrolled(window.scrollY > 40);
      setPastHero(window.scrollY > window.innerHeight * 0.8);
      if (reduce) return;
      if (timeline) {
        const rect = timeline.getBoundingClientRect();
        const fill = Math.min(1, Math.max(0, (window.innerHeight * 0.6 - rect.top) / rect.height));
        timeline.style.setProperty('--fill', fill.toFixed(3));
      }
      if (parallax && solution) {
        parallax.style.setProperty('--py', `${(solution.getBoundingClientRect().top * -0.2).toFixed(1)}px`);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // Pointer effects: the hero glow follows the cursor, and feature cards tilt toward it.
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
        card.style.setProperty('--ry', `${(px * 8).toFixed(2)}deg`);
        card.style.setProperty('--rx', `${(-py * 8).toFixed(2)}deg`);
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
      window.removeEventListener('scroll', onScroll);
      hero?.removeEventListener('mousemove', onHeroMove);
      cardHandlers.forEach(({ card, move, leave }) => {
        card.removeEventListener('mousemove', move);
        card.removeEventListener('mouseleave', leave);
      });
    };
  }, []);

  return (
    <div ref={rootRef} className="lp" id="top">
      <nav className={`lp-nav ${scrolled ? 'is-solid' : ''}`} aria-label="Main">
        <a href="#top" className="lp-brand" aria-label="StockSense home">
          <span className="lp-brand-mark" aria-hidden="true">
            <span />
          </span>
          StockSense
        </a>
        <div className="lp-navlinks">
          <a href="#problem">Problem</a>
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
        </div>
        <Link to="/login" className={`lp-btn lp-btn-primary lp-nav-cta ${pastHero ? 'is-in' : ''}`}>
          Sign in
        </Link>
      </nav>

      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="lp-hero-copy">
          <p className="lp-eyebrow lp-reveal lp-up" style={delay(0)}>
            WELCOME TO STOCKSENSE
          </p>
          <h1 className="lp-reveal lp-up" style={delay(120)}>
            Labs Run on Chaos. <br />
            We Fix It.
          </h1>
          <p className="lp-lede lp-reveal lp-up" style={delay(240)}>
            StockSense tracks every reagent, warns you before stock runs out, and turns approved orders into received goods, with budgets checked at each step.
          </p>
          <div className="lp-hero-actions lp-reveal lp-up" style={delay(360)}>
            <Link to="/login" className="lp-btn lp-btn-primary">
              Sign in <ArrowRight size={18} />
            </Link>
            <a href="#how-it-works" className="lp-btn lp-btn-outline">
              See demo
            </a>
          </div>
        </div>

        <div className="lp-visual lp-reveal lp-scale" style={delay(300)} aria-hidden="true">
          <div className="lp-visual-card lp-visual-main">
            <p className="text-sm font-bold text-[#2d5016]">Stock movement, last six weeks</p>
            <div className="lp-bar-row">
              {[55, 70, 45, 85, 62, 95].map((h, i) => (
                <div key={i} className="lp-bar" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="lp-visual-card lp-visual-side">
            <p className="text-center text-sm font-bold text-[#2d5016]">Budget used</p>
            <div className="lp-ring">
              <span>56%</span>
            </div>
          </div>
        </div>

        <a href="#problem" className="lp-scroll-hint" aria-label="Scroll to the next section">
          <ChevronDown size={28} />
        </a>
      </section>

      <section id="problem" className="lp-section lp-band">
        <div className="lp-section-head lp-reveal lp-up">
          <h2>Lab stock fails quietly</h2>
          <p>Shortages, lost orders and surprise overspend usually come from the same gap: no shared record of what is in stock and what has been ordered.</p>
        </div>
        <div className="lp-problem-grid">
          {problems.map((p, i) => (
            <div key={p.title} className="lp-problem-card lp-reveal lp-up" style={delay(i * 120)}>
              <p.icon size={36} strokeWidth={1.6} color="#4a7c3e" />
              <h3>{p.title}</h3>
              <p>{p.text}</p>
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
                <f.icon className="lp-icon" aria-hidden="true" />
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="lp-section lp-band">
        <div className="lp-section-head lp-reveal lp-up">
          <h2>How it works</h2>
          <p>From first setup to a stocked shelf, in four steps.</p>
        </div>
        <div className="lp-timeline">
          <div className="lp-timeline-line" aria-hidden="true">
            <div className="lp-timeline-fill" />
          </div>
          {steps.map((s, i) => (
            <div key={s.title} className="lp-step lp-reveal lp-up" style={delay(i * 80)}>
              <span className="lp-step-node" aria-hidden="true">
                <span className="font-extrabold">{i + 1}</span>
              </span>
              <div>
                <p className="lp-step-title">{s.title}</p>
                <p className="mt-1 text-[0.95rem]">{s.text}</p>
              </div>
              <Check className="lp-check" size={24} aria-hidden="true" />
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section lp-impact">
        <div className="lp-section-head lp-reveal lp-up">
          <h2>Built around how labs work</h2>
        </div>
        <div className="lp-stats">
          {stats.map((s) => (
            <div key={s.label} className="lp-reveal lp-up">
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
          <p className="max-w-md">Sign in to your lab, or ask your administrator for an invitation to join.</p>
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

      <Link to="/login" className={`lp-btn lp-btn-primary lp-float-cta ${pastHero ? 'is-in' : ''}`} tabIndex={pastHero ? 0 : -1} aria-hidden={!pastHero}>
        Sign in
      </Link>
    </div>
  );
};
