/** Small, bounded cache for public Bangumi covers. Never forwards user credentials. */
export type CoverImage = { data: Buffer; contentType: string };
export type CoverImageLoader = (url: string) => Promise<CoverImage>;

type Options = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxImageBytes?: number;
  maxEntries?: number;
  maxCacheBytes?: number;
  maxConcurrent?: number;
};

const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const COVER_PATH = /^(?:\/r\/[1-9]\d{0,3})?\/pic\/cover\/[a-z]+\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-z0-9_.-]+\.(?:jpe?g|png|webp|gif|avif)$/i;
const DAY_MS = 86_400_000;

function failure(message: string, statusCode = 502): Error & { statusCode: number; expose: boolean } {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

function validateCoverUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\/lain\.bgm\.tv\//i.test(value)) {
    throw failure('不支持的封面地址', 400);
  }
  let url: URL;
  try { url = new URL(value); } catch { throw failure('不支持的封面地址', 400); }
  if (url.hostname !== 'lain.bgm.tv' || url.username || url.password || url.port || url.search || url.hash || !COVER_PATH.test(url.pathname)) {
    throw failure('不支持的封面地址', 400);
  }
  return url.href;
}

export function createCoverImageLoader({
  fetch: fetchImage = fetch,
  timeoutMs = 6000,
  maxImageBytes = 3 * 1024 * 1024,
  maxEntries = 128,
  maxCacheBytes = 32 * 1024 * 1024,
  maxConcurrent = 4
}: Options = {}): CoverImageLoader {
  const cache = new Map<string, { image: CoverImage; expiresAt: number }>();
  const inFlight = new Map<string, Promise<CoverImage>>();
  const waiting: Array<() => void> = [];
  let cacheBytes = 0;
  let active = 0;

  async function download(url: string): Promise<CoverImage> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(failure('封面加载超时，请稍后重试'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([readImage(url, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async function readImage(url: string, signal: AbortSignal): Promise<CoverImage> {
    const response = await fetchImage(url, {
      redirect: 'error', credentials: 'omit', signal,
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif', 'user-agent': 'bangumi-watch-planner/1.3.1' }
    });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const declaredSize = Number(response.headers.get('content-length'));
    if (!response.ok || !RASTER_TYPES.has(contentType) || declaredSize > maxImageBytes || !response.body) {
      await response.body?.cancel();
      throw failure('封面暂时加载失败，请稍后重试');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxImageBytes) {
          await reader.cancel();
          throw failure('封面文件过大');
        }
        chunks.push(value);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
    if (size === 0) throw failure('封面暂时加载失败，请稍后重试');
    return { data: Buffer.concat(chunks), contentType };
  }

  async function fetchWithSlot(url: string): Promise<CoverImage> {
    if (active >= maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      let image: CoverImage;
      try { image = await download(url); } catch { image = await download(url); }
      while (cache.size > 0 && (cache.size >= maxEntries || cacheBytes + image.data.byteLength > maxCacheBytes)) {
        const oldest = cache.keys().next().value!;
        cacheBytes -= cache.get(oldest)!.image.data.byteLength;
        cache.delete(oldest);
      }
      if (maxEntries > 0 && image.data.byteLength <= maxCacheBytes) {
        cache.set(url, { image, expiresAt: Date.now() + DAY_MS });
        cacheBytes += image.data.byteLength;
      }
      return image;
    } catch {
      throw failure('封面暂时加载失败，请稍后重试');
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }

  return async (value) => {
    const url = validateCoverUrl(value);
    const cached = cache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      cache.delete(url);
      cache.set(url, cached);
      return cached.image;
    }
    if (cached) {
      cacheBytes -= cached.image.data.byteLength;
      cache.delete(url);
    }
    const pending = inFlight.get(url);
    if (pending) return pending;
    if (inFlight.size >= 128) throw failure('封面加载繁忙，请稍后重试', 503);
    const loading = fetchWithSlot(url).finally(() => { inFlight.delete(url); });
    inFlight.set(url, loading);
    return loading;
  };
}
