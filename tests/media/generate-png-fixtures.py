"""Optional fixture regeneration. Pillow verifies pixels; not a runtime dependency."""
import hashlib
import io
import json
import pathlib
import struct
import zlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEST = ROOT / "tests/fixtures/media"

def chunk(kind, payload=b""):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

def paeth(a, b, c):
    p = a + b - c
    return min([(abs(p-a), 0, a), (abs(p-b), 1, b), (abs(p-c), 2, c)])[2]

manifest = {}
for colour, channels in [(0, 1), (2, 3), (4, 2), (6, 4)]:
    width = height = 64
    pixels = bytes((x*7 + y*13 + channel*51) % 256
                   for y in range(height) for x in range(width) for channel in range(channels))
    stride = width * channels
    lines = bytearray()
    for y in range(height):
        filtering = y % 5
        lines.append(filtering)
        for x in range(stride):
            index = y * stride + x
            a = pixels[index-channels] if x >= channels else 0
            b = pixels[index-stride] if y else 0
            c = pixels[index-stride-channels] if y and x >= channels else 0
            prediction = [0, a, b, (a+b)//2, paeth(a, b, c)][filtering]
            lines.append((pixels[index] - prediction) % 256)
    header = struct.pack(">IIBBBBB", width, height, 8, colour, 0, 0, 0)
    encoded = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
               + chunk(b"tEXt", b"Comment\0private email example@example.test GPS 1,2")
               + chunk(b"IDAT", zlib.compress(lines)) + chunk(b"IEND"))
    independently_decoded = Image.open(io.BytesIO(encoded)).tobytes()
    assert independently_decoded == pixels
    name = f"filters-color-{colour}.png"
    (DEST / name).write_bytes(encoded)
    manifest[name] = dict(width=width, height=height, channels=channels,
                          pixelSha256=hashlib.sha256(independently_decoded).hexdigest())
manifest["repository-icon-192"] = dict(width=192, height=192, channels=4,
    pixelSha256=hashlib.sha256(Image.open(ROOT / "public/icon-192.png").tobytes()).hexdigest())
(DEST / "png-pixel-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
