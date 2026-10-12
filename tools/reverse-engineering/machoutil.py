"""Small readers for dylibs extracted from a dyld shared cache (x86_64) and for
the cache itself, plus two QuartzCore-specific decoders used in the Liquid
Glass teardown:

  python3 machoutil.py atoms QuartzCore 0x<_wordlist> 0x<_stringpool_contents> [0x14d 0x182 ...]
      Decode CA's gperf atom table (atom id -> key name, e.g. 0x182 -> inputInnerRefractionAmount).
      Find both addresses in `_CAAtomGetString` (REA procedure_pseudo_code / assembly).

  python3 machoutil.py dict QuartzCore 0x<__objc_dictobj entry>
      Decode a compile-time constant NSDictionary (CFString keys, NSNumber values),
      e.g. +[CASDFGlassDisplacementEffect defaultValues].

  python3 machoutil.py sym CACHE_DIR 0x<addr>  -> nothing fancy; use `ipsw dyld a2s` for GOT slots.

Pointers inside extracted cache dylibs keep the cache's packed format; `unslide`
recovers the target address (x86_64 caches: low 40 bits + 0x7ff800000000).
"""
import bisect, glob, mmap, os, struct, subprocess, sys

CACHE_BASE = 0x7FF800000000


def unslide(v):
    return (v & 0xFFFFFFFFFF) + CACHE_BASE if v else 0


class MachO:
    def __init__(self, path):
        self.path = path
        self.d = open(path, "rb").read()
        magic, _, _, _, ncmds, _, _, _ = struct.unpack("<IiiIIIII", self.d[:32])
        assert magic == 0xFEEDFACF, "thin 64-bit Mach-O expected"
        off, self.segs = 32, []
        for _ in range(ncmds):
            cmd, size = struct.unpack("<II", self.d[off:off + 8])
            if cmd == 0x19:  # LC_SEGMENT_64
                name = self.d[off + 8:off + 24].rstrip(b"\0").decode()
                va, vs, fo, fs = struct.unpack("<QQQQ", self.d[off + 24:off + 56])
                self.segs.append((name, va, vs, fo, fs))
            off += size
        self._syms = None

    def read(self, addr, n):
        for _, va, _, fo, fs in self.segs:
            if va <= addr < va + fs:
                o = fo + addr - va
                return self.d[o:o + n]
        raise KeyError(hex(addr))

    def u64(self, a): return struct.unpack("<Q", self.read(a, 8))[0]
    def cstr(self, a, n=512): return self.read(a, n).split(b"\0", 1)[0].decode("utf-8", "replace")

    def symbols(self):
        if self._syms is None:
            nm = os.environ.get("LLVM_NM", "llvm-nm")
            out = subprocess.run([nm, "-n", self.path], capture_output=True, text=True).stdout
            self._syms = sorted((int(p[0], 16), p[2]) for p in (l.split(None, 2) for l in out.splitlines())
                                if len(p) == 3 and len(p[0]) == 16)
            self._addrs = [a for a, _ in self._syms]
        return self._syms

    def sym_at(self, addr):
        self.symbols()
        i = bisect.bisect_right(self._addrs, addr) - 1
        a, n = self._syms[i]
        return n if a == addr else f"{n}+{addr - a:#x}"


class Cache:
    """dyld_shared_cache_<arch> plus its .NN subcaches: vmaddr -> bytes."""

    def __init__(self, base):
        self.maps = []
        for path in [base] + sorted(glob.glob(base + ".[0-9][0-9]")):
            mm = mmap.mmap(open(path, "rb").fileno(), 0, access=mmap.ACCESS_READ)
            moff, mcount = struct.unpack_from("<II", mm, 0x10)
            for i in range(mcount):
                a, s, fo, _, _ = struct.unpack_from("<QQQII", mm, moff + 32 * i)
                self.maps.append((a, s, fo, mm))

    def read(self, addr, n):
        for a, s, fo, mm in self.maps:
            if a <= addr < a + s:
                return mm[fo + addr - a:fo + addr - a + n]
        raise KeyError(hex(addr))

    def u64(self, a): return struct.unpack("<Q", self.read(a, 8))[0]
    def cstr(self, a, n=256): return self.read(a, n).split(b"\0", 1)[0].decode("utf-8", "replace")


def atoms(m, wordlist, pool, size=0x2624):
    """gperf wordlist of {int16 offset into stringpool, uint16 atom}."""
    raw, out = m.read(wordlist, size), {}
    for i in range(0, size, 4):
        off, atom = struct.unpack_from("<hH", raw, i)
        out.setdefault(atom, m.cstr(pool + off, 128))
    return out


def section_ranges(m):
    nm = os.environ.get("LLVM_OBJDUMP", "llvm-objdump")
    out = subprocess.run([nm, "--section-headers", m.path], capture_output=True, text=True).stdout
    secs = {}
    for l in out.splitlines():
        p = l.split()
        if len(p) >= 4 and p[1].startswith("__objc_"):
            secs[p[1]] = (int(p[3], 16), int(p[3], 16) + int(p[2], 16))
    return secs


def objc_const(m, a, secs):
    """Decode a constant ObjC object: NSNumber (int/double/float), NSDictionary, CFString."""
    inr = lambda s: s in secs and secs[s][0] <= a < secs[s][1]
    if inr("__objc_doubleobj"):
        return struct.unpack("<d", m.read(a + 8, 8))[0]
    if inr("__objc_intobj"):          # {isa, encoding*, int64}
        return struct.unpack("<q", m.read(a + 16, 8))[0]
    if inr("__objc_floatobj"):
        return struct.unpack("<f", m.read(a + 8, 4))[0]
    if inr("__objc_dictobj"):
        return objc_dict(m, a, secs)
    isa, flags, ptr, ln = struct.unpack("<QQQQ", m.read(a, 32))  # CFString literal
    return m.read(unslide(ptr), ln).decode("utf-8", "replace")


def objc_dict(m, a, secs):
    """__objc_dictobj entry: {isa, options, count, keys*, values*}."""
    _, _, count, kp, vp = struct.unpack("<QQQQQ", m.read(a, 40))
    kp, vp = unslide(kp), unslide(vp)
    return {objc_const(m, unslide(m.u64(kp + 8 * i)), secs): objc_const(m, unslide(m.u64(vp + 8 * i)), secs)
            for i in range(count)}


if __name__ == "__main__":
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "atoms":
        m = MachO(path)
        table = atoms(m, int(sys.argv[3], 16), int(sys.argv[4], 16))
        want = [int(x, 16) for x in sys.argv[5:]] or sorted(table)
        for k in want:
            print(f"{k:#x} {table.get(k)}")
    elif cmd == "dict":
        m = MachO(path)
        print(objc_dict(m, int(sys.argv[3], 16), section_ranges(m)))
