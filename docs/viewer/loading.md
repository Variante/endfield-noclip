# loading a package

## sources

a package is read through a `PackageSource`
([`package/package-source.ts`](../../packages/viewer/src/package/package-source.ts)), which offers
whole-file reads and byte-range reads:

| source            | used for                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `httpSource`      | the dev/preview server, or any static host; one HTTP range request per read, tolerating servers that ignore `Range` |
| `directorySource` | a folder picked with the File System Access API (`showDirectoryPicker`), or a package copied into OPFS              |
| `fileListSource`  | a `<input webkitdirectory>` fallback where `showDirectoryPicker` is missing                                         |

every range read passes the archive's size from the manifest. a source whose file has another size
throws `PackageChangedError`; the stream manager then stops fetching shards (resident content stays
drawn) and the stats panel offers a reload, instead of decoding wrong bytes into dozens of failed
blobs.

the package panel ([`ui/package-panel.tsx`](../../packages/viewer/src/ui/package-panel.tsx)) offers
all three. where both `showDirectoryPicker` and OPFS exist, "copy into browser storage" imports the
picked folder into OPFS (skipping `debug/`, which the viewer never reads) so it can be reopened
without picking it again.

## dev package server

[`vite-plugins/package-server.ts`](../../packages/viewer/vite-plugins/package-server.ts) serves
extracted packages under `/packages/` on both `vite dev` and `vite preview`. the root defaults to
the repo's `out/`; set `NOCLIP_PACKAGES=/path` to point it elsewhere
([`vite.config.ts`](../../packages/viewer/vite.config.ts)).

- files are served as a static host would, by `sirv`: `Range` support, `ETag` and `Last-Modified`
  validators, `cache-control: no-cache`, nothing package-specific. keep it that way, so the dev
  setup behaves like a deployment. a deployment's host needs range requests and revalidation too,
  because archives keep their names across re-packs; the packer never rewrites a file in place (it
  swaps in a new package), so ordinary validators suffice.
- `GET /packages/index.json` lists subdirectories that hold a core archive, with its size, skipping
  hidden directories (the packer's staging and replaced packages). it's the one dev-only addition.

## opening

`Viewer.load` → `openViewerPackage`
([`package/viewer-package.ts`](../../packages/viewer/src/package/viewer-package.ts)) reads the whole
core archive, checks the manifest's format and version (a mismatch throws `PackageError` rather than
guessing at fields), and decodes its tables (tree, blob table, LOD chains, geometry, material,
texture, water, light, particle and irradiance tables). shard JSON headers are never fetched: the
blob table gives each shard blob's absolute byte range, so a blob costs one range read.

`load` then rejects terrain surface pages of a size or border the terrain renderer wasn't built for,
builds the linked tile tree, the texture store, the irradiance volume and the stream manager, pins
the coarse layer (see [residency](streaming.md#residency-and-budgets)), picks the initial level, and
poses the camera. the `MeshSelector` exists only when at least one geometry converted; without it
instances draw as boxes.

## decode workers and zstd

[`package/decode-pool.ts`](../../packages/viewer/src/package/decode-pool.ts) runs 2–4 module workers
(half the hardware threads, clamped) and hands each job to the least busy one, transferring the
blob's buffer. [`package/decode-worker.ts`](../../packages/viewer/src/package/decode-worker.ts)
undoes the blob codec and builds GPU-ready arrays:

| kind                       | worker output                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| heights                    | raw `u16` samples, padded to whole words for the storage buffer                                                                                            |
| instances                  | instance rows, per-row cull data and (chain, first, count) runs, built by `buildInstanceRows`                                                              |
| geometry                   | meshopt-decoded vertex streams (quantized positions, `snorm16x2` octahedral normals, UV0, UV1, tangents, `unorm8x4` colours) and indices padded to 4 bytes |
| surface                    | the albedo and normal BC3 images, each in its own buffer                                                                                                   |
| splat                      | the control, tint and index arrays                                                                                                                         |
| texture, layer, irradiance | the decompressed bytes as stored                                                                                                                           |

a 16-bit UV set stays `unorm16x2`, dequantized in the vertex shader, unless the mesh's other set is
stored as floats; then both are `float32x2`. a mesh without UV1 draws UV0 in its place.

zstd uses `zstddec`'s wasm build ([`package/zstd.ts`](../../packages/viewer/src/package/zstd.ts)),
which is an order of magnitude faster than a JS decoder on texture blobs. each realm instantiates
its own module, so workers and the main thread (core tables) each await `zstdReady`. `zstddec`
reports no errors, so `decompressZstd` checks the decoded length and throws on a short frame.

## URL parameters

| parameter | meaning                                                                                                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package` | a dev package name (served from `/packages/<name>/`), or a URL/path of a package directory if it starts with `/`, `./`, `../`, `http:/` or `https:/` ([`ui/package-param.ts`](../../packages/viewer/src/ui/package-param.ts)) |
| `level`   | the level id to show first. if it isn't in the package or has no instances, the first level with instances is shown                                                                                                           |

the app keeps both in sync with `history.replaceState`, so a reload or a shared link reopens the
same package and level. packages opened from local folders have no `package` value.
