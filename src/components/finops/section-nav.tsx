"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A sticky row of links to the page's sections. It sits just under the top bar (whose height it measures, since the
 * bar wraps on narrow screens) and highlights the section in view.
 */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [top, setTop] = useState(0);
  const nav = useRef<HTMLElement>(null);

  // Stick right under the top bar, whatever its height.
  useEffect(() => {
    const bar = document.querySelector("header");
    if (!bar) return;
    const measure = () => setTop(Math.round(bar.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // The section whose top is nearest above the line under the sticky bars is the one being read.
  useEffect(() => {
    const onScroll = () => {
      const line = top + (nav.current?.offsetHeight ?? 0) + 24;
      let current = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      // At the very bottom the last section is the one in view even if its top never reaches the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections[sections.length - 1]?.id ?? current;
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections, top]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = top + (nav.current?.offsetHeight ?? 0) + 12;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: reduce ? "auto" : "smooth" });
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav ref={nav} aria-label="FinOps sections" className="sticky z-[5] -mx-6 border-b border-border bg-bg/85 px-6 backdrop-blur" style={{ top }}>
      <ul className="flex gap-1 overflow-x-auto py-2">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                go(s.id);
              }}
              aria-current={active === s.id ? "true" : undefined}
              className={`block whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${active === s.id ? "bg-accent/15 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text"}`}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
