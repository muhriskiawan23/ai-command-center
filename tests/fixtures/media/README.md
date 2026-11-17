# Synthetic media fixtures

No customer media or provider-generated output. `still.jpg` and `still.webp`
are 64×64 local conversions of this repository's `public/icon-192.png`.
`short.webm` is a one-second, 160×120, 10 fps FFmpeg `testsrc` color pattern,
encoded as VP9/yuv420p. All three fixtures are small, static test inputs;
they do not require remote services or paid inference.

Reproduce with FFmpeg:

```sh
ffmpeg -i public/icon-192.png -vf scale=64:64 -frames:v 1 tests/fixtures/media/still.jpg
ffmpeg -i public/icon-192.png -vf scale=64:64 -frames:v 1 tests/fixtures/media/still.webp
ffmpeg -f lavfi -i testsrc=size=160x120:rate=10 -t 1 -pix_fmt yuv420p -c:v libvpx-vp9 -f webm tests/fixtures/media/short.webm
```
