#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
纯 Python 的 APK 打包器 —— 不依赖 aapt2 / zipalign

为什么需要它：
  Google 只为 x86_64 发布 aapt2 / zipalign 等原生程序，而目标设备是 arm64，
  无法执行。但 javac / d8 / apksigner 都是纯 JVM 程序，与架构无关，
  所以这里用 Python 自己生成：
    · AndroidManifest.xml 的 AXML 二进制格式
    · resources.arsc 资源表
    · res/drawable 下的 PNG 图标
    · APK 的 zip 结构

用法：
  export JAVA_HOME=/tmp/android/jdk
  python3 tools/build_apk.py
"""
import os, sys, struct, zipfile, subprocess, shutil, zlib, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SDK = os.environ.get('ANDROID_SDK', '/tmp/android/sdk')
JAVA_HOME = os.environ.get('JAVA_HOME', '/tmp/android/jdk')
BT = os.path.join(SDK, 'build-tools', '34.0.0')
JAR = os.path.join(SDK, 'platforms', 'android-34', 'android.jar')
DIST = os.path.join(ROOT, 'dist')
WORK = os.path.join(ROOT, '.apkbuild')
PKG = 'com.fxkurumi.sim'
APP_NAME = 'FX战士久留美'
VERSION_CODE, VERSION_NAME = 3, '1.2.0'
OUT_APK = os.path.join(DIST, APP_NAME + '.apk')
JAVA, JAVAC = os.path.join(JAVA_HOME, 'bin', 'java'), os.path.join(JAVA_HOME, 'bin', 'javac')
D8_JAR = os.path.join(BT, 'lib', 'd8.jar')
SIGNER_JAR = os.path.join(BT, 'lib', 'apksigner.jar')

# ---------- 基础构造 ----------
def chunk(t, header_size, body):
    """通用 ResChunk。
    body  = 扩展头（header_size-8 字节）+ 负载，两者拼在一起。
    总长度 = 8（基础头）+ len(body)。
    """
    assert header_size >= 8, (t, header_size)
    assert len(body) >= header_size - 8, (t, header_size, len(body))
    total = 8 + len(body)
    return struct.pack('<HHI', t, header_size, total) + body


def align(n, a=4):
    return (a - n % a) % a


class StringPool:
    """ResStringPool，自动在 UTF-8 / UTF-16 之间择优"""
    HEADER = 28

    def __init__(self):
        self.items, self.index = [], {}

    def add(self, s):
        if s not in self.index:
            self.index[s] = len(self.items)
            self.items.append(s)
        return self.index[s]

    def build(self):
        n = len(self.items)
        enc8, enc16 = [], []

        def u8len(k):
            # Android 变长长度：>=0x80 用两字节，高位标记
            if k < 0x80:
                return bytes([k])
            return bytes([0x80 | ((k >> 8) & 0x7F), k & 0xFF])

        def u16len(k):
            if k < 0x8000:
                return struct.pack('<H', k)
            return struct.pack('<H', 0x8000 | ((k >> 16) & 0x7FFF)) + struct.pack('<H', k & 0xFFFF)

        for s in self.items:
            b8 = s.encode('utf-8')
            # UTF-8 变体需要【两个】长度前缀：UTF-16 码元数 + UTF-8 字节数
            u16 = len(s.encode('utf-16-le')) // 2
            enc8.append(u8len(u16) + u8len(len(b8)) + b8 + b'\x00')
            b16 = s.encode('utf-16-le')
            k16 = len(b16) // 2
            enc16.append(u16len(k16) + b16 + b'\x00\x00')
        use8 = sum(map(len, enc8)) <= sum(map(len, enc16))
        blobs = enc8 if use8 else enc16

        offsets, cur = [], 0
        for b in blobs:
            offsets.append(cur)
            cur += len(b)
        offsets.append(cur)          # 结尾哨兵：必须比条目数多一个
        data = b''.join(blobs)
        data += b'\x00' * align(len(data))

        strings_start = self.HEADER + 4 * (n + 1)
        total = strings_start + len(data)
        flags = 0x100 if use8 else 0x000      # UTF8_FLAG
        out = struct.pack('<HHI', 0x0001, self.HEADER, total)
        out += struct.pack('<IIIII', n, 0, flags, strings_start, 0)
        out += b''.join(struct.pack('<I', o) for o in offsets)
        out += data
        return out


# ---------- PNG 图标 ----------
def make_png(w, h, pixels):
    """pixels: bytearray RGBA, len = w*h*4"""
    def chunk_bytes(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += pixels[y * w * 4:(y + 1) * w * 4]
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk_bytes(b'IHDR', ihdr)
            + chunk_bytes(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk_bytes(b'IEND', b''))


def draw_icon(size=192):
    """画一个 K 线 + 强平线的图标"""
    bg = (5, 7, 12, 255)
    px = bytearray(bytes(bg) * (size * size))

    def setpx(x, y, c):
        if 0 <= x < size and 0 <= y < size:
            i = (y * size + x) * 4
            px[i:i + 4] = bytes(c)

    def rect(x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                setpx(x, y, c)

    S = size / 108.0
    def R(x, y, w_, h_, c): rect(x * S, y * S, (x + w_) * S, (y + h_) * S, c)

    GREEN, RED, GOLD, PINK = (61, 220, 151, 255), (255, 77, 109, 255), (255, 209, 102, 255), (255, 143, 177, 255)
    # 三根 K 线（影线 + 实体）
    for (cx, ytop, ybot, y0, y1, col) in [
        (34, 50, 92, 62, 80, GREEN),
        (54, 38, 88, 46, 76, RED),
        (74, 28, 80, 34, 70, GOLD),
    ]:
        R(cx - 0.7, ytop, 1.4, ybot - ytop, col)
        R(cx - 5, y0, 10, y1 - y0, col)
    # 强平线
    R(20, 84, 68, 2, PINK)
    return px


# ---------- AXML ----------
EXT_NS = 'http://schemas.android.com/apk/res/android'
ATTR_ID = {
    'theme': 0x01010000, 'label': 0x01010001, 'icon': 0x01010002, 'name': 0x01010003,
    'exported': 0x01010010, 'launchMode': 0x0101001d, 'screenOrientation': 0x0101001e,
    'configChanges': 0x0101001f, 'windowSoftInputMode': 0x0101022b,
    'allowBackup': 0x01010280, 'hardwareAccelerated': 0x010102d3,
    'roundIcon': 0x0101052c, 'usesCleartextTraffic': 0x0101063c,
    'supportsRtl': 0x010103af,
    'versionCode': 0x0101021B,
    'versionName': 0x0101021C,
    'minSdkVersion': 0x0101020C,
    'targetSdkVersion': 0x01010270,
}


# 值类型（Res_value.dataType）
T_REFERENCE, T_STRING, T_INT_DEC, T_INT_BOOL = 0x01, 0x03, 0x10, 0x12

# 需要按类型编码的属性（其余一律按字符串处理）
BOOL_ATTRS = {'exported', 'hardwareAccelerated', 'usesCleartextTraffic', 'allowBackup', 'supportsRtl'}
INT_ATTRS = {'versionCode', 'minSdkVersion', 'targetSdkVersion'}
# 资源引用：值直接给资源 ID
REF_ATTRS = {'theme': 0x01030011}     # @android:style/Theme.Black.NoTitleBar

RES_ICON_ID = 0x7F020000              # drawable/ic_launcher


def encode_value(key, v):
    """返回 (rawValue 字符串或 None, dataType, data)"""
    if key in REF_ATTRS:
        return None, T_REFERENCE, REF_ATTRS[key]
    if key in ('icon', 'roundIcon'):
        return None, T_REFERENCE, RES_ICON_ID
    if key in BOOL_ATTRS:
        # 用 INT_DEC 而非 INT_BOOLEAN：兼容性最好，apksigner 也能正确读取
        return v, T_INT_DEC, (1 if v == 'true' else 0)
    if key in INT_ATTRS:
        return v, T_INT_DEC, int(v)
    return v, T_STRING, None      # data 稍后填字符串索引


def build_axml(root):
    """root = (tag, [(attr_key|None, value)], [children])"""
    pool = StringPool()
    ns_idx = pool.add(EXT_NS)
    prefix_idx = pool.add('android')
    name_idx = {k: pool.add(k) for k in ATTR_ID}

    # 1) 先把所有字符串入池，顺序确定
    def collect(node):
        tag, attrs, kids = node
        pool.add(tag)
        for k, v in attrs:
            raw, dt, _ = encode_value(k, v)
            if raw is not None:
                pool.add(raw)
        for c in kids:
            collect(c)
    collect(root)

    # 2) 生成元素流
    body = bytearray()

    def emit(node):
        tag, attrs, kids = node
        tag_i = pool.index[tag]
        attr_datas = []
        for k, v in attrs:
            raw, dt, data = encode_value(k, v)
            raw_i = pool.index[raw] if raw is not None else 0xFFFFFFFF
            if dt == T_STRING:
                data = pool.index[v]
            nm_i = name_idx[k] if k is not None else pool.add(v)
            ns_i = ns_idx if k is not None else 0xFFFFFFFF
            attr_datas.append((ns_i, nm_i, raw_i, dt, data))
        ext = struct.pack('<IIHHHHHH', 0xFFFFFFFF, tag_i, 20, 20, len(attr_datas), 0, 0, 0)
        for ns_i, nm_i, raw_i, dt, data in attr_datas:
            ext += struct.pack('<III', ns_i, nm_i, raw_i)
            ext += struct.pack('<HBBI', 8, 0, dt, data & 0xFFFFFFFF)
        node_hdr = struct.pack('<II', 0, 0xFFFFFFFF)      # lineNumber, comment
        body.extend(chunk(0x0102, 16, node_hdr + ext))
        for c in kids:
            emit(c)
        body.extend(chunk(0x0103, 16, node_hdr + struct.pack('<II', 0xFFFFFFFF, tag_i)))

    emit(root)

    ns_pool = pool.build()
    res_map = chunk(0x0180, 8, b'')
    return chunk(0x0003, 8, ns_pool + res_map + bytes(body))


def manifest_axml():
    perms = [('uses-permission', [('name', 'android.permission.INTERNET')], []),
             ('uses-permission', [('name', 'android.permission.ACCESS_NETWORK_STATE')], []),
             ('uses-permission', [('name', 'android.permission.VIBRATE')], [])]
    intent = ('intent-filter', [], [
        ('action', [('name', 'android.intent.action.MAIN')], []),
        ('category', [('name', 'android.intent.category.LAUNCHER')], []),
    ])
    activity = ('activity', [
        ('name', PKG + '.MainActivity'),
        ('exported', 'true'),
        ('screenOrientation', 'portrait'),
        ('launchMode', 'singleTask'),
        ('configChanges', 'orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize|uiMode|density'),
        ('windowSoftInputMode', 'adjustResize'),
    ], [intent])
    application = ('application', [
        ('label', APP_NAME),
        ('hardwareAccelerated', 'true'),
        ('usesCleartextTraffic', 'true'),
        ('allowBackup', 'true'),
        ('supportsRtl', 'false'),
        ('theme', '@android:style/Theme.Black.NoTitleBar'),
    ], [activity])
    root = ('manifest', [
        ('versionCode', str(VERSION_CODE)),
        ('versionName', VERSION_NAME),
    ], [('uses-sdk', [('minSdkVersion', '21'), ('targetSdkVersion', '34')], [])] + perms + [application])
    return build_axml(root)


# ---------- resources.arsc ----------
def build_arsc():
    """单包、两个类型（string / drawable），足够支撑 label 与 icon"""
    TYPE_STRING, TYPE_DRAWABLE = 1, 2

    # 全局值池（字符串引用的目标）
    vpool = StringPool()
    v_app = vpool.add(APP_NAME)
    v_icon = vpool.add('res/drawable/ic_launcher.png')

    # key 池（条目名）
    kpool = StringPool()
    k_icon = kpool.add('ic_launcher')
    k_name = kpool.add('app_name')

    # type 名池
    tpool = StringPool()
    tpool.add('string')      # typeId 1
    tpool.add('drawable')    # typeId 2

    # ResTable_config: size(4) mcc(2) mnc(2) language(2) country(2) orientation(1)
    #   touchscreen(1) density(2) keyboard(1) navigation(1) inputFlags(1) inputPad0(1)
    #   screenWidth(2) screenHeight(2) sdkVersion(2) minorVersion(2) = 28 字节
    CFG = struct.pack('<IHH2s2sBBHBBBBHHHH',
                      28, 0, 0, b'\x00\x00', b'\x00\x00',
                      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    assert len(CFG) == 28, len(CFG)

    def res_value(dt, dv):
        return struct.pack('<HBBI', 8, 0, dt, dv)

    def type_spec(tid, n):
        ext = struct.pack('<BBHI', tid, 0, n, 0)          # 8 字节扩展头
        return chunk(0x0202, 16, ext)

    def type_chunk(tid, entries):
        """entries: [(key_idx, value_bytes)]"""
        n = len(entries)
        offs, items, cur = [], b'', 0
        for key_i, rv in entries:
            offs.append(cur)
            items += struct.pack('<HHI', 8, 0, key_i) + rv    # ResTable_entry + Res_value
            cur += 8 + len(rv)
        # ResTable_type 扩展头：id(1) flags(1) reserved(2) entryCount(4) entriesStart(4) config(28)
        ext_size = 1 + 1 + 2 + 4 + 4 + len(CFG)
        entries_start = ext_size + 4 * n                 # 相对 Type chunk 起始
        head_body = (struct.pack('<BBH', tid, 0, 0) + struct.pack('<I', n)
                     + struct.pack('<I', entries_start) + CFG)
        assert len(head_body) == ext_size, (len(head_body), ext_size)
        body = head_body + b''.join(struct.pack('<I', o) for o in offs) + items
        return chunk(0x0201, 8 + ext_size, body)

    spec1, type1 = type_spec(TYPE_STRING, 1), type_chunk(TYPE_STRING, [(k_name, res_value(3, v_app))])
    spec2, type2 = type_spec(TYPE_DRAWABLE, 1), type_chunk(TYPE_DRAWABLE, [(k_icon, res_value(3, v_icon))])

    type_pool_bytes = tpool.build()
    key_pool_bytes = kpool.build()

    PKG_HEADER = 288
    pkg_name16 = PKG.encode('utf-16-le') + b'\x00\x00'
    pkg_name_block = pkg_name16 + b'\x00' * align(len(pkg_name16))

    # 包内布局（AOSP ResTable::parsePackage 的硬性约定）：
    #   header(288) | typeOffsets[typeCount] | typeStrings | keyStrings | 包名 | spec1,type1,spec2,type2
    # 注意：typeOffsets[] 必须紧跟在 288 字节包头之后；
    #       且每个 typeOffsets[i] 指向 ResTable_typeSpec，对应的 ResTable_type 紧跟在该 spec 之后。
    TYPE_COUNT = 2
    offs_start = PKG_HEADER
    type_strings_off = offs_start + 4 * TYPE_COUNT
    key_strings_off = type_strings_off + len(type_pool_bytes)
    name_off = key_strings_off + len(key_pool_bytes)
    chunks_start = name_off + len(pkg_name_block)
    off_t1 = chunks_start
    off_t2 = chunks_start + len(spec1) + len(type1)

    pkg_body = (struct.pack('<I', off_t1) + struct.pack('<I', off_t2)
                + type_pool_bytes + key_pool_bytes + pkg_name_block
                + spec1 + type1 + spec2 + type2)
    total = PKG_HEADER + len(pkg_body)

    name_field = pkg_name16[:254]
    name_field += b'\x00' * (256 - len(name_field))

    hdr = struct.pack('<HHI', 0x0200, PKG_HEADER, total)
    hdr += struct.pack('<I', 0x7f)
    hdr += name_field
    hdr += struct.pack('<I', type_strings_off)
    hdr += struct.pack('<I', 2)
    hdr += struct.pack('<I', key_strings_off)
    hdr += struct.pack('<I', 2)
    hdr += struct.pack('<I', 0)
    # 注意：typeIdOffset 已在 pkg_body 开头写入，这里保持不变
    assert len(hdr) == PKG_HEADER, len(hdr)

    package = hdr + pkg_body
    vpool_bytes = vpool.build()
    table_total = 12 + len(vpool_bytes) + len(package)
    table = struct.pack('<HHI', 0x0002, 12, table_total) + struct.pack('<I', 1)
    return table + vpool_bytes + package


# ---------- 打包流程 ----------
def run(cmd, what):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print('\n[%s 失败]' % what)
        print(r.stdout)
        print(r.stderr)
        raise SystemExit(1)
    return r


def prepare_assets():
    adir = os.path.join(WORK, 'assets')
    shutil.rmtree(adir, ignore_errors=True)
    os.makedirs(adir)
    src = os.path.join(DIST, 'index.html')
    if not os.path.exists(src):
        raise SystemExit('找不到 dist/index.html，请先运行 node build.js')
    shutil.copy(src, os.path.join(adir, 'index.html'))
    return os.path.getsize(os.path.join(adir, 'index.html'))


def compile_dex():
    classes = os.path.join(WORK, 'classes')
    shutil.rmtree(classes, ignore_errors=True)
    os.makedirs(classes)
    srcs = []
    for dp, _, fs in os.walk(os.path.join(ROOT, 'android', 'java')):
        srcs += [os.path.join(dp, f) for f in fs if f.endswith('.java')]
    run([JAVAC, '-encoding', 'UTF-8', '-source', '8', '-target', '8',
         '-bootclasspath', JAR, '-classpath', JAR, '-d', classes] + srcs, 'javac')
    dex = os.path.join(WORK, 'dex')
    shutil.rmtree(dex, ignore_errors=True)
    os.makedirs(dex)
    clss = []
    for dp, _, fs in os.walk(classes):
        clss += [os.path.join(dp, f) for f in fs if f.endswith('.class')]
    run([JAVA, '-cp', D8_JAR, 'com.android.tools.r8.D8',
         '--min-api', '21', '--lib', JAR, '--output', dex] + clss, 'd8')
    return os.path.join(dex, 'classes.dex')


def assemble(manifest, arsc, dex_path, html_bytes, icon_png):
    tmp = os.path.join(WORK, 'unsigned.apk')
    if os.path.exists(tmp):
        os.remove(tmp)
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('AndroidManifest.xml', manifest, zipfile.ZIP_DEFLATED)
        # 无 resources.arsc：清单只引用系统资源，APK 依然完全合法
        pass
        z.writestr('classes.dex', open(dex_path, 'rb').read(), zipfile.ZIP_DEFLATED)
        z.writestr('assets/index.html', html_bytes, zipfile.ZIP_DEFLATED)
        pass
    return tmp


def sign(unsigned):
    ks = os.path.join(ROOT, 'android', 'debug.keystore')
    if not os.path.exists(ks):
        raise SystemExit('缺少 keystore，请先运行 node tools/make-keystore.js')
    if os.path.exists(OUT_APK):
        os.remove(OUT_APK)
    run([JAVA, '-cp', SIGNER_JAR, 'com.android.apksigner.ApkSignerTool', 'sign',
         '--ks', ks, '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
         '--ks-key-alias', 'fxkurumi',
         '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
         '--out', OUT_APK, unsigned], 'apksigner')


def main():
    print('=== 打包 APK ===')
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(DIST, exist_ok=True)

    print('1/6 准备 assets')
    size = prepare_assets()
    print('     assets/index.html  %.1f KB' % (size / 1024))

    print('2/6 生成图标')
    icon = make_png(192, 192, draw_icon(192))
    print('     icon %d B' % len(icon))

    print('3/6 编译 Java → dex')
    dex = compile_dex()
    print('     classes.dex %.1f KB' % (os.path.getsize(dex) / 1024))

    print('4/6 生成 AndroidManifest.xml / resources.arsc')
    man = manifest_axml()
    arsc = build_arsc()
    print('     manifest %d B   arsc %d B' % (len(man), len(arsc)))

    print('5/6 组装 APK')
    unsigned = assemble(man, arsc, dex, open(os.path.join(DIST, 'index.html'), 'rb').read(), icon)

    print('6/6 签名')
    sign(unsigned)

    kb = os.path.getsize(OUT_APK) / 1024
    print('\n✓ 完成：%s  (%.1f KB)' % (OUT_APK, kb))


if __name__ == '__main__':
    main()
