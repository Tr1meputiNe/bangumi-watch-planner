import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';

type Props = {
  src?: string | null;
  alt?: string;
  fallback?: ReactNode;
  fallbackClassName?: string;
};

export default function CoverImage(props: Props) {
  return <ImageRequest key={props.src ?? ''} {...props} />;
}

function ImageRequest({ src, alt = '', fallback, fallbackClassName = '' }: Props) {
  const sources = coverSources(src);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const currentSource = sources[attempt];

  useEffect(() => {
    const element = image.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [currentSource]);

  useEffect(() => {
    if (!currentSource || !visible || loaded) return;
    const timer = window.setTimeout(() => setAttempt(attempt + 1), attempt === 0 ? 15_000 : 10_000);
    return () => window.clearTimeout(timer);
  }, [attempt, currentSource, loaded, visible]);

  useEffect(() => {
    const retry = () => {
      if (!loaded) setAttempt(0);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [loaded]);

  if (!currentSource) {
    return <span className={`cover-image-fallback ${fallbackClassName}`} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
      {fallback ?? <ImageOff size={22} aria-hidden="true" />}
    </span>;
  }

  return <img
    key={currentSource}
    ref={image}
    src={currentSource}
    alt={alt}
    loading="lazy"
    decoding="async"
    referrerPolicy="no-referrer"
    onLoad={() => setLoaded(true)}
    onError={() => { setLoaded(false); setAttempt(attempt + 1); }}
  />;
}

function coverSources(src: string | null | undefined): string[] {
  if (!src) return [];
  try {
    const url = new URL(src);
    if (url.protocol === 'https:' && url.hostname === 'lain.bgm.tv' && !url.port && !url.username && !url.password
      && /^\/(?:r\/\d+\/)?pic\/cover\//.test(url.pathname)) {
      const original = new URL(url);
      original.pathname = original.pathname.replace(/^\/r\/\d+\//, '/');
      return [`/api/images/cover?url=${encodeURIComponent(src)}`, original.href];
    }
  } catch { /* Missing or legacy image addresses use the normal fallback. */ }
  return [src];
}
