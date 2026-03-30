// src/components/GuildBadge.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

export type GuildLevelValue = "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";

// Crisp laurel wreath SVG — gold/amber, two curved branches sweeping up from bottom
function LaurelWreathIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Left branch stem */}
      <path d="M20 38 Q8 28 8 14" stroke="#BA7517" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      {/* Left leaves — 4 ellipses along the branch */}
      <ellipse cx="9" cy="32" rx="6" ry="3.2" fill="#EF9F27" stroke="#BA7517" strokeWidth="0.8" transform="rotate(-55 9 32)"/>
      <ellipse cx="7" cy="24" rx="6" ry="3.2" fill="#EF9F27" stroke="#BA7517" strokeWidth="0.8" transform="rotate(-40 7 24)"/>
      <ellipse cx="7" cy="16" rx="6" ry="3.2" fill="#EF9F27" stroke="#BA7517" strokeWidth="0.8" transform="rotate(-20 7 16)"/>
      <ellipse cx="10" cy="8" rx="6" ry="3.2" fill="#EF9F27" stroke="#BA7517" strokeWidth="0.8" transform="rotate(0 10 8)"/>
      {/* Right branch stem */}
      <path d="M20 38 Q32 28 32 14" stroke="#BA7517" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      {/* Right leaves — mirrored */}
      <ellipse cx="31" cy="32" rx="6" ry="3.2" fill="#EF9F27" stroke="#BA7517" strokeWidth="0.8" transform="rotate(55 31 32)"/>
      <ellipse cx="33" cy="24" rx="6" ry="3.2" fill="#EF9F27" stroke="#BA7517" strokeWidth="0.8" transform="rotate(40 33 24)"/>
      <ellipse cx="33" cy="16" rx="6" ry="3.2" fill="#EF9F27" stroke="#BA7517" strokeWidth="0.8" transform="rotate(20 33 16)"/>
      <ellipse cx="30" cy="8" rx="6" ry="3.2" fill="#EF9F27" stroke="#BA7517" strokeWidth="0.8" transform="rotate(0 30 8)"/>
      {/* Bottom ribbon tie */}
      <path d="M13 40 Q20 36 27 40" stroke="#BA7517" strokeWidth="2" strokeLinecap="round" fill="none"/>
      {/* Top center star dot */}
      <circle cx="20" cy="3" r="2.5" fill="#BA7517"/>
    </svg>
  );
}

// Hammer + chisel crossed SVG — indigo/purple, crisp at all sizes
function HammerChiselIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Chisel — diagonal from bottom-left to top-right */}
      <line x1="8" y1="34" x2="28" y2="8" stroke="#534AB7" strokeWidth="3.5" strokeLinecap="round"/>
      {/* Chisel tip (flat blade at top-right) */}
      <path d="M25 5 L31 9 L28 12 Z" fill="#534AB7"/>
      {/* Chisel handle end (bottom-left) */}
      <rect x="4" y="31" width="8" height="5" rx="2" fill="#534AB7" transform="rotate(-52 8 34)"/>
      {/* Hammer — diagonal from bottom-right to top-left */}
      <line x1="32" y1="34" x2="12" y2="8" stroke="#534AB7" strokeWidth="3.5" strokeLinecap="round"/>
      {/* Hammer head (top-left) */}
      <rect x="4" y="3" width="14" height="9" rx="2.5" fill="#534AB7" transform="rotate(-38 11 7)"/>
      {/* Center crossing circle — small white dot to show they cross cleanly */}
      <circle cx="20" cy="21" r="2.5" fill="#EEEDFE"/>
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
  const color = isMember ? "#BA7517" : "#534AB7";
  const border = isMember ? "#FAC775" : "#CECBF6";

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
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {isMember ? <LaurelWreathIcon size={20} /> : <HammerChiselIcon size={20} />}
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
  size = 18,
}: {
  level: GuildLevelValue;
  showLabel?: boolean;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null!);

  if (level === "NONE") return null;

  const isMember = level === "GUILD_MEMBER";
  const color = isMember ? "#BA7517" : "#534AB7";
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
        {isMember ? <LaurelWreathIcon size={size} /> : <HammerChiselIcon size={size} />}
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
