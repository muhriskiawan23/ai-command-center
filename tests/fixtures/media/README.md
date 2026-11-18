# Synthetic media fixtures

No customer media or provider-generated output. `still.jpg` and `still.webp`
are 64×64 local conversions of this repository's `public/icon-192.png`.
`short.webm` is a one-second, 160×120, 10 fps FFmpeg `testsrc` color pattern,
encoded as VP9/yuv420p. All three fixtures are small, static test inputs;
they do not require remote services or paid inference.

`filters-color-{0,2,4,6}.png` are synthetic 64×64, 8-bit grayscale/RGB/
grayscale-alpha/RGBA patterns. Every fixture uses all five PNG filters and
contains a deliberately private-looking **fictional** tEXt comment. Their
decoded pixels were independently checked with Pillow against the original
pattern bytes. SHA-256 pixel digests are in `png-pixel-manifest.json`, which
also records a Pillow-decoded digest for the existing repository icon. These
digests detect pixel/filter/alpha changes during real decoder round trips.

Reproduce with FFmpeg:

```sh
ffmpeg -i public/icon-192.png -vf scale=64:64 -frames:v 1 tests/fixtures/media/still.jpg
ffmpeg -i public/icon-192.png -vf scale=64:64 -frames:v 1 tests/fixtures/media/still.webp
ffmpeg -f lavfi -i testsrc=size=160x120:rate=10 -t 1 -pix_fmt yuv420p -c:v libvpx-vp9 -f webm tests/fixtures/media/short.webm
```
