import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createCoverImageLoader } from '../../src/server/cover-images.js';

const cover = 'https://lain.bgm.tv/r/400/pic/cover/l/63/4e/357961_RtPiz.jpg';
const jpeg = () => new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } });

describe('cover images', () => {
  it('deduplicates concurrent loads and reuses successful cached data', async () => {
    const fetcher = vi.fn(async () => jpeg());
    const load = createCoverImageLoader({ fetch: fetcher });
    const [a, b] = await Promise.all([load(cover), load(cover)]);
    expect(a).toEqual(b);
    expect(await load(cover)).toEqual(a);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(cover, expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
  });

  it.each([
    'https://example.com/pic/cover/l/63/4e/file.jpg',
    'http://lain.bgm.tv/pic/cover/l/63/4e/file.jpg',
    'https://lain.bgm.tv:8443/pic/cover/l/63/4e/file.jpg',
    'https://user@lain.bgm.tv/pic/cover/l/63/4e/file.jpg',
    'https://lain.bgm.tv/api/anything',
    `${cover}?redirect=http://127.0.0.1/`,
    `${cover}#fragment`
  ])('rejects unsupported URLs without a request: %s', async (url) => {
    const fetcher = vi.fn();
    await expect(createCoverImageLoader({ fetch: fetcher })(url)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retries a transient upstream failure and does not cache failures', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(jpeg());
    const load = createCoverImageLoader({ fetch: fetcher });
    await expect(load(cover)).rejects.toMatchObject({ statusCode: 502 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await load(cover)).contentType).toBe('image/jpeg');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('recovers from a single failed request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(jpeg());
    expect((await createCoverImageLoader({ fetch: fetcher })(cover)).data.byteLength).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out even when a request never settles', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const load = createCoverImageLoader({ fetch: fetcher, timeoutMs: 5 });
    await expect(load(cover)).rejects.toMatchObject({ statusCode: 502 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cancels a stalled response body instead of keeping a loading slot forever', async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'image/jpeg' }
    }));
    await expect(createCoverImageLoader({ fetch: fetcher, timeoutMs: 5 })(cover)).rejects.toMatchObject({ statusCode: 502 });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('limits concurrent upstream requests and releases waiting loads', async () => {
    const release: Array<() => void> = [];
    const fetcher = vi.fn(async () => {
      await new Promise<void>((resolve) => release.push(resolve));
      return jpeg();
    });
    const load = createCoverImageLoader({ fetch: fetcher, maxConcurrent: 2 });
    const loading = [1, 2, 3].map((id) => load(cover.replace('357961_RtPiz', `${id}_cover`)));
    expect(fetcher).toHaveBeenCalledTimes(2);
    release.shift()!();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    release.splice(0).forEach((resolve) => resolve());
    await Promise.all(loading);
  });

  it('does not retain images larger than its total cache allowance', async () => {
    const fetcher = vi.fn(async () => jpeg());
    const load = createCoverImageLoader({ fetch: fetcher, maxCacheBytes: 3 });
    await load(cover);
    await load(cover);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects non-raster content and oversized streams', async () => {
    const svg = vi.fn(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
    await expect(createCoverImageLoader({ fetch: svg })(cover)).rejects.toMatchObject({ statusCode: 502 });
    const large = vi.fn(async () => new Response(new Uint8Array(9), { headers: { 'content-type': 'image/jpeg' } }));
    await expect(createCoverImageLoader({ fetch: large, maxImageBytes: 8 })(cover)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('evicts older entries when its bounded cache fills', async () => {
    const fetcher = vi.fn(async () => jpeg());
    const load = createCoverImageLoader({ fetch: fetcher, maxEntries: 1 });
    await load(cover);
    await load(cover.replace('357961_RtPiz', '49278_mo7EP'));
    await load(cover);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('serves image bytes and cache headers, but never caches failures', async () => {
    const coverImages = vi.fn().mockResolvedValueOnce({ data: Buffer.from([1, 2, 3]), contentType: 'image/jpeg' }).mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { statusCode: 502 }));
    const app = buildApp({ auth: {} as never, dashboard: {} as never, staticRoot: null, coverImages });
    const first = await app.inject(`/api/images/cover?url=${encodeURIComponent(cover)}`);
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('image/jpeg');
    expect(first.headers['cache-control']).toBe('public, max-age=86400');
    expect(first.headers['x-content-type-options']).toBe('nosniff');
    expect(first.rawPayload).toEqual(Buffer.from([1, 2, 3]));
    const failure = await app.inject(`/api/images/cover?url=${encodeURIComponent(cover)}`);
    expect(failure.statusCode).toBe(502);
    expect(failure.headers['cache-control']).toBe('no-store');
    await app.close();
  });
});
