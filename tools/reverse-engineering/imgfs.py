"""List or extract files from an Apple disk image without mounting it.

Handles a raw GPT disk image or a UDIF .dmg (via udif.py), with an HFS+ or APFS
partition (libfshfs / libfsapfs Python bindings: `pip install libfshfs-python
libfsapfs-python pyliblzfse`). The source can be a local file or a list of
HTTP(S) URLs whose concatenation is the image (split release assets); only the
byte ranges actually read are fetched, with HTTP Range requests.

  python3 imgfs.py IMAGE ls /System/Library/dyld
  python3 imgfs.py IMAGE get /System/Library/dyld/dyld_shared_cache_x86_64 OUT
  python3 imgfs.py --remote URL1 URL2 ... -- ls /BaseSystem
  python3 imgfs.py IMAGE --dmg-partition Apple_APFS ls /     # image is a .dmg
"""
import io, os, struct, sys, uuid, urllib.request, ssl, threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BLOCK = 1 << 20


class Source(io.RawIOBase):
    """Seekable, read-only view over a local file or concatenated remote parts."""

    def __init__(self, local=None, urls=None, cache=os.environ.get("IMGFS_CACHE", "/tmp/imgfs-cache")):
        self.pos = 0
        if local:
            self.f = open(local, "rb")
            self.length = os.path.getsize(local)
            self.pread = self._pread_local
            return
        self.urls, self.cache = urls, cache
        os.makedirs(cache, exist_ok=True)
        ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE"))
        self.op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
        self.sizes = []
        for u in urls:  # HEAD each part for its size
            with self.op.open(urllib.request.Request(u, method="HEAD"), timeout=60) as r:
                self.sizes.append(int(r.headers["Content-Length"]))
        self.length = sum(self.sizes)
        self.pread = self._pread_remote
        self.lock = threading.Lock()

    def _pread_local(self, off, n):
        self.f.seek(off)
        return self.f.read(n)

    def _block(self, i):
        path = os.path.join(self.cache, f"{i:08d}")
        if os.path.exists(path):
            return open(path, "rb").read()
        start, end, out, acc = i * BLOCK, min((i + 1) * BLOCK, self.length), bytearray(), 0
        for u, sz in zip(self.urls, self.sizes):
            lo, hi = max(start, acc), min(end, acc + sz)
            if lo < hi:
                req = urllib.request.Request(u, headers={"Range": f"bytes={lo - acc}-{hi - acc - 1}"})
                with self.op.open(req, timeout=120) as r:
                    out += r.read()
            acc += sz
        open(path + ".tmp", "wb").write(out)
        os.replace(path + ".tmp", path)
        return bytes(out)

    def _pread_remote(self, off, n):
        out = bytearray()
        while n > 0 and off < self.length:
            b = self._block(off // BLOCK)
            o = off % BLOCK
            chunk = b[o:o + n]
            out += chunk
            off += len(chunk)
            n -= len(chunk)
        return bytes(out)

    # io.RawIOBase / libbfio file-object protocol
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def get_size(self): return self.length

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.length + off
        return self.pos

    def read(self, n=-1):
        n = self.length - self.pos if n is None or n < 0 else min(n, self.length - self.pos)
        d = self.pread(self.pos, n)
        self.pos += len(d)
        return d


class Slice(Source):
    def __init__(self, pread, base, length):
        self.pos, self.length, self._p, self.base = 0, length, pread, base
        self.pread = lambda off, n: self._p(self.base + off, max(0, min(n, self.length - off)))


def partitions(pread):
    """GPT entries: (type-guid, first byte, length, name)."""
    hdr = pread(512, 92)
    if hdr[:8] != b"EFI PART":
        return []
    lba, n, esz = struct.unpack("<QII", hdr[72:88])
    ents = pread(lba * 512, n * esz)
    out = []
    for i in range(n):
        e = ents[i * esz:(i + 1) * esz]
        if e[:16] == bytes(16):
            continue
        first, last = struct.unpack("<QQ", e[32:48])
        out.append((str(uuid.UUID(bytes_le=e[:16])), first * 512, (last - first + 1) * 512,
                    e[56:128].decode("utf-16le").rstrip("\0")))
    return out


HFS = "48465300-0000-11aa-aa11-00306543ecac"
APFS = "7c3457ef-0000-11aa-aa11-00306543ecac"


def open_fs(src, dmg_partition=None):
    """Return (kind, root-like object with get_file_entry_by_path)."""
    if dmg_partition:
        import udif
        u = udif.UDIF(src.pread, src.length)
        name, first, count, _ = next(p for p in u.partitions if dmg_partition in p[0])
        vol = Slice(u.pread_raw, first * 512, count * 512)
    else:
        parts = partitions(src.pread)
        p = next((p for p in parts if p[0] in (HFS, APFS)), None)
        vol = Slice(src.pread, p[1], p[2]) if p else src
    magic = vol.pread(32, 4), vol.pread(1024, 2)
    if magic[0] == b"NXSB":
        import pyfsapfs
        c = pyfsapfs.container()
        c.open_file_object(vol)
        return c.get_volume(int(os.environ.get("APFS_VOLUME", "0")))
    import pyfshfs
    v = pyfshfs.volume()
    v.open_file_object(vol)
    return v


def main(argv):
    remote = None
    dmg = None
    if argv[0] == "--remote":
        i = argv.index("--")
        remote, argv = argv[1:i], argv[i + 1:]
        src = Source(urls=remote)
    else:
        src, argv = Source(local=argv[0]), argv[1:]
    if argv[0] == "--dmg-partition":
        dmg, argv = argv[1], argv[2:]
    fs = open_fs(src, dmg)
    cmd, path = argv[0], argv[1]
    e = fs.get_file_entry_by_path(path)
    if cmd == "ls":
        for i in range(e.number_of_sub_file_entries):
            s = e.get_sub_file_entry(i)
            print(s.name + ("/" if s.number_of_sub_file_entries else ""), s.size)
    elif cmd == "get":
        out = argv[2]
        with open(out, "wb") as o:
            pos = 0
            while pos < e.size:
                d = e.read_buffer_at_offset(min(16 << 20, e.size - pos), pos)
                o.write(d)
                pos += len(d)
        print(out, e.size)


if __name__ == "__main__":
    main(sys.argv[1:])
