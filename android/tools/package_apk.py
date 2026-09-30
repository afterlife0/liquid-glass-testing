#!/usr/bin/env python3
"""Assemble the unsigned APK: aapt2's linked manifest + resources, classes.dex,
and the web build under assets/www. Uncompressed entries are 4-byte aligned
(what `zipalign -p 4` does) — Android 11+ refuses a targetSdk ≥ 30 APK whose
resources.arsc is compressed or unaligned."""
import os
import sys
import zipfile

STORE = {'resources.arsc'}          # must be stored + aligned
STORE_EXT = ('.png', '.webp', '.jpg')  # already compressed


def add(zout, name, data, stored):
    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    info.create_system = 0
    if stored:
        info.compress_type = zipfile.ZIP_STORED
        # data starts after the 30-byte local header + name + extra; pad extra to align
        offset = zout.fp.tell() + 30 + len(name.encode())
        pad = (4 - offset % 4) % 4
        info.extra = b'\x00' * pad
    else:
        info.compress_type = zipfile.ZIP_DEFLATED
    zout.writestr(info, data)


def main(linked, dex, www, out):
    with zipfile.ZipFile(linked) as zin, zipfile.ZipFile(out, 'w') as zout:
        names = zin.namelist()
        # manifest first, as build tools do
        for n in sorted(names, key=lambda n: (n != 'AndroidManifest.xml', n)):
            add(zout, n, zin.read(n), n in STORE or n.endswith(STORE_EXT))
        add(zout, 'classes.dex', open(dex, 'rb').read(), False)
        for root, _, files in os.walk(www):
            for f in sorted(files):
                p = os.path.join(root, f)
                rel = os.path.relpath(p, www).replace(os.sep, '/')
                add(zout, 'assets/www/' + rel, open(p, 'rb').read(), f.endswith(STORE_EXT))
    check_alignment(out)


def check_alignment(path):
    import struct
    with open(path, 'rb') as fh, zipfile.ZipFile(path) as z:
        for i in z.infolist():
            if i.compress_type != zipfile.ZIP_STORED:
                continue
            fh.seek(i.header_offset)
            h = fh.read(30)
            n, e = struct.unpack('<HH', h[26:30])
            start = i.header_offset + 30 + n + e
            if start % 4:
                sys.exit(f'unaligned stored entry: {i.filename} @ {start}')


if __name__ == '__main__':
    if len(sys.argv) == 2:
        check_alignment(sys.argv[1]); print('aligned')
    else:
        main(*sys.argv[1:5])
