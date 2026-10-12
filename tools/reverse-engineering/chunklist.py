"""Verify an Apple chunklist (BaseSystem.chunklist, *.chunklist) against its
image: every chunk's SHA-256, and the RSA-2048 PKCS#1 v1.5 signature over the
chunklist header+chunks using Apple's chunklist public keys.

The keys are read from OpenCorePkg's Library/OcAppleKeysLib/OcAppleKeysLib.c
(pass its path; it is not vendored here).

  python3 chunklist.py BaseSystem.chunklist BaseSystem.dmg OcAppleKeysLib.c
"""
import hashlib, re, struct, sys

SHA256_DIGESTINFO = bytes.fromhex("3031300d060960864801650304020105000420")


def apple_keys(keys_c):
    src = open(keys_c).read()
    keys = {}
    for name in re.findall(r"OC_RSA_PUBLIC_KEY_2048\s+(\w+)\s*=", src):
        body = src[src.index(f"OC_RSA_PUBLIC_KEY_2048  {name} = {{"):]
        body = body[body.index("// N"):]
        n = bytes(int(x, 16) for x in re.findall(r"0x([0-9a-fA-F]{2})\b", body)[:256])
        keys[name] = int.from_bytes(n, "little")
    return keys


def verify(chunklist, image, keys_c):
    c = open(chunklist, "rb").read()
    magic, hsize, ver, cmeth, smeth, _, count, coff, soff = struct.unpack("<4sIBBBBQQQ", c[:36])
    assert magic == b"CNKL", magic
    bad, total = 0, 0
    with open(image, "rb") as f:
        for i in range(count):
            size = struct.unpack("<I", c[coff + 36 * i:coff + 36 * i + 4])[0]
            d = f.read(size)
            total += len(d)
            bad += hashlib.sha256(d).digest() != c[coff + 36 * i + 4:coff + 36 * i + 36]
        trailing = f.read(1)
    print(f"chunks={count} bytes={total} mismatched={bad} trailing_data={bool(trailing)}")
    digest = hashlib.sha256(c[:soff]).digest()
    sig = int.from_bytes(c[soff:soff + 256][::-1], "big")  # stored little-endian
    for name, n in apple_keys(keys_c).items():
        em = pow(sig, 65537, n).to_bytes(256, "big")
        if em.startswith(b"\x00\x01\xff") and em.endswith(SHA256_DIGESTINFO + digest):
            print(f"signature: VALID (Apple key {name})")
            return bad == 0 and not trailing
    print("signature: no Apple key matched")
    return False


if __name__ == "__main__":
    sys.exit(0 if verify(*sys.argv[1:4]) else 1)
