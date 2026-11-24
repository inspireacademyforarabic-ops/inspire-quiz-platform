package com.inspireacademy.quiz;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class MainActivity extends Activity {
    private static final String PREFS = "inspire";
    private static final String LIVE_BASE = "live_base";

    private WebView web;
    private AssetServer server;
    private SharedPreferences prefs;
    private boolean showingLive;
    private long hiddenAt;

    @Override
    protected void onStop() {
        hiddenAt = System.currentTimeMillis();
        super.onStop();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (showingLive && web != null && hiddenAt > 0 && System.currentTimeMillis() - hiddenAt > 15000) {
            web.reload();
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#0B4F9C"));
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        server = new AssetServer(this);
        server.start();
        try {
            server.ready.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isInApp(uri)) return false;
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                    }
                    return true;
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && showingLive) {
                    showingLive = false;
                    loadOffline();
                }
            }
        });
        applyLiveIntent(getIntent());
        loadCurrent();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (applyLiveIntent(intent)) loadCurrent();
    }

    private boolean applyLiveIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        Uri data = intent.getData();
        if (!"inspireacademy".equals(data.getScheme()) || !"live".equals(data.getHost())) return false;
        String base = safeBase(data.getQueryParameter("base"));
        if (base == null) return false;
        prefs.edit().putString(LIVE_BASE, base).apply();
        return true;
    }

    private void loadCurrent() {
        String saved = prefs.getString(LIVE_BASE, "");
        String base = safeBase(saved);
        if (base == null) {
            if (saved != null && saved.length() > 0) prefs.edit().remove(LIVE_BASE).apply();
            showingLive = false;
            loadOffline();
            return;
        }
        if (!base.equals(saved)) prefs.edit().putString(LIVE_BASE, base).apply();
        showingLive = true;
        web.loadUrl(base + "/");
    }

    private void loadOffline() {
        if (server != null && server.port > 0) {
            web.loadUrl("http://127.0.0.1:" + server.port + "/");
        }
    }

    private boolean isInApp(Uri uri) {
        if (uri == null) return false;
        String host = uri.getHost();
        if ("127.0.0.1".equals(host) || "localhost".equals(host)) return true;
        String base = prefs.getString(LIVE_BASE, "");
        if (base == null || base.length() == 0) return false;
        Uri live = Uri.parse(base);
        return host != null && host.equalsIgnoreCase(live.getHost()) && "https".equals(uri.getScheme());
    }

    static String safeBase(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (!value.startsWith("https://") || value.contains("@") || value.contains("\\") || value.contains(" ")) {
            return null;
        }
        Uri uri = Uri.parse(value);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) return null;
        String host = uri.getHost().toLowerCase();
        if (host.length() == 0 || host.indexOf('.') < 0 || isPrivateHost(host)) return null;
        String path = uri.getPath() == null ? "" : uri.getPath();
        if (path.contains("..")) return null;
        while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        int port = uri.getPort();
        String authority = port > 0 ? host + ":" + port : host;
        return "https://" + authority + path;
    }

    static boolean isPrivateHost(String host) {
        if ("localhost".equals(host) || "127.0.0.1".equals(host)) return true;
        if (host.endsWith(".grok-sandbox.com")) return true;
        return "preview.grok.mil".equals(host)
                || "preview.grok.genai.mil".equals(host)
                || "preview.grokgsac.com".equals(host);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stopServer();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
