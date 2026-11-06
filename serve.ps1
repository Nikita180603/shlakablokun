$root = (Resolve-Path '.').Path
$prefix = 'http://127.0.0.1:4173/'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "listening $prefix"
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.png' = 'image/png'
  '.svg' = 'image/svg+xml'
  '.webp' = 'image/webp'
  '.ico' = 'image/x-icon'
  '.json' = 'application/json; charset=utf-8'
  '.woff2' = 'font/woff2'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class KdDb {
  const int OK = 0;
  const int ROW = 100;
  const int DONE = 101;
  static readonly IntPtr Transient = new IntPtr(-1);
  static IntPtr db;
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
  static extern int sqlite3_open16(string filename, out IntPtr db);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int sqlite3_close(IntPtr db);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int sqlite3_exec(IntPtr db, byte[] sql, IntPtr cb, IntPtr arg, out IntPtr err);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int sqlite3_bind_text(IntPtr stmt, int i, byte[] val, int n, IntPtr dtor);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int sqlite3_step(IntPtr stmt);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern IntPtr sqlite3_column_text(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int sqlite3_column_bytes(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int sqlite3_finalize(IntPtr stmt);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int sqlite3_busy_timeout(IntPtr db, int ms);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern IntPtr sqlite3_errmsg(IntPtr db);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern void sqlite3_free(IntPtr p);
  static byte[] Z(string s) {
    byte[] raw = Encoding.UTF8.GetBytes(s ?? "");
    byte[] z = new byte[raw.Length + 1];
    Buffer.BlockCopy(raw, 0, z, 0, raw.Length);
    return z;
  }
  static string Col(IntPtr stmt, int i) {
    IntPtr p = sqlite3_column_text(stmt, i);
    if (p == IntPtr.Zero) return "";
    int n = sqlite3_column_bytes(stmt, i);
    byte[] buf = new byte[n];
    Marshal.Copy(p, buf, 0, n);
    return Encoding.UTF8.GetString(buf);
  }
  static void Check(int rc, string what) {
    if (rc == OK || rc == ROW || rc == DONE) return;
    IntPtr p = sqlite3_errmsg(db);
    string msg = p == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(p);
    throw new Exception(what + " " + rc + " " + msg);
  }
  static void Exec(string sql) {
    IntPtr err;
    int rc = sqlite3_exec(db, Z(sql), IntPtr.Zero, IntPtr.Zero, out err);
    if (rc != OK) {
      string msg = err == IntPtr.Zero ? ("sqlite " + rc) : ColPtr(err);
      if (err != IntPtr.Zero) sqlite3_free(err);
      throw new Exception(msg);
    }
  }
  static string ColPtr(IntPtr p) {
    int n = 0;
    while (Marshal.ReadByte(p, n) != 0) n++;
    byte[] buf = new byte[n];
    Marshal.Copy(p, buf, 0, n);
    return Encoding.UTF8.GetString(buf);
  }
  static IntPtr Prepare(string sql) {
    IntPtr stmt;
    int rc = sqlite3_prepare_v2(db, Z(sql), -1, out stmt, IntPtr.Zero);
    Check(rc, "prepare");
    return stmt;
  }
  static void Bind(IntPtr stmt, int i, string value) {
    byte[] val = Z(value);
    Check(sqlite3_bind_text(stmt, i, val, val.Length - 1, Transient), "bind");
  }
  public static void Open(string path) {
    int rc = sqlite3_open16(path, out db);
    if (rc != OK) throw new Exception("open " + rc);
    sqlite3_busy_timeout(db, 3000);
    Exec("PRAGMA journal_mode=WAL;");
    Exec("CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);");
    Exec("CREATE TABLE IF NOT EXISTS leads (n TEXT PRIMARY KEY, created TEXT NOT NULL, json TEXT NOT NULL);");
  }
  public static string LoadStore() {
    IntPtr stmt = Prepare("SELECT json FROM store WHERE id = 1");
    string json = "";
    if (sqlite3_step(stmt) == ROW) json = Col(stmt, 0);
    sqlite3_finalize(stmt);
    return json;
  }
  public static void SaveStore(string json) {
    IntPtr stmt = Prepare("INSERT INTO store(id, json) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET json = excluded.json");
    Bind(stmt, 1, json);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    Check(rc, "store");
  }
  public static void SaveLead(string n, string created, string json) {
    IntPtr stmt = Prepare("INSERT INTO leads(n, created, json) VALUES (?1, ?2, ?3) ON CONFLICT(n) DO UPDATE SET created = excluded.created, json = excluded.json");
    Bind(stmt, 1, n);
    Bind(stmt, 2, created);
    Bind(stmt, 3, json);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    Check(rc, "lead");
  }
  public static string LoadLeads() {
    IntPtr stmt = Prepare("SELECT json FROM leads ORDER BY created, n");
    StringBuilder sb = new StringBuilder();
    sb.Append('[');
    bool first = true;
    while (sqlite3_step(stmt) == ROW) {
      if (!first) sb.Append(',');
      first = false;
      sb.Append(Col(stmt, 0));
    }
    sqlite3_finalize(stmt);
    sb.Append(']');
    return sb.ToString();
  }
}
'@

function Read-AllBytes([IO.Stream]$stream) {
  $ms = New-Object IO.MemoryStream
  $buf = New-Object byte[] 8192
  while (($n = $stream.Read($buf, 0, $buf.Length)) -gt 0) { $ms.Write($buf, 0, $n) }
  return $ms.ToArray()
}

function Send-Bytes($ctx, [int]$code, [byte[]]$bytes, [string]$type) {
  $ctx.Response.StatusCode = $code
  if ($type) { $ctx.Response.ContentType = $type }
  $ctx.Response.ContentLength64 = $bytes.Length
  if ($bytes.Length) { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
  $ctx.Response.Close()
}

function Send-Text($ctx, [int]$code, [string]$text, [string]$type) {
  Send-Bytes $ctx $code ([Text.Encoding]::UTF8.GetBytes([string]$text)) $type
}

function Safe-Id([string]$id) {
  if ($id -and $id -match '^[a-z0-9]+(-[a-z0-9]+)*$') { return $id }
  return $null
}

function Write-AdminJs([string]$json) {
  $dir = Join-Path $root 'data'
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $safe = $json.Replace('<', '\u003c')
  $text = "window.KD_ADMIN_FILE = $safe;`n"
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText((Join-Path $dir 'admin.js'), $text, $utf8)
}

$dataDir = Join-Path $root 'data'
if (-not (Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
[KdDb]::Open((Join-Path $dataDir 'shop.db'))
$stored = [KdDb]::LoadStore()
if (-not $stored) {
  $stored = '{"products":{},"site":null,"copy":{},"banner":null,"photos":[]}'
  $jsPath = Join-Path $dataDir 'admin.js'
  if (Test-Path -LiteralPath $jsPath) {
    $text = [IO.File]::ReadAllText($jsPath, [Text.Encoding]::UTF8)
    $match = [regex]::Match($text, 'KD_ADMIN_FILE\s*=\s*(\{.*\})\s*;', [Text.RegularExpressions.RegexOptions]::Singleline)
    if ($match.Success) { $stored = $match.Groups[1].Value }
  }
  [KdDb]::SaveStore($stored)
}
Write-AdminJs $stored
Write-Output "sqlite data\shop.db"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq 'api/admin' -and $ctx.Request.HttpMethod -eq 'GET') {
      Send-Text $ctx 200 ([KdDb]::LoadStore()) 'application/json; charset=utf-8'
      continue
    }
    if ($rel -eq 'api/admin' -and $ctx.Request.HttpMethod -eq 'POST') {
      $raw = [Text.Encoding]::UTF8.GetString((Read-AllBytes $ctx.Request.InputStream))
      if ($raw.Length -gt 2000000) { Send-Text $ctx 413 'too big' 'text/plain'; continue }
      $null = $raw | ConvertFrom-Json
      [KdDb]::SaveStore($raw)
      Write-AdminJs $raw
      Send-Bytes $ctx 204 ([byte[]]@()) 'application/json'
      continue
    }
    if ($rel -eq 'api/leads' -and $ctx.Request.HttpMethod -eq 'GET') {
      Send-Text $ctx 200 ([KdDb]::LoadLeads()) 'application/json; charset=utf-8'
      continue
    }
    if ($rel -eq 'api/leads' -and $ctx.Request.HttpMethod -eq 'POST') {
      $raw = [Text.Encoding]::UTF8.GetString((Read-AllBytes $ctx.Request.InputStream))
      if ($raw.Length -gt 200000) { Send-Text $ctx 413 'too big' 'text/plain'; continue }
      $obj = $raw | ConvertFrom-Json
      $n = [string]$obj.n
      if (-not $n -or $n.Length -gt 32 -or $n -notmatch '^[\p{L}\p{N}\-]+$') { Send-Text $ctx 400 'bad lead' 'text/plain'; continue }
      $created = [string]$obj.at
      if (-not $created) { $created = [DateTime]::UtcNow.ToString('o') }
      [KdDb]::SaveLead($n, $created, $raw)
      Send-Bytes $ctx 204 ([byte[]]@()) 'application/json'
      continue
    }
    if ($rel -eq 'api/admin-photo') {
      $id = Safe-Id ([string]$ctx.Request.QueryString['id'])
      if (-not $id) { Send-Text $ctx 400 'bad id' 'text/plain'; continue }
      $dir = Join-Path $root 'img\custom'
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
      $file = Join-Path $dir ($id + '.jpg')
      if ($ctx.Request.HttpMethod -eq 'DELETE') {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
        Send-Bytes $ctx 204 ([byte[]]@()) 'application/json'
        continue
      }
      if ($ctx.Request.HttpMethod -eq 'POST') {
        $bytes = Read-AllBytes $ctx.Request.InputStream
        if ($bytes.Length -gt 8000000) { Send-Text $ctx 413 'too big' 'text/plain'; continue }
        [IO.File]::WriteAllBytes($file, $bytes)
        Send-Bytes $ctx 204 ([byte[]]@()) 'application/json'
        continue
      }
    }
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
    $path = [IO.Path]::GetFullPath((Join-Path $root ($rel -replace '/','\')))
    if ($path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $path -PathType Container)) {
      $path = Join-Path $path 'index.html'
    }
    if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
      Send-Text $ctx 404 '404' 'text/plain'
      continue
    }
    $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
    $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $ctx.Response.Headers['Cache-Control'] = 'no-cache'
    $bytes = [IO.File]::ReadAllBytes($path)
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
  } catch {
    Write-Output $_.Exception.Message
    try { Send-Text $ctx 500 $_.Exception.Message 'text/plain' } catch {}
  }
}
