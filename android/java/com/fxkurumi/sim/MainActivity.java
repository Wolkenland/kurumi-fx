package com.fxkurumi.sim;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * FX战士久留美 · 交易模拟器 —— 单 Activity 外壳
 *
 * 用本地 file:///android_asset/index.html 加载整个游戏（单文件、离线可用）。
 * 同时注入 AndroidAI 桥接：由原生层发 HTTP 请求，
 * 绕开 WebView 对第三方 API 的 CORS 限制。
 */
public class MainActivity extends Activity {

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(3);

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏沉浸
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#FF05070C"));
            getWindow().setNavigationBarColor(Color.parseColor("#FF05070C"));
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#FF05070C"));
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#FF05070C"));
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(web);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage：存档与 API 配置
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);                    // 不受系统字体缩放影响
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(true);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new NativeAI(), "AndroidAI");
        web.addJavascriptInterface(new NativeVibe(), "AndroidVibe");

        // 长按不选词（游戏界面不需要文本选择）
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(true);

        web.loadUrl("file:///android_asset/index.html");

        applyImmersive();
    }

    private void applyImmersive() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    public void onBackPressed() {
        // 交给页面处理返回（关抽屉 / 回相场页），页面自己决定
        web.evaluateJavascript(
                "(function(){try{var t=document.getElementById('mask');" +
                "if(t&&t.classList.contains('on')){var e=new MouseEvent('click',{bubbles:true});t.dispatchEvent(e);return 'drawer';}" +
                "if(window.__FXK__&&window.__FXK__.ui&&window.__FXK__.ui.screen!=='trade'){window.__FXK__.ui.showScreen('trade');return 'screen';}" +
                "return 'exit';}catch(e){return 'exit';}})()",
                new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value != null && value.contains("exit")) finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ============================================================
     * 原生 HTTP 桥接：绕过 WebView 的 CORS 限制
     * 只在用户显式点「测试连接」或 AI 思考时被调用。
     * 请求从本机直接发往用户自己填写的接口地址。
     * ============================================================ */
    private class NativeAI {

        @JavascriptInterface
        public void httpPost(final String id, final String urlStr,
                             final String headersJson, final String body) {
            pool.execute(new Runnable() {
              @Override
              public void run() {
                int status = 0;
                String text = "";
                boolean ok = false;
                HttpURLConnection conn = null;
                try {
                    URL url = new URL(urlStr);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(45000);
                    conn.setDoOutput(true);
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setRequestProperty("Accept", "application/json");

                    // 解析简单的 {"k":"v"} 头
                    for (String kv : parseFlatJson(headersJson)) {
                        int i = kv.indexOf('\u0000');
                        if (i > 0) conn.setRequestProperty(kv.substring(0, i), kv.substring(i + 1));
                    }

                    OutputStream os = conn.getOutputStream();
                    try {
                        os.write(body.getBytes(Charset.forName("UTF-8")));
                        os.flush();
                    } finally {
                        try { os.close(); } catch (Exception ignored) {}
                    }

                    status = conn.getResponseCode();
                    InputStream is = (status >= 200 && status < 300)
                            ? conn.getInputStream() : conn.getErrorStream();
                    text = readAll(is);
                    ok = (status >= 200 && status < 300);
                } catch (Exception e) {
                    text = "{\"error\":{\"message\":\"" + esc(e.getMessage()) + "\"}}";
                    ok = false;
                } finally {
                    if (conn != null) conn.disconnect();
                }
                final String fText = text;
                final int fStatus = status;
                final boolean fOk = ok;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (web != null) {
                            web.evaluateJavascript(
                                    "window.__AI_HTTP_RESOLVE(" + jsStr(id) + "," + fOk + ","
                                            + fStatus + "," + jsStr(fText) + ")", null);
                        }
                    }
                });
              }
            });
        }
    }

    /* ---------------- 震动桥接（WebView 的 navigator.vibrate 在部分机型无效） ---------------- */
    private class NativeVibe {
        @JavascriptInterface
        public void buzz(String pattern) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (pattern == null || pattern.isEmpty()) return;
                String[] parts = pattern.split(",");
                if (parts.length <= 1) {
                    long ms = Long.parseLong(parts[0].trim());
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        v.vibrate(ms);
                    }
                } else {
                    long[] pat = new long[parts.length];
                    for (int i = 0; i < parts.length; i++) pat[i] = Long.parseLong(parts[i].trim());
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createWaveform(pat, -1));
                    } else {
                        v.vibrate(pat, -1);
                    }
                }
            } catch (Exception ignored) {
            }
        }
    }

    /* ---------------- 小工具 ---------------- */

    private static String readAll(InputStream is) {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        BufferedReader r = null;
        try {
            r = new BufferedReader(new InputStreamReader(is, Charset.forName("UTF-8")));
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
        } catch (Exception ignored) {
        } finally {
            try { if (r != null) r.close(); } catch (Exception ignored) {}
        }
        return sb.toString();
    }

    /** 把 JSON 字符串转义成 JS 字符串字面量 */
    private static String jsStr(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append("\"").toString();
    }

    private static String esc(String s) {
        if (s == null) return "unknown";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }

    /** 极简 {"k":"v",...} 解析，返回 ["k\0v", ...] */
    private static java.util.List<String> parseFlatJson(String json) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (json == null) return out;
        int i = json.indexOf('{');
        int end = json.lastIndexOf('}');
        if (i < 0 || end <= i) return out;
        String inner = json.substring(i + 1, end);
        // 按逗号切分（header 值里不会有逗号）
        int p = 0;
        boolean inStr = false;
        StringBuilder cur = new StringBuilder();
        java.util.List<String> segs = new java.util.ArrayList<>();
        for (int k = 0; k < inner.length(); k++) {
            char c = inner.charAt(k);
            if (c == '"') inStr = !inStr;
            if (c == ',' && !inStr) { segs.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        if (cur.length() > 0) segs.add(cur.toString());
        for (String seg : segs) {
            int c = seg.indexOf(':');
            if (c < 0) continue;
            String k = seg.substring(0, c).trim().replace("\"", "");
            String v = seg.substring(c + 1).trim().replace("\"", "");
            if (!k.isEmpty()) out.add(k + "\u0000" + v);
        }
        return out;
    }
}
