# 怎么分享给朋友玩

有两种形态，都已经打包好，放在手机的 **`Download/`** 目录里：

| 文件 | 说明 | 适合 |
|---|---|---|
| `FX战士久留美.apk` | 安卓应用（92 KB） | **推荐**。直接安装，全屏无地址栏，有独立图标 |
| `FX战士久留美(网页版).html` | 单文件网页（239 KB） | 发文件给朋友，用浏览器打开 |

---

## 方式一：APK（推荐）

### 自己安装
1. 打开手机「文件管理」→ **Download**
2. 点 `FX战士久留美.apk`
3. 系统提示「未知来源应用」→ 允许安装

> 首次装第三方 APK 时，Android 会要求允许「安装未知应用」。
> 路径：设置 → 应用 → 特殊权限 → 安装未知应用 → 选你用的文件管理器 → 允许

### 发给朋友
把 `FX战士久留美.apk` 通过微信 / QQ 发过去，对方：
1. 点开文件 → 右上角 **⋯** → **用其他应用打开** → 选「软件包安装程序」
2. 或先保存到手机，再从文件管理器点开

---

## 方式二：网页版

`FX战士久留美(网页版).html` 是**完全自包含**的——图形、音效、剧情、数据全在里面，
不需要服务器、不需要网络。

### 发给朋友
直接传文件。对方收到后：

⚠️ **微信里直接点开可能被拦截**，让对方：
1. 点右上角 **⋯** → **用其他应用打开** → 选「浏览器」
2. 或保存后用文件管理器找到它 → 用浏览器打开

### 变成桌面 App
浏览器里打开后：菜单 → **添加到主屏幕**，之后就能像 App 一样全屏启动。

### 托管成网页（最省事）
把 `index.html` 传到任意静态托管，把链接发朋友：
- **GitHub Pages** — 新建仓库上传，Settings → Pages 开启
- **Cloudflare Pages / Vercel / Netlify** — 拖拽上传，都有免费额度

---

## 两个版本的区别

| | APK | 网页版 |
|---|---|---|
| 安装 | 需要允许未知来源 | 不需要 |
| 全屏无地址栏 | ✅ 原生 | 需「添加到主屏幕」 |
| 独立图标 | ✅ | 需「添加到主屏幕」 |
| **AI 功能跨域限制** | ✅ **无限制** | ⚠️ 部分服务商会拦截 |
| 更新 | 重新装 APK | 换个文件即可 |

**重要**：APK 版通过原生层发 AI 请求，**完全绕过 WebView 的跨域限制**。
要用 AI 交易员功能的话，APK 版体验明显更好。

---

## 关于 AI 功能的 API Key

如果让朋友用 AI 交易员，**请转告他们**：

1. Key 保存在**各自手机本地**，不会上传到任何服务器
2. 请求从他们手机**直接发往**他们自己填的接口地址
3. **不要用主账号 Key**，单独申请一个设了额度上限的 Key
4. 每次 AI 思考都消耗额度，嫌吵可以随时在界面上暂停她

游戏本身不含任何 Key，每个人填自己的。

---

## 重新打包

```sh
# 网页版
node build.js                    # → dist/index.html

# APK
export JAVA_HOME=/tmp/android/jdk
python3 tools/build_apk.py       # → dist/FX战士久留美.apk
```

### APK 是怎么打出来的（技术说明）

Android 官方的 `aapt2` / `zipalign` **只提供 x86_64 版本**，而这台设备是 arm64，无法执行。
所以这个项目的 APK 由 `tools/build_apk.py` **用纯 Python 手工打包**：

| 步骤 | 工具 | 说明 |
|---|---|---|
| Java → dex | `javac` + `d8` | 纯 JVM，与架构无关 |
| AndroidManifest.xml | 自己写的 AXML 编码器 | 二进制 XML，含变长 UTF-8 双长度前缀 |
| 打包 | `zipfile` | 标准 zip 结构 |
| 签名 | `apksigner` | 纯 JVM，v1 + v2 + v3 |

`aapt2` 缺位意味着**不能用自定义图标和资源**（APK 显示系统默认图标）。
这是当前环境的技术限制，不影响功能。

### 签名信息

```
CN=FX Kurumi Simulator, O=FX Kurumi Fan Project, C=JP
v1 (JAR signing):              ✅
v2 (APK Signature Scheme v2):  ✅
v3 (APK Signature Scheme v3):  ✅
```

这是 **debug 自签名证书**，仅供自己和朋友安装，不能上架应用商店。
keystore 在 `android/debug.keystore`（口令 `android`）。

### 已验证

- 清单可被 `apkanalyzer` 正确解析（包名、权限、minSdk 21 / targetSdk 34）
- 签名通过 `apksigner verify --print-certs`
- dex 含 179 个类/方法
- APK 内嵌的 `assets/index.html` 与 `dist/index.html` **逐字节一致**
