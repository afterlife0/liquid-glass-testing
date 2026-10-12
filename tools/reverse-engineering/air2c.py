"""Turn llvm-dis output of Apple AIR shaders into compact pseudo-C:
struct fields get their names from air.struct_type_info metadata, AIR
intrinsics lose their prefixes, float/half hex constants become decimals,
and single-use values are inlined into their user."""
import re, sys, struct as st

src = open(sys.argv[1]).read()
lines = src.split("\n")

# ---- metadata -> struct field names -------------------------------------
md = {}
for l in lines:
    m = re.match(r"^!(\d+) = (?:distinct )?!\{(.*)\}$", l)
    if m:
        md[m.group(1)] = m.group(2)

fields = {}  # struct type name -> [field names]
for k, body in md.items():
    for m in re.finditer(r'!"air\.struct_type_info", !(\d+), i32 \d+, i32 \d+, i32 \d+, !"([^"]+)", !"([^"]+)"', body):
        sub, tname, _ = m.groups()
        names = re.findall(r'i32 \d+, i32 \d+, i32 \d+, !"[^"]+", !"([^"]+)"', md[sub])
        fields[tname] = names
    m = re.search(r'!"air\.struct_type_info", !(\d+),.*!"air\.arg_type_name", !"([^"]+)"', body)
    if m:
        names = re.findall(r'i32 \d+, i32 \d+, i32 \d+, !"[^"]+", !"([^"]+)"', md[m.group(1)])
        fields.setdefault(m.group(2), names)
structs = {}
for l in lines:
    m = re.match(r"^%struct\.([A-Za-z0-9_]+)(\.\d+)? = type \{ (.*) \}$", l)
    if m:
        structs["%struct." + m.group(1) + (m.group(2) or "")] = (m.group(1), m.group(3))


def field_type(sname, idx):
    """IR type string of field idx of a struct (to follow nested GEPs)."""
    body = structs[sname][1]
    depth, cur, parts = 0, "", []
    for ch in body:
        if ch in "<{[":
            depth += 1
        if ch in ">}]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip()); cur = ""
        else:
            cur += ch
    parts.append(cur.strip())
    return parts[idx]


def fname(sname, idx):
    base = structs.get(sname, (sname, ""))[0]
    names = fields.get(base)
    if names and idx < len(names):
        return names[idx]
    return f"f{idx}"


# ---- constants ----------------------------------------------------------
def const(tok):
    tok = tok.strip()
    if tok.startswith("0xH"):
        return fmt(st.unpack("<e", int(tok[3:], 16).to_bytes(2, "little"))[0]) + "h"
    if tok.startswith("0x") and len(tok) == 18:
        v = st.unpack(">d", bytes.fromhex(tok[2:]))[0]
        return fmt(v)
    return tok


def fmt(v):
    if v == v and abs(v) < 1e6 and v == int(v):
        return f"{v:.1f}"
    return f"{v:.7g}"


INTR = re.compile(r"@air\.(?:fast_)?([a-z_0-9]+?)(?:\.(?:v\d+)?[fsiu]\d+)*(?:\.[a-z0-9.]+)?\(")

out = []
for fn in re.finditer(r"^define [^\n]*?@([^\(]+)\((.*?)\)[^\n]*\{\n(.*?)\n\}", src, re.S | re.M):
    name, params, body = fn.groups()
    defs, uses = {}, {}
    instrs = body.split("\n")
    for ins in instrs:
        for v in re.findall(r"%[\w.]+", ins.split("=", 1)[1] if re.match(r"\s*%[\w.]+ =", ins) else ins):
            uses[v] = uses.get(v, 0) + 1
    ptr = {}   # gep results -> symbolic lvalue
    expr = {}  # inlined expressions
    text = [f"\n// ===== {name}({params[:200]})"]

    def val(t):
        t = t.strip()
        t = re.sub(r"^(noundef |nocapture |readonly |nonnull )+", "", t)
        m = re.match(r"^(?:<\d+ x \w+>|\w+|ptr(?: addrspace\(\d\))?|\{[^}]*\})\s+(.*)$", t)
        if m and not t.startswith("%"):
            t = m.group(1).strip()
        t = re.sub(r"^(noundef |nocapture |readonly |nonnull )+", "", t)
        if t.startswith("%"):
            return expr.get(t, ptr.get(t, t.replace("%", "v")))
        if t.startswith("<") and t.endswith(">"):
            return "(" + ", ".join(val(x) for x in split_args(t[1:-1])) + ")"
        return const(t)

    def split_args(s):
        depth, cur, parts = 0, "", []
        for ch in s:
            if ch in "(<[{":
                depth += 1
            if ch in ")>]}":
                depth -= 1
            if ch == "," and depth == 0:
                parts.append(cur); cur = ""
            else:
                cur += ch
        if cur.strip():
            parts.append(cur)
        return parts

    OPS = {"fadd": "+", "fsub": "-", "fmul": "*", "fdiv": "/", "add": "+", "sub": "-", "mul": "*",
           "and": "&", "or": "|", "xor": "^", "shl": "<<", "lshr": ">>", "ashr": ">>", "sdiv": "/", "udiv": "/",
           "srem": "%", "urem": "%", "frem": "%"}
    CMP = {"olt": "<", "ogt": ">", "oeq": "==", "one": "!=", "ole": "<=", "oge": ">=", "ult": "<", "ugt": ">",
           "uge": ">=", "ule": "<=", "une": "!=", "ueq": "==", "slt": "<", "sgt": ">", "sle": "<=", "sge": ">=",
           "eq": "==", "ne": "!="}
    SW = "xyzw"
    for ins in instrs:
        s = ins.strip()
        if not s or s.startswith(";"):
            if re.match(r"^\d+:", ins):
                text.append(f"L{ins.split(':')[0]}:")
            continue
        if re.match(r"^\d+:", s):
            text.append(f"L{s.split(':')[0]}:")
            continue
        s = re.sub(r", !(tbaa|alias\.scope|noalias|range|fpmath|llvm\.[\w.]+) !\d+", "", s)
        s = re.sub(r" #\d+$", "", s)
        m = re.match(r"(%[\w.]+) = (.*)$", s)
        lhs, rhs = (m.group(1), m.group(2)) if m else (None, s)
        e = None
        if (g := re.match(r"getelementptr inbounds (%struct\.[\w.]+), ptr(?: addrspace\(\d\))? (%[\w.]+), i64 0((?:, i32 \d+)*)", rhs)):
            sname, base, idxs = g.groups()
            path = ptr.get(base, val(base))
            cur = sname
            for i in [int(x) for x in re.findall(r"i32 (\d+)", idxs)]:
                path += "." + fname(cur, i)
                ft = field_type(cur, i)
                cur = ft if ft.startswith("%struct.") else None
                if cur is None:
                    break
            ptr[lhs] = path
            continue
        if (g := re.match(r"getelementptr inbounds i8, ptr(?: addrspace\(\d\))? (%[\w.]+), i64 (-?\d+)", rhs)):
            ptr[lhs] = f"{val(g.group(1))}+{g.group(2)}B"
            continue
        if (g := re.match(r"load ([^,]+), ptr(?: addrspace\(\d\))? (%[\w.]+)", rhs)):
            e = ptr.get(g.group(2), "*" + val(g.group(2)))
        elif (g := re.match(r"(f?\w+) (?:(?:fast|nuw|nsw|exact|reassoc|nnan|ninf|nsz|arcp|contract|afn|disjoint) )*(<\d+ x \w+>|\w+) (%[\w.]+|[-+\w.]+|<[^>]*>), (%[\w.]+|[-+\w.]+|<[^>]*>)$", rhs)) and g.group(1) in OPS:
            e = f"({val(g.group(3))} {OPS[g.group(1)]} {val(g.group(4))})"
        elif (g := re.match(r"fneg (?:fast )?[^%]*(%[\w.]+)", rhs)):
            e = f"-{val(g.group(1))}"
        elif (g := re.match(r"[fi]cmp (?:fast )?(\w+) (?:<\d+ x \w+>|\w+) (%[\w.]+|[-+\w.]+|<[^>]*>), (%[\w.]+|[-+\w.]+|<[^>]*>)$", rhs)):
            e = f"({val(g.group(2))} {CMP.get(g.group(1), g.group(1))} {val(g.group(3))})"
        elif (g := re.match(r"select (?:[\w ]*? )?i1 (.+?), (\w+|<[^>]*>) (.+?), (\w+|<[^>]*>) (.+)$", rhs)) or \
             (g := re.match(r"select (?:[\w ]*? )?<\d+ x i1> (.+?), (<[^>]*>) (.+?), (<[^>]*>) (.+)$", rhs)):
            e = f"({val(g.group(1))} ? {val(g.group(3))} : {val(g.group(5))})"
        elif (g := re.match(r"extractelement <[^>]+> (%[\w.]+), i64 (\d)", rhs)):
            e = f"{val(g.group(1))}.{SW[int(g.group(2))]}"
        elif (g := re.match(r"insertelement <[^>]+> (\S+), \w+ (\S+), i64 (\d)", rhs)):
            base = g.group(1)
            b = "" if base in ("undef", "poison") else val(base)
            e = f"ins({b}, .{SW[int(g.group(3))]}={val(g.group(2))})" if b else f"[.{SW[int(g.group(3))]}={val(g.group(2))}]"
        elif (g := re.match(r"shufflevector <[^>]+> (\S+), <[^>]+> (\S+), <\d+ x i32> (.*)$", rhs)):
            idx = re.findall(r"i32 (\d+)", g.group(3))
            if "zeroinitializer" in g.group(3):  # splat of lane 0
                idx = ["0"] * int(re.search(r"<(\d+) x i32> zeroinitializer", rhs).group(1))
            a = val(g.group(1)); b = val(g.group(2)) if g.group(2) not in ("poison", "undef") else None
            sw = "".join((SW[int(i)] if int(i) < 4 else "?") for i in idx)
            if b is None or all(int(i) < 4 for i in idx):
                e = f"{a}.{sw}" if not a.startswith("[") else f"splat{a}.{sw}"
            else:
                e = f"shuffle({a}, {b}, {idx})"
        elif (g := re.match(r"(?:tail )?call (?:fast )?(?:fastcc )?([^@]*)@([\w.$]+)\((.*)\)$", rhs)):
            callee, args = g.group(2), g.group(3)
            short = callee
            if callee.startswith("air."):
                short = re.sub(r"\.(v\d+)?(f16|f32|i32|i16|s|u|f|i1|i8|i64)\b", "", callee[4:]).replace("fast_", "")
            elif callee.startswith("_Z"):
                mm = re.match(r"_Z(?:N\d+\w+?)?(\d+)", callee)
                short = callee
                try:
                    import subprocess
                    short = subprocess.run(["c++filt", callee], capture_output=True, text=True).stdout.strip()
                    mm2 = re.search(r"([\w:~]+(?:<[^()]*>)?)\(", short)
                    short = mm2.group(1) if mm2 else short
                except Exception:
                    pass
            a = ", ".join(val(x) for x in split_args(args) if "@__air_sampler" not in x and "addrspace(2) noundef align" not in x)
            e = f"{short}({a})"
            if callee in ("air.discard_fragment",) or not lhs:
                text.append(f"  {e};")
                continue
        elif (g := re.match(r"(fptrunc|fpext|sitofp|uitofp|fptosi|fptoui|trunc|zext|sext|bitcast) [^%]*(%[\w.]+) to (.*)$", rhs)):
            e = f"({g.group(3)}){val(g.group(2))}"
        elif (g := re.match(r"extractvalue \{[^}]*\} (%[\w.]+), (\d)", rhs)):
            e = f"{val(g.group(1))}.m{g.group(2)}" if g.group(2) != "0" else val(g.group(1))
        elif (g := re.match(r"phi \S+ (.*)$", rhs)) or (g := re.match(r"phi <[^>]+> (.*)$", rhs)):
            items = re.findall(r"\[ ([^,]+(?:<[^>]*>)?[^,]*), %(\d+) \]", g.group(1))
            e = "phi(" + ", ".join(f"L{b}: {val(v)}" for v, b in items) + ")"
            text.append(f"  {lhs.replace('%', 'v')} = {e};")
            continue
        elif rhs.startswith("br "):
            if (g := re.match(r"br i1 (\S+), label %(\d+), label %(\d+)", rhs)):
                text.append(f"  if ({val(g.group(1))}) goto L{g.group(2)}; else goto L{g.group(3)};")
            else:
                text.append("  goto L" + re.search(r"%(\d+)", rhs).group(1) + ";")
            continue
        elif rhs.startswith("ret"):
            text.append(f"  return {val(rhs[4:])};" if rhs != "ret void" else "  return;")
            continue
        elif rhs.startswith("switch"):
            text.append("  " + rhs)
            continue
        else:
            e = rhs
        if lhs and uses.get(lhs, 0) <= 1 and len(e) < 160:
            expr[lhs] = e
        elif lhs:
            text.append(f"  {lhs.replace('%', 'v')} = {e};")
    out.append("\n".join(text))
print("\n".join(out))
