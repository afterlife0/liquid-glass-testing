"""Minimal Metal library (MTLB) reader: lists functions and writes each one's
AIR bitcode module to <out>/<name>.bc for llvm-dis."""
import struct, sys, os, json

TYPES = {0: "vertex", 1: "fragment", 2: "kernel", 3: "unqualified", 4: "visible", 5: "extern", 6: "intersection"}


def parse(path):
    d = open(path, "rb").read()
    assert d[:4] == b"MTLB"
    fl_off, fl_size, pub_off, pub_size, prv_off, prv_size, bc_off, bc_size = struct.unpack("<8Q", d[24:88])
    n = struct.unpack("<I", d[fl_off:fl_off + 4])[0]
    p = fl_off + 4
    funcs = []
    for _ in range(n):
        size = struct.unpack("<I", d[p:p + 4])[0]
        q, end = p + 4, p + size
        f = {}
        while q < end:
            tag = d[q:q + 4].decode("latin1")
            if tag == "ENDT":
                break
            ln = struct.unpack("<H", d[q + 4:q + 6])[0]
            val = d[q + 6:q + 6 + ln]
            if tag == "NAME":
                f["name"] = val.rstrip(b"\0").decode()
            elif tag == "TYPE":
                f["type"] = TYPES.get(val[0], val[0])
            elif tag == "MDSZ":
                f["bc_size"] = struct.unpack("<Q", val)[0]
            elif tag == "OFFT":
                f["pub"], f["prv"], f["bc"] = struct.unpack("<3Q", val)
            elif tag == "HASH":
                f["sha256"] = val.hex()
            q += 6 + ln
        f["bitcode"] = d[bc_off + f["bc"]: bc_off + f["bc"] + f["bc_size"]]
        funcs.append(f)
        p = end
    return funcs


if __name__ == "__main__":
    path, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    index = []
    for f in parse(path):
        bc = f.pop("bitcode")
        fn = f["name"].replace("/", "_")
        open(os.path.join(out, fn + ".bc"), "wb").write(bc)
        index.append(f)
        print(f["type"], f["name"], f["bc_size"])
    json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1)
