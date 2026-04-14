// src/components/GuildBadge.tsx
"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

export type GuildLevelValue = "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";

// Full wreath path from public/gold-laurel-wreath.svg — single path, no subpath splitting
const WREATH_D = "m388.87 88.547c-7.7812 21.328-26.906 36.375-49.453 38.906-21.234 5.0625-38.625 20.344-46.359 40.781s-4.875 43.359 7.6875 61.266c1.5469 2.1562 4.4062 2.9062 6.7969 1.7812 53.859-26.344 86.109-82.969 81.328-142.74zm422.29 0h-0.046874c-4.7812 59.766 27.469 116.39 81.328 142.74 2.3906 1.1719 5.2969 0.42188 6.8438-1.7812 12.562-17.906 15.422-40.828 7.6875-61.266-7.7812-20.438-25.172-35.719-46.406-40.781-22.547-2.5312-41.672-17.578-49.453-38.906zm-595.08 113.91c0.65625 22.688-11.578 43.734-31.594 54.375-17.906 12.562-28.406 33.188-28.078 55.078 0.32813 21.844 11.484 42.141 29.766 54.141 2.25 1.4531 5.25 1.0312 7.0312-0.98438 40.312-44.344 49.406-108.84 22.875-162.56zm767.86 0c-26.531 53.766-17.484 118.27 22.828 162.61 1.7812 2.0156 4.7812 2.4375 7.0312 0.9375 18.281-11.953 29.438-32.25 29.812-54.094 0.32812-21.891-10.172-42.516-28.078-55.078-20.016-10.641-32.25-31.688-31.594-54.375zm-640.22 44.766c-8.625-0.09375-17.156 1.6406-25.031 5.0625-1.4062 0.60938-2.4844 1.7344-3 3.1875-0.46875 1.4062-0.375 2.9531 0.32812 4.3125 5.625 10.969 15.844 18.844 27.891 21.516 2.25 0.46875 4.5938 0.42188 6.7969-0.23438 14.438-4.3125 29.578-5.8594 44.625-4.5938-11.062-17.953-30.516-28.969-51.609-29.203zm514.18 0c-21.656-0.32812-41.906 10.781-53.25 29.203 15.047-1.2656 30.188 0.28125 44.625 4.5938 2.2031 0.60938 4.5469 0.70312 6.7969 0.1875 12.047-2.6719 22.266-10.547 27.891-21.516h0.046875c0.70312-1.3125 0.79688-2.9062 0.28125-4.3125s-1.5938-2.5312-3-3.1406c-7.3594-3.1875-15.328-4.9219-23.391-5.0156zm-562.22 6.8438c-86.719 76.969-141.1 183.98-152.11 299.44s22.172 230.76 92.812 322.74c70.641 91.969 173.48 153.79 287.86 172.92l1.8281-10.734c-111.66-18.703-212.11-79.031-281.06-168.79-68.953-89.812-101.34-202.4-90.562-315.1 10.734-112.73 63.797-217.18 148.5-292.31zm608.63 0-7.2188 8.1562h-0.046875c84.703 75.141 137.76 179.58 148.5 292.31 10.781 112.69-21.609 225.28-90.562 315.1-68.953 89.766-169.4 150.1-281.06 168.79l1.8281 10.734c114.38-19.125 217.22-80.906 287.86-172.92 70.641-91.969 103.83-207.28 92.812-322.74-11.016-115.45-65.391-222.42-152.11-299.44zm39.422 108.38c-12.703 0.32812-25.031 4.5938-35.25 12.188 14.484 4.3594 28.031 11.391 39.891 20.766 1.7812 1.4531 3.9375 2.3906 6.1875 2.7656 12.188 1.9688 24.609-1.5938 33.891-9.75 1.125-0.98438 1.8281-2.3906 1.875-3.8906s-0.51562-2.9531-1.5938-4.0312v-0.046875c-11.906-11.906-28.172-18.422-45-17.953zm-690.94 0.09375c-15.609 0.46875-30.422 6.8906-41.484 17.953-1.0781 1.0781-1.6406 2.5312-1.5938 4.0312s0.75 2.9062 1.875 3.8906c9.2344 8.1562 21.656 11.719 33.844 9.75 2.2969-0.375 4.4531-1.3125 6.2812-2.7656 11.812-9.375 25.312-16.406 39.797-20.766-11.156-8.2969-24.797-12.562-38.719-12.094zm-155.26 9.5625c9 20.812 5.3906 44.906-9.2812 62.203-12 18.281-14.156 41.297-5.7656 61.453 8.3906 20.203 26.203 34.922 47.625 39.281 2.625 0.5625 5.2969-0.84375 6.2344-3.375 21.094-56.109 5.7188-119.39-38.812-159.56zm1004.9 0h0.046874c-44.531 40.125-59.906 103.45-38.859 159.56 0.9375 2.4844 3.6094 3.9375 6.2344 3.375 21.422-4.4062 39.234-19.125 47.625-39.281 8.3906-20.156 6.2344-43.219-5.7656-61.453-14.625-17.297-18.234-41.391-9.2344-62.203zm-502.5 23.344c-4.2188 0-7.9688 2.7188-9.2344 6.75l-40.219 127.55h-133.69c-4.2656 0-8.0625 2.7188-9.3281 6.7969s0.23438 8.4844 3.7031 10.922l109.55 76.641-45.75 125.68c-1.4531 4.0312-0.14062 8.4844 3.2344 11.062s8.0625 2.6719 11.531 0.23438l110.3-77.203 110.2 77.203c3.4688 2.4375 8.1562 2.3438 11.531-0.23438s4.6875-7.0312 3.2344-11.062l-45.75-125.68 109.55-76.641c3.4688-2.4375 4.9688-6.8438 3.7031-10.922s-5.0625-6.7969-9.3281-6.7969h-133.69l-40.219-127.55c-1.3125-4.0312-5.0625-6.75-9.3281-6.75zm-385.78 106.73c-24.141 0.42188-45.797 14.953-55.359 37.125-0.60938 1.4062-0.60938 2.9531 0 4.3594 0.60938 1.3594 1.7812 2.4375 3.1875 2.9531 11.625 4.125 24.469 2.8125 35.062-3.5156 1.9688-1.1719 3.6094-2.8594 4.7812-4.8281 7.5469-13.078 17.531-24.609 29.391-34.031-5.5781-1.4531-11.297-2.1562-17.062-2.0625zm769.82 0c-5.1094 0.046875-10.219 0.75-15.141 2.0625 11.812 9.4219 21.75 20.953 29.297 34.031 1.1719 1.9688 2.8125 3.6562 4.7812 4.8281 10.594 6.3281 23.438 7.6406 35.062 3.5156 1.4062-0.51562 2.5781-1.5938 3.1875-2.9531 0.60938-1.4062 0.60938-2.9531 0-4.3594-9.7969-22.781-32.391-37.406-57.188-37.125zm-933.98 71.297c15.984 16.031 21.562 39.75 14.297 61.219-4.4062 21.422 2.1094 43.641 17.344 59.297 15.281 15.703 37.312 22.781 58.828 18.938 2.6719-0.46875 4.5469-2.8125 4.5-5.4844-1.125-59.953-38.812-113.06-94.969-133.97zm1100 0h-0.046874c-56.156 20.906-93.844 74.016-94.969 133.97-0.046876 2.6719 1.8281 5.0156 4.5 5.4844 21.516 3.8438 43.547-3.2344 58.828-18.938 15.234-15.656 21.75-37.875 17.344-59.297-7.2656-21.469-1.6875-45.188 14.297-61.219zm-927 73.547c-30.328 3.5156-53.438 28.734-54.328 59.25-0.046876 1.5 0.5625 2.9531 1.5938 4.0312 1.0781 1.0312 2.5312 1.5938 4.0312 1.5469 12.328-0.46875 23.812-6.375 31.312-16.172 1.4062-1.8281 2.2969-3.9844 2.625-6.2812 2.2031-14.953 7.2188-29.297 14.766-42.422zm753.94 0c7.5469 13.078 12.562 27.469 14.766 42.375 0.32812 2.2969 1.2188 4.4531 2.625 6.2812 7.5 9.7969 18.984 15.75 31.312 16.172 1.5 0.046875 2.9531-0.51562 4.0312-1.5469 1.0312-1.0781 1.6406-2.5312 1.5938-4.0312-0.89063-30.516-24-55.734-54.328-59.25zm-896.81 131.21c20.859 8.9531 34.781 28.922 36 51.609 3.7969 21.469 18.047 39.703 37.969 48.656 19.922 8.9062 43.031 7.4062 61.594-4.0781 2.2969-1.4062 3.2344-4.3125 2.2031-6.75-23.156-55.312-77.812-90.797-137.76-89.438zm1034.3 0c-57.984 0.79688-109.97 35.906-132.42 89.438-1.0312 2.4375-0.09375 5.3438 2.2031 6.75 18.562 11.484 41.672 13.031 61.641 4.0781 19.969-8.9062 34.172-27.141 38.016-48.703 1.1719-22.594 15.094-42.609 35.906-51.562-1.7812-0.046875-3.5625-0.046875-5.3438 0zm-846.37 4.4062c-26.859 14.438-39.094 46.453-28.594 75.141 0.51562 1.4062 1.5938 2.5312 2.9531 3.1406 1.4062 0.5625 2.9531 0.5625 4.3125-0.046875 11.297-4.9219 19.781-14.672 23.156-26.531 0.60938-2.25 0.70312-4.5938 0.14062-6.8438-3.4688-14.719-4.125-29.906-1.9688-44.859zm663.79 0c2.1562 14.906 1.5 30.141-1.9688 44.812-0.5625 2.2969-0.51563 4.6406 0.09375 6.8906 3.375 11.859 11.859 21.562 23.156 26.531 1.3594 0.60938 2.9062 0.60938 4.3125 0.046875 1.3594-0.60938 2.4375-1.7344 2.9531-3.1406 10.5-28.641-1.6875-60.656-28.547-75.141zm-571.78 109.45v-0.046875c-19.641 23.391-19.172 57.609 1.125 80.391 0.98438 1.1719 2.4375 1.8281 3.9375 1.875 1.5 0 2.9531-0.5625 4.0312-1.6875 8.625-8.7656 12.938-20.953 11.625-33.234-0.23438-2.2969-1.0312-4.5-2.3906-6.375-8.625-12.375-14.859-26.297-18.328-40.969zm479.81 0-0.046876-0.046875c-3.5156 14.672-9.75 28.594-18.375 40.922-1.3594 1.9219-2.1562 4.125-2.3906 6.4688-1.3125 12.234 3 24.422 11.625 33.234 1.0781 1.0781 2.5312 1.6875 4.0312 1.6406s2.9531-0.70312 3.9375-1.8281c20.297-22.781 20.812-57.047 1.1719-80.391zm-599.86 53.719c-19.312 0.046875-38.484 3.9375-56.297 11.484 22.688 0.65625 43.031 14.109 52.453 34.734 11.531 18.609 31.5 30.281 53.344 31.219s42.703-9.0469 55.734-26.578c1.5938-2.1562 1.4062-5.1562-0.46875-7.0781-27.562-28.172-65.344-43.969-104.77-43.781zm719.34 0c-39.234-0.046875-76.781 15.75-104.25 43.781-1.875 1.9219-2.1094 4.9219-0.51562 7.0781h0.046874c13.031 17.531 33.891 27.469 55.734 26.531s41.766-12.609 53.297-31.172c9.4688-20.578 29.766-34.031 52.453-34.688-17.953-7.5938-37.266-11.531-56.766-11.531zm-473.39 14.016-0.046875-0.046875c-9.6094 28.969 3.5156 60.609 30.75 74.297 1.3594 0.65625 2.9062 0.75 4.3125 0.23438 1.4531-0.5625 2.5781-1.6406 3.1406-3 4.7812-11.344 4.2656-24.281-1.4062-35.203-1.0781-2.0625-2.6719-3.7969-4.5938-5.0625-12.609-8.2969-23.531-18.891-32.203-31.266zm228 0-0.046875-0.046875c-8.6719 12.328-19.594 22.969-32.203 31.266-1.9219 1.2656-3.5156 3-4.5938 5.0625-5.6719 10.922-6.1875 23.859-1.4062 35.203 0.5625 1.3594 1.6875 2.4375 3.1406 3 1.4062 0.51562 2.9531 0.42188 4.3125-0.23438 27.234-13.688 40.359-45.328 30.75-74.297zm-115.45 30.891h-0.046875c-32.203 0.79688-57.844 27.141-57.797 59.297-0.046875 15.75 6.1875 30.844 17.344 42 11.109 11.156 26.203 17.391 41.953 17.391 15.703 0 30.797-6.2344 41.953-17.391 11.109-11.156 17.344-26.25 17.297-42 0-15.984-6.4219-31.312-17.859-42.469s-26.906-17.25-42.891-16.828zm-152.53 52.828h-0.046875c-37.406 0.65625-73.125 15.703-99.797 41.953 21.328-7.7344 45.188-2.7188 61.594 12.938 17.531 13.031 40.406 16.547 61.031 9.3281 20.672-7.2188 36.375-24.188 42-45.281 0.70312-2.5781-0.5625-5.2969-3-6.375-19.453-8.6719-40.547-12.938-61.828-12.562zm302.29 0h-0.046876c-19.359 0.42188-38.438 4.6875-56.156 12.562-2.4375 1.0781-3.7031 3.7969-3 6.375 5.625 21.141 21.328 38.062 42 45.281 20.625 7.2188 43.5 3.7031 61.031-9.3281 16.406-15.656 40.266-20.672 61.547-12.938-28.031-27.656-66.047-42.797-105.42-41.953z";

const BADGE_VIEWBOX = "0 0 1200 1200";

// 5-pointed star polygon centered at (600,600) for Guild Master overlay
const STAR_POINTS = "600,405 621,466 686,468 634,507 653,568 600,531 547,568 566,507 514,468 579,466";

// Laurel wreath only — Guild Member badge
function LaurelWreathIcon({ size = 24 }: { size?: number }) {
  const id = useId();
  const gradientId = `gold-${id}`;
  return (
    <svg width={size} height={size} viewBox={BADGE_VIEWBOX} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86EFAC"/>
          <stop offset="50%" stopColor="#D4A04A"/>
          <stop offset="100%" stopColor="#166534"/>
        </linearGradient>
      </defs>
      <path d={WREATH_D} fill={`url(#${gradientId})`} fillOpacity={1} />
    </svg>
  );
}

// Laurel wreath + diamond star — Guild Master badge
function StarWreathIcon({ size = 24 }: { size?: number }) {
  const id = useId();
  const goldGradientId = `gold-${id}`;
  const diamondGradientId = `diamond-${id}`;
  return (
    <svg width={size} height={size} viewBox={BADGE_VIEWBOX} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={goldGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD700"/>
          <stop offset="40%" stopColor="#D4AF37"/>
          <stop offset="100%" stopColor="#B8960C"/>
        </linearGradient>
        <linearGradient id={diamondGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F0F9FF"/>
          <stop offset="50%" stopColor="#E0F2FE"/>
          <stop offset="100%" stopColor="#BAE6FD"/>
        </linearGradient>
      </defs>
      <path d={WREATH_D} fill={`url(#${goldGradientId})`} fillOpacity={1} />
      <polygon points={STAR_POINTS} fill={`url(#${diamondGradientId})`} fillOpacity={1} />
    </svg>
  );
}

// Portal-based popup — renders at document.body to avoid overflow:hidden clipping
function GuildPopup({
  level,
  anchorRef,
  onClose,
}: {
  level: "GUILD_MEMBER" | "GUILD_MASTER";
  anchorRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const left = Math.min(
        Math.max(rect.left + scrollX - 100, 8),
        window.innerWidth - 280
      );
      setPosition({ top: rect.bottom + scrollY + 8, left });
      setIsPositioned(true);
    }
  }, [anchorRef]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, anchorRef]);

  const isMember = level === "GUILD_MEMBER";
  const color = isMember ? "#15803d" : "#B8960C";
  const border = isMember ? "#FAC775" : "#FAC775";

  return createPortal(
    <div
      ref={popupRef}
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        zIndex: 9999,
        width: 260,
        background: "white",
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: 14,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        opacity: isPositioned ? 1 : 0,
        transition: "opacity 0.1s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {isMember ? <LaurelWreathIcon size={48} /> : <StarWreathIcon size={48} />}
        <span style={{ fontWeight: 500, color, fontSize: 14 }}>
          {isMember ? "Guild Member" : "Guild Master"}
        </span>
      </div>
      <p style={{ fontSize: 12, color: "#555", lineHeight: 1.5, margin: "0 0 10px" }}>
        {isMember
          ? "This maker has completed their profile, met our listing requirements, and been reviewed by Grainline staff. This badge confirms profile standing only and does not guarantee product quality or authenticity."
          : "This maker has met Grainline\u2019s highest performance standards including 4.5+ star ratings, consistent on-time shipping, and responsive communication. This badge reflects historical performance and does not guarantee future results."}
      </p>
      <Link
        href="/terms#guild-verification-program"
        style={{ fontSize: 11, color, textDecoration: "underline" }}
        onClick={onClose}
      >
        Learn more about Guild Verification →
      </Link>
    </div>,
    document.body
  );
}

export default function GuildBadge({
  level,
  showLabel = false,
  size = 32,
}: {
  level: GuildLevelValue;
  showLabel?: boolean;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null!);

  if (level === "NONE") return null;

  const isMember = level === "GUILD_MEMBER";
  const color = isMember ? "#15803d" : "#B8960C";
  const label = isMember ? "Guild Member" : "Guild Master";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color,
          lineHeight: 1,
        }}
      >
        {isMember ? <LaurelWreathIcon size={size} /> : <StarWreathIcon size={size} />}
        {showLabel && (
          <span style={{ fontSize: 12, fontWeight: 500, color }}>{label}</span>
        )}
      </button>
      {open && (
        <GuildPopup
          level={level}
          anchorRef={btnRef}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
