package com.inspireacademy.quiz;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Semaphore;

/** Serves the bundled academy pages on 127.0.0.1 so storage and sign-in work offline. */
public class AssetServer extends Thread {
    public final Semaphore ready = new Semaphore(0);
    public volatile int port = -1;
    private final Context ctx;
    private volatile ServerSocket socket;

    public AssetServer(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        setDaemon(true);
    }

    @Override
    public void run() {
        try {
            socket = new ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"));
            port = socket.getLocalPort();
            ready.release();
            while (!socket.isClosed()) {
                final Socket client = socket.accept();
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        handle(client);
                    }
                }, "inspire-http").start();
            }
        } catch (IOException ignored) {
            ready.release();
        }
    }

    public void stopServer() {
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
    }

    private void handle(Socket client) {
        try {
            client.setSoTimeout(8000);
            InputStream in = client.getInputStream();
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            while (head.size() < 8192) {
                int b = in.read();
                if (b < 0) break;
                head.write(b);
                String sofar = head.toString("ISO-8859-1");
                if (sofar.contains("\r\n\r\n") || sofar.endsWith("\n\n")) break;
            }
            String req = head.toString("ISO-8859-1");
            String line = req.split("\r\n|\n", 2)[0];
            String[] parts = line.split(" ");
            String path = parts.length >= 2 ? parts[1] : "/";
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            try {
                path = URLDecoder.decode(path, "UTF-8");
            } catch (Exception ignored) {
            }
            if (path.contains("..") || path.indexOf('\0') >= 0) {
                write(client, 403, "text/plain; charset=utf-8", "Forbidden".getBytes(StandardCharsets.UTF_8));
                return;
            }
            if ("/".equals(path)) path = "/index.html";
            if (!path.startsWith("/")) path = "/" + path;
            byte[] data;
            try (InputStream body = ctx.getAssets().open("www" + path)) {
                data = readAll(body);
            } catch (IOException missing) {
                write(client, 404, "text/plain; charset=utf-8", "Not found".getBytes(StandardCharsets.UTF_8));
                return;
            }
            write(client, 200, mime(path), data);
        } catch (Exception ignored) {
        } finally {
            try {
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static void write(Socket client, int code, String mime, byte[] data) throws IOException {
        String status = code == 200 ? "OK" : code == 404 ? "Not Found" : "Forbidden";
        String hdr = "HTTP/1.1 " + code + " " + status + "\r\n"
                + "Content-Type: " + mime + "\r\n"
                + "Content-Length: " + data.length + "\r\n"
                + "Connection: close\r\n"
                + "Cache-Control: no-store\r\n\r\n";
        OutputStream out = client.getOutputStream();
        out.write(hdr.getBytes(StandardCharsets.US_ASCII));
        out.write(data);
        out.flush();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) >= 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
