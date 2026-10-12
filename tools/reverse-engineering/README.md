# Reverse-engineering tools

These scripts were used for the Liquid Glass teardown in
[`docs/reverse-engineering/liquid-glass.md`](../../docs/reverse-engineering/liquid-glass.md).
They are standalone Python 3 scripts with no project dependencies. They read Apple
binaries; none are included here.

| Script | What it does |
| --- | --- |
| `rea_mcp_bridge.py` | Runs one `rea mcp` server and exposes it on a Unix socket, so a single Ghidra analysis serves many REA tool calls (`open_binary`, `search_strings`, `procedure_pseudo_code`, `xrefs`, `export_evidence_bundle`, …). |
| `imgfs.py` | Lists or extracts files from a raw GPT image or a `.dmg` (HFS+/APFS) without mounting it. It also works on split remote images via HTTP Range, fetching only what it reads. |
| `udif.py` | Random-access UDIF (`.dmg`) reader supporting raw, zero, zlib, bzip2, **LZFSE** and LZMA chunks. |
| `chunklist.py` | Verifies a `*.chunklist` (per-chunk SHA-256 plus Apple's RSA signature) against its image. |
| `metallib.py` | Splits a Metal library (`MTLB`) into per-function AIR bitcode modules and writes an index. |
| `air2c.py` | Turns `llvm-dis` output of AIR into compact pseudo-C, with uniform-struct field names taken from `air.struct_type_info`. |
| `machoutil.py` | Helpers for dylibs extracted from the dyld cache: unpacking cache pointers, symbols, the QuartzCore atom table, and constant `NSDictionary`/`NSNumber` decoding. |

## Setup

```bash
npm install --global rea-agents                       # REA 6.4.0 (CLI + MCP server)
# Ghidra 12.1.x + a full JDK 21 (REA brings neither):
export GHIDRA_INSTALL_DIR=/opt/ghidra_12.1.4_PUBLIC JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
rea doctor --provider ghidra --json                   # must report healthy
rea setup --client claude_code                         # optional: register REA with your agent
pip install libfshfs-python libfsapfs-python pyliblzfse  # for imgfs.py / udif.py
# ipsw (https://github.com/blacktop/ipsw) for dyld-cache extraction and swift-dump; llvm-dis 18
```

## Pipeline used for Liquid Glass (macOS 26.7)

```bash
# 1. Recovery OS image from an installer you obtained from Apple, then verify it.
python3 chunklist.py BaseSystem.chunklist BaseSystem.dmg OcAppleKeysLib.c
python3 imgfs.py BaseSystem.dmg --dmg-partition Apple_APFS get \
    /System/Library/dyld/dyld_shared_cache_x86_64 dsc          # and the .01 subcache
python3 imgfs.py BaseSystem.dmg --dmg-partition Apple_APFS get \
    /System/Library/Frameworks/QuartzCore.framework/Versions/A/Resources/default.metallib qc.metallib

# 2. Individual dylibs and Swift type layouts.
for lib in QuartzCore SwiftUICore DesignLibrary; do ipsw dyld extract dsc $lib --output dylibs; done
ipsw swift-dump dsc DesignLibrary --demangle > DesignLibrary.swift.txt

# 3. Native analysis with REA (one session per binary).
REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py serve &
REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py call open_binary \
    '{"path":"'$PWD'/dylibs/QuartzCore","provider_id":"ghidra"}'
REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py call search_procedures \
    '{"pattern":"GlassBackgroundFilter","mode":"literal"}'
REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py call procedure_pseudo_code \
    '{"procedure":"0x7ff80a68a774"}'                           # CA::OGL::GlassBackgroundFilter::render
python3 machoutil.py atoms dylibs/QuartzCore 0x7ff80a8781a0 0x7ff80a87a7c4 0x182 0x183   # atom → key
python3 machoutil.py dict  dylibs/QuartzCore 0x7ff840caf5a0                            # effect defaults
REA_SOCK=/tmp/qc.sock python3 rea_mcp_bridge.py call export_evidence_bundle '{"path":"/abs/evidence.json"}'

# 4. GPU side.
python3 metallib.py qc.metallib air/
for f in air/*.bc; do llvm-dis-18 "$f" -o "${f%.bc}.ll"; done
python3 air2c.py air/glass_background_sdf_lpf.ll
```

The addresses above are for the 26.7 (25G229) x86_64 cache. Rediscover them in
other builds with REA's `search_procedures` and `search_strings`.
