'use client';

import Link from 'next/link';
import Image from 'next/image';

type Props = {
  /** Wrapper (e.g. motion div) can pass layout classes */
  className?: string;
  /** Extra classes on the image (height controls header size) */
  imgClassName?: string;
};

export default function SiteLogo({ className = '', imgClassName = '' }: Props) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center shrink-0 min-w-0 max-w-[min(52vw,17.5rem)] sm:max-w-[min(42vw,20rem)] md:max-w-[min(20rem,38vw)] lg:max-w-[min(24rem,42vw)] bg-transparent ${className}`}
      aria-label="Cedar Hack — home"
    >
      <Image
        src="/images/cedarhack-logo.png"
        alt="cedarHack.com"
        width={350}
        height={80}
        className={`h-10 w-auto sm:h-[2.8125rem] md:h-[3.125rem] object-contain object-left bg-transparent ${imgClassName}`}
        priority
      />
    </Link>
  );
}
