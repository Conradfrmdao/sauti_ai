import Image from "next/image";
import Link from "next/link";

export function Brand({
  href = "/",
  compact = false,
  className = "",
}: {
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      aria-label="SAUTI1 home"
      className={`sauti-brand ${compact ? "is-compact" : ""} ${className}`.trim()}
      href={href}
      prefetch={false}
    >
      <Image alt="" className="sauti-brand-mark" height={34} priority src="/brand/sauti1-mark.png" width={34} />
      <span className="sauti-brand-word">SAUTI<span>1</span></span>
      <small>Civic intelligence</small>
    </Link>
  );
}
