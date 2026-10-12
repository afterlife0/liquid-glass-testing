"""Random-access reader for Apple UDIF (.dmg) images. Decompresses only the
chunks that a read touches (raw/zero/zlib/bzip2/LZFSE/LZMA), with a small LRU."""
import struct, plistlib, zlib, bz2, lzma, bisect
from collections import OrderedDict
import liblzfse

SECTOR = 512


class UDIF:
    def __init__(self, pread, size):
        self.pread = pread
        koly = pread(size - 512, 512)
        assert koly[:4] == b"koly", koly[:4]
        self.data_fork_offset = struct.unpack(">Q", koly[24:32])[0]
        xml_off, xml_len = struct.unpack(">QQ", koly[216:232])
        pl = plistlib.loads(pread(xml_off, xml_len))
        self.partitions = []
        for b in pl["resource-fork"]["blkx"]:
            d = b["Data"]
            first_sector, sector_count = struct.unpack(">QQ", d[8:24])
            nchunks = struct.unpack(">I", d[200:204])[0]
            chunks = []
            for i in range(nchunks):
                c = d[204 + 40 * i: 244 + 40 * i]
                typ, _, sec, cnt, coff, clen = struct.unpack(">IIQQQQ", c)
                if typ in (0x7FFFFFFE, 0xFFFFFFFF):
                    continue
                chunks.append((first_sector + sec, cnt, typ, coff, clen))
            self.partitions.append((b.get("Name", ""), first_sector, sector_count, chunks))
        self.chunks = sorted(c for p in self.partitions for c in p[3])
        self.starts = [c[0] for c in self.chunks]
        self.size = max(c[0] + c[1] for c in self.chunks) * SECTOR
        self.cache = OrderedDict()

    def _chunk(self, i):
        if i in self.cache:
            self.cache.move_to_end(i)
            return self.cache[i]
        sec, cnt, typ, coff, clen = self.chunks[i]
        n = cnt * SECTOR
        if typ in (0, 2):
            data = bytes(n)
        else:
            raw = self.pread(self.data_fork_offset + coff, clen)
            if typ == 1:
                data = raw
            elif typ == 0x80000005:
                data = zlib.decompress(raw)
            elif typ == 0x80000006:
                data = bz2.decompress(raw)
            elif typ == 0x80000007:
                data = liblzfse.decompress(raw)
            elif typ == 0x80000008:
                data = lzma.decompress(raw)
            else:
                raise NotImplementedError(hex(typ))
        if len(data) < n:
            data += bytes(n - len(data))
        self.cache[i] = data
        if len(self.cache) > 64:
            self.cache.popitem(last=False)
        return data

    def pread_raw(self, off, n):
        out = bytearray()
        while n > 0:
            sec = off // SECTOR
            i = bisect.bisect_right(self.starts, sec) - 1
            csec, cnt = self.chunks[i][0], self.chunks[i][1]
            if i < 0 or sec >= csec + cnt:  # gap: zero
                nxt = self.starts[i + 1] * SECTOR if i + 1 < len(self.starts) else off + n
                take = min(n, nxt - off)
                out += bytes(take)
            else:
                data = self._chunk(i)
                o = off - csec * SECTOR
                take = min(n, len(data) - o)
                out += data[o:o + take]
            off += take
            n -= take
        return bytes(out)
