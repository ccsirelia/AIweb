import Image from "next/image";

export function SiteBackdrop() {
  return (
    <div className="site-backdrop" aria-hidden="true">
      <Image
        src="/images/portrait-theme.png"
        alt=""
        fill
        priority
        quality={88}
        sizes="100vw"
        className="site-backdrop-image"
      />
      <div className="site-backdrop-veil" />
    </div>
  );
}
