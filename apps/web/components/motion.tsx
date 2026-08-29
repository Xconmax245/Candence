"use client";

/**
 * Cadence motion primitives — a lightweight, dependency-free AOS-style layer.
 *
 * Why not the `aos` npm package? It's an unmaintained, non-tree-shaken global
 * that fights RSC hydration and ships its own CSS we'd have to override to stay
 * pixel-accurate to §11. An IntersectionObserver in ~30 lines gives us the same
 * scroll-reveal with zero deps and full control — and, critically, it fully
 * respects `prefers-reduced-motion` (§11.8): reduced-motion users get content
 * revealed instantly with no transform.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type RevealVariant = "up" | "left" | "right" | "scale";

/**
 * Scroll-reveal wrapper. Adds `.reveal` (+ optional direction) then toggles
 * `.in` when the element scrolls into view. `delay` staggers siblings.
 */
export function Reveal({
  children,
  variant = "up",
  delay = 0,
  as: Tag = "div",
  className,
  style,
  once = true,
}: {
  children: ReactNode;
  variant?: RevealVariant;
  delay?: number;
  as?: "div" | "section" | "li" | "span";
  className?: string;
  style?: CSSProperties;
  once?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced motion: reveal immediately, skip the observer entirely.
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            if (once) obs.unobserve(e.target);
          } else if (!once) {
            setShown(false);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [once]);

  const variantClass =
    variant === "left"
      ? " reveal-left"
      : variant === "right"
        ? " reveal-right"
        : variant === "scale"
          ? " reveal-scale"
          : "";

  const cls =
    `reveal${variantClass}${shown ? " in" : ""}` + (className ? ` ${className}` : "");

  return (
    <Tag
      // @ts-expect-error — ref typing across the union of tags is safe here.
      ref={ref}
      className={cls}
      style={{ ["--reveal-delay" as string]: `${delay}ms`, ...style }}
    >
      {children}
    </Tag>
  );
}

/**
 * Count-up number. Animates from 0 → `value` once when scrolled into view.
 * Reduced motion (or non-finite values) render the final value instantly.
 *
 * All formatting is expressed via *serializable* props (`decimals`,
 * `separator`, `prefix`, `suffix`) rather than a `format` callback — a function
 * prop cannot cross the Server→Client Component boundary in the App Router, and
 * these stats are rendered from async server components.
 */
export function CountUp({
  value,
  durationMs = 1100,
  decimals = 0,
  separator = false,
  prefix = "",
  suffix = "",
  className,
  style,
}: {
  value: number;
  durationMs?: number;
  decimals?: number;
  /** Insert locale thousands separators (e.g. 12,480). */
  separator?: boolean;
  prefix?: string;
  suffix?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!Number.isFinite(value)) {
      setDisplay(value);
      return;
    }
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const tick = (now: number) => {
              const t = Math.min(1, (now - start) / durationMs);
              // easeOutCubic
              const eased = 1 - Math.pow(1 - t, 3);
              setDisplay(value * eased);
              if (t < 1) requestAnimationFrame(tick);
              else setDisplay(value);
            };
            requestAnimationFrame(tick);
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [value, durationMs]);

  const rounded = Number(display.toFixed(decimals));
  const body = separator
    ? rounded.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : display.toFixed(decimals);

  return (
    <span ref={ref} className={className} style={style}>
      {prefix}
      {body}
      {suffix}
    </span>
  );
}


/** A pulsing live indicator dot. Colour is inherited via `currentColor`. */
export function LiveDot({ style }: { style?: CSSProperties }) {
  return <span className="live-dot" style={style} aria-hidden />;
}
