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
      className={`inline-flex items-center shrink-0 min-w-0 max-w-[min(55vw,14rem)] sm:max-w-[min(45vw,16rem)] md:max-w-none ${className}`}
      aria-label="Cedar Hack — home"
    >
      <Image
        src="/images/cedarhack-logo.png"
        alt="cedarHack.com"
        width={280}
        height={64}
        className={`h-8 w-auto sm:h-9 md:h-10 object-contain object-left ${imgClassName}`}
        priority
      />
    </Link>
  );
}
