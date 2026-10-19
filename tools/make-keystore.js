#!/usr/bin/env node
/**
 * 生成 Android debug 签名用的 keystore。
 *
 * 优先调用 JDK 自带的 keytool（最可靠）。
 * 如果找不到 keytool，退回到纯 Node 的 PKCS#12 实现。
 *
 * 这是 debug 用途的自签名证书，仅供自己和朋友安装，不能上架应用商店。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(__dirname, '..', 'android', 'debug.keystore');
const PASSWORD = 'android';
const ALIAS = 'fxkurumi';

function findKeytool() {
  const cands = [];
  if (process.env.JAVA_HOME) cands.push(path.join(process.env.JAVA_HOME, 'bin', 'keytool'));
  cands.push('/tmp/android/jdk/bin/keytool', '/root/android-build/jdk/bin/keytool');
  for (const c of cands) if (fs.existsSync(c)) return c;
  // PATH 里找
  try {
    const p = execFileSync('sh', ['-c', 'command -v keytool'], { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch (e) {}
  return null;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (fs.existsSync(OUT)) {
  console.log('· keystore 已存在，跳过生成：' + OUT);
  process.exit(0);
}

const keytool = findKeytool();
if (keytool) {
  console.log('→ 使用 keytool 生成 keystore：' + keytool);
  execFileSync(keytool, [
    '-genkeypair',
    '-keystore', OUT,
    '-storetype', 'PKCS12',
    '-alias', ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10950',
    '-storepass', PASSWORD,
    '-keypass', PASSWORD,
    '-dname', 'CN=FX Kurumi Simulator, O=FX Kurumi Fan Project, C=JP',
  ], { stdio: 'inherit' });
  console.log('✓ keystore 已生成：' + OUT);
  console.log('  alias=' + ALIAS + '  storepass=' + PASSWORD);
  process.exit(0);
}

/* ---------------- 纯 Node 兜底：手写 PKCS#12 ---------------- */
console.log('! 未找到 keytool，改用纯 Node 实现生成 PKCS#12');
const crypto = require('crypto');

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = []; let v = n;
  while (v > 0) { b.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (t, c) => Buffer.concat([Buffer.from([t]), derLen(c.length), c]);
const seq = (...p) => tlv(0x30, Buffer.concat(p));
const set = (...p) => tlv(0x31, Buffer.concat(p));
const octet = (b) => tlv(0x04, b);
const nullDer = () => Buffer.from([0x05, 0x00]);
const oid = (s) => {
  const p = s.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (let i = 2; i < p.length; i++) {
    let v = p[i]; const tmp = [];
    do { tmp.unshift(v & 0x7f); v >>= 7; } while (v > 0);
    for (let k = 0; k < tmp.length - 1; k++) tmp[k] |= 0x80;
    out.push(...tmp);
  }
  return tlv(0x06, Buffer.from(out));
};
const bigintDer = (buf) => {
  let b = buf;
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.slice(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
};

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});
const jwk = crypto.createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' }).export({ format: 'jwk' });
const bu = (s) => Buffer.from(s, 'base64url');

/* 自签名证书 */
const name = () => seq(
  set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from('FX Kurumi Simulator', 'utf8')))),
  set(seq(oid('2.5.4.10'), tlv(0x0c, Buffer.from('FX Kurumi Fan Project', 'utf8')))),
  set(seq(oid('2.5.4.6'), tlv(0x0c, Buffer.from('JP', 'utf8')))),
);
const now = new Date();
const nb = now.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
const na = new Date(now.getTime() + 1000 * 86400 * 10950).toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
const tbs = seq(
  tlv(0xa0, tlv(0x02, Buffer.from([2]))),
  bigintDer(crypto.randomBytes(8)),
  seq(oid('1.2.840.113549.1.1.11'), nullDer()),
  name(), name(),
  seq(tlv(0x17, Buffer.from(nb)), tlv(0x17, Buffer.from(na))),
  name(), publicKey,
);
const sig = crypto.createSign('RSA-SHA256').update(tbs)
  .sign(crypto.createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' }));
const cert = seq(tbs, seq(oid('1.2.840.113549.1.1.11'), nullDer()), tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));

/* PKCS#12 PKCS12KDF */
function p12kdf(password, salt, iterations, id, need) {
  const u = 20, v = 64;
  const pw = Buffer.concat([Buffer.from(password, 'utf16be'), Buffer.from([0, 0])]);
  const D = Buffer.alloc(v, id);
  const S = Buffer.alloc(Math.ceil(salt.length / v) * v);
  for (let i = 0; i < S.length; i++) S[i] = salt.length ? salt[i % salt.length] : 0;
  const Pp = Buffer.alloc(Math.ceil(pw.length / v) * v);
  for (let i = 0; i < Pp.length; i++) Pp[i] = pw[i % pw.length];
  const I = Buffer.concat([S, Pp]);
  const chunks = [];
  while (chunks.length * u < need) {
    let A = crypto.createHash('sha1').update(Buffer.concat([D, I])).digest();
    for (let c = 1; c < iterations; c++) A = crypto.createHash('sha1').update(A).digest();
    chunks.push(A);
    if (chunks.length * u >= need) break;
    const B = Buffer.alloc(v);
    for (let i = 0; i < v; i++) B[i] = A[i % u];
    for (let off = 0; off + v <= I.length; off += v) {
      let carry = 1;
      for (let i = v - 1; i >= 0; i--) {
        const s = I[off + i] + B[i] + carry;
        I[off + i] = s & 0xff; carry = s >> 8;
      }
    }
  }
  return Buffer.concat(chunks).slice(0, need);
}

/* PBES2 + AES-256-CBC 包裹私钥 */
function pbes2(plain, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(16), iter = 2048;
  const key = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iter, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  const enc = seq(oid('1.2.840.113549.1.5.13'), seq(
    seq(oid('1.2.840.113549.1.5.12'), seq(octet(salt), tlv(0x02, Buffer.from([iter >> 8, iter & 0xff])),
      seq(tlv(0x02, Buffer.from([32])), nullDer()), seq(oid('1.2.840.113549.2.9'), nullDer()))),
    seq(oid('2.16.840.1.101.3.4.1.42'), octet(iv)),
  ));
  return { enc, data };
}

const localKeyId = crypto.randomBytes(20);
const friendly = (s) => tlv(0x1e, Buffer.from(s, 'utf16be'));
const sh = pbes2(privateKey, PASSWORD);
const keyBag = seq(
  oid('1.2.840.113549.1.12.10.1.2'),
  tlv(0xa0, seq(sh.enc, octet(sh.data))),
  set(seq(oid('1.2.840.113549.1.9.20'), friendly(ALIAS))),
  set(seq(oid('1.2.840.113549.1.9.21'), octet(localKeyId))),
);
const certBag = seq(
  oid('1.2.840.113549.1.12.10.1.3'),
  tlv(0xa0, seq(oid('1.2.840.113549.1.9.22'), set(seq(octet(cert))))),
  set(seq(oid('1.2.840.113549.1.9.20'), friendly(ALIAS))),
  set(seq(oid('1.2.840.113549.1.9.21'), octet(localKeyId))),
);
const safe = seq(keyBag, certBag);            // 不额外加密 SafeContents，简化实现
const authSafe = seq(seq(seq(oid('1.2.840.113549.1.7.1'), tlv(0xa0, octet(safe)))));
const macKey = p12kdf(PASSWORD, Buffer.alloc(0), 1, 3, 20);
const mac = crypto.createHash('sha1')
  .update(Buffer.concat([macKey, authSafe, Buffer.from([3, 0, 0, 0])])).digest();
const pfx = seq(tlv(0x02, Buffer.from([3])), authSafe,
  seq(seq(oid('1.3.14.3.2.26'), nullDer()), octet(mac), tlv(0x02, Buffer.from([1]))));

fs.writeFileSync(OUT, pfx);
console.log('✓ keystore 已生成（纯 Node）：' + OUT + '  ' + pfx.length + ' 字节');
console.log('  alias=' + ALIAS + '  storepass=' + PASSWORD);
