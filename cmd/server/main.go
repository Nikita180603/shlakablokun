// Сервер сайта «Каменный двор».
// Запуск из корня проекта: go run ./cmd/server
// Слушает только http://127.0.0.1:4173/ и пишет данные в data/shop.db (SQLite).
//
//	POST /api/login              проверяет логин и пароль, ставит куку kd_admin
//	POST /api/logout             снимает эту куку
//	GET  /api/session            {id, username, name, role}, если учётка ещё активна
//	GET  /api/admin              читает таблицу store, после входа менеджера или администратора
//	POST /api/admin              сохраняет каталог, тексты и баннер, после входа
//	GET  /api/leads              список заказов и заявок, после входа
//	POST /api/leads              новая заявка с витрины; смена статуса только после входа.
//	                             Статусы «Принят», «Собран» и «Отгружен» шлют письмо клиенту,
//	                             если заданы KD_SMTP_HOST, KD_SMTP_USER и KD_SMTP_PASSWORD.
//	                             Необязательно: KD_SMTP_PORT (587), KD_SMTP_FROM.
//	POST /api/admin-photo?id=    сохраняет img/custom/{id}.jpg, после входа
//	DELETE /api/admin-photo?id=  удаляет это фото, после входа
//	GET  /api/staff              список людей, только администратор
//	POST /api/staff              новый человек, только администратор
//	PUT  /api/staff?id=          имя, роль, доступ и новый пароль, только администратор
//	DELETE /api/staff?id=        удалить человека, только администратор
//
// Логин и пароль не лежат в файлах сайта. Их задают переменными KD_ADMIN_USER и
// KD_ADMIN_PASSWORD перед запуском: пароль попадает в учётку администратора,
// остальные люди остаются. Если переменных нет и учёток нет, сервер один раз
// придумывает пару и пишет её в свой лог, а в базе хранит только отпечаток.
// Остальные GET-запросы отдают файлы проекта. Сервер слушает только 127.0.0.1.
package main

import (
	"crypto/rand"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"syscall"
	"unicode/utf8"

	_ "modernc.org/sqlite"

	"github.com/andybalholm/brotli"
)

const (
	maxStoreBytes = 2_000_000
	maxLeadBytes  = 200_000
	maxPhotoBytes = 8_000_000
	emptyStore    = `{"products":{},"site":null,"copy":{},"banner":null,"photos":[]}`
)

var (
	photoID = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	leadID  = regexp.MustCompile(`^[\p{L}\p{N}\-]+$`)
	fileJS  = regexp.MustCompile(`(?s)KD_ADMIN_FILE\s*=\s*(\{.*\})\s*;`)

	sessionsMu sync.Mutex
	sessions   = map[string]session{}
	failsMu    sync.Mutex
	fails      = map[string]failState{}
)

type session struct {
	Expires time.Time
	ID      int64
}

type failState struct {
	n     int
	until time.Time
}

func main() {
	addr := os.Getenv("KD_ADDR")
	if addr == "" {
		addr = "127.0.0.1:4173"
	}
	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil {
		log.Fatal("запускай сервер из корня проекта, рядом с index.html")
	}
	db, err := openDB(filepath.Join(root, "data", "shop.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := syncStoreFile(root, db); err != nil {
		log.Fatal(err)
	}
	if err := loadAuth(db); err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if lockedOut(r) {
			http.Error(w, "later", http.StatusTooManyRequests)
			return
		}
		raw, err := readLimited(r, 8_000)
		if err != nil {
			http.Error(w, "too big", http.StatusRequestEntityTooLarge)
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if json.Unmarshal(raw, &body) != nil || body.Username == "" || body.Password == "" {
			noteFail(r)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		row, ok := loginStaff(db, body.Username, body.Password)
		if !ok {
			noteFail(r)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		clearFails(r)
		token, err := newToken()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		expires := time.Now().Add(12 * time.Hour)
		sessionsMu.Lock()
		sessions[token] = session{Expires: expires, ID: row.ID}
		sessionsMu.Unlock()
		http.SetCookie(w, &http.Cookie{
			Name:     "kd_admin",
			Value:    token,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteStrictMode,
			Expires:  expires,
		})
		writeStaffPublic(w, http.StatusOK, row)
	})
	mux.HandleFunc("/api/logout", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if c, err := r.Cookie("kd_admin"); err == nil {
			sessionsMu.Lock()
			delete(sessions, c.Value)
			sessionsMu.Unlock()
		}
		http.SetCookie(w, &http.Cookie{
			Name:     "kd_admin",
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   -1,
		})
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/api/session", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		row, ok := currentSession(db, r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		writeStaffPublic(w, http.StatusOK, row)
	})
	mux.HandleFunc("/api/admin", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if !requireAuth(db, w, r) {
				return
			}
			raw, err := loadStore(db)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, raw)
		case http.MethodPost:
			if !requireAuth(db, w, r) {
				return
			}
			raw, err := readLimited(r, maxStoreBytes)
			if err != nil {
				http.Error(w, "too big", http.StatusRequestEntityTooLarge)
				return
			}
			if !json.Valid(raw) || len(raw) == 0 || raw[0] != '{' {
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			if err := saveStore(db, string(raw)); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if err := writeAdminJS(root, string(raw)); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/leads", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if !requireAuth(db, w, r) {
				return
			}
			raw, err := loadLeads(db)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, []byte(raw))
		case http.MethodPost:
			raw, err := readLimited(r, maxLeadBytes)
			if err != nil {
				http.Error(w, "too big", http.StatusRequestEntityTooLarge)
				return
			}
			var lead struct {
				N  string `json:"n"`
				At string `json:"at"`
			}
			if json.Unmarshal(raw, &lead) != nil || !validLeadID(lead.N) {
				http.Error(w, "bad lead", http.StatusBadRequest)
				return
			}
			_, staff := currentSession(db, r)
			if !staff {
				var have int
				if err := db.QueryRow(`SELECT COUNT(*) FROM leads WHERE n = ?`, lead.N).Scan(&have); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if have > 0 {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
			}
			prev, err := loadLead(db, lead.N)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			raw, err = stampOrderMail(prev, raw, staff, time.Now(), clientIP(r), shopPhone(db), deliverMail)
			if err != nil {
				http.Error(w, "bad lead", http.StatusBadRequest)
				return
			}
			created := lead.At
			if created == "" {
				created = time.Now().UTC().Format(time.RFC3339Nano)
			}
			if err := saveLead(db, lead.N, created, string(raw)); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, raw)
		default:
			http.Error(w, "method", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/admin-photo", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		if !photoID.MatchString(id) {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		file := filepath.Join(root, "img", "custom", id+".jpg")
		switch r.Method {
		case http.MethodPost:
			if !requireAuth(db, w, r) {
				return
			}
			raw, err := readLimited(r, maxPhotoBytes)
			if err != nil {
				http.Error(w, "too big", http.StatusRequestEntityTooLarge)
				return
			}
			if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if err := os.WriteFile(file, raw, 0o644); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			if !requireAuth(db, w, r) {
				return
			}
			if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/staff", func(w http.ResponseWriter, r *http.Request) {
		handleStaff(db, w, r)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		serveStatic(root, w, r)
	})

	handler := requestLogMiddleware(compressMiddleware(mux))

	srv := &http.Server{Addr: addr, Handler: handler}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
		<-sigCh
		log.Println("shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("shutdown error: %v", err)
		}
	}()

	log.Printf("listening http://%s/ sqlite data/shop.db", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	log.Println("server stopped")
}

func openDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
		CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS leads (n TEXT PRIMARY KEY, created TEXT NOT NULL, json TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS admin_user (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, salt BLOB NOT NULL, hash BLOB NOT NULL);`); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func syncStoreFile(root string, db *sql.DB) error {
	raw, err := loadStore(db)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(raw)) == "" {
		seed := emptyStore
		file := filepath.Join(root, "data", "admin.js")
		if text, err := os.ReadFile(file); err == nil {
			if m := fileJS.FindSubmatch(text); m != nil && json.Valid(m[1]) {
				seed = string(m[1])
			}
		}
		if err := saveStore(db, seed); err != nil {
			return err
		}
		raw = []byte(seed)
	}
	return writeAdminJS(root, string(raw))
}

func loadStore(db *sql.DB) ([]byte, error) {
	var raw string
	err := db.QueryRow(`SELECT json FROM store WHERE id = 1`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []byte(raw), nil
}

func saveStore(db *sql.DB, raw string) error {
	_, err := db.Exec(`INSERT INTO store(id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`, raw)
	return err
}

func loadLeads(db *sql.DB) (string, error) {
	rows, err := db.Query(`SELECT json FROM leads ORDER BY created, n`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var b strings.Builder
	b.WriteByte('[')
	first := true
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return "", err
		}
		if !first {
			b.WriteByte(',')
		}
		first = false
		b.WriteString(raw)
	}
	b.WriteByte(']')
	return b.String(), rows.Err()
}

func loadLead(db *sql.DB, n string) ([]byte, error) {
	var raw string
	err := db.QueryRow(`SELECT json FROM leads WHERE n = ?`, n).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []byte(raw), nil
}

func shopPhone(db *sql.DB) string {
	raw, err := loadStore(db)
	if err != nil || len(raw) == 0 {
		return ""
	}
	var doc struct {
		Site *struct {
			Phone string `json:"phone"`
		} `json:"site"`
	}
	if json.Unmarshal(raw, &doc) != nil || doc.Site == nil {
		return ""
	}
	return strings.TrimSpace(doc.Site.Phone)
}

func saveLead(db *sql.DB, n, created, raw string) error {
	_, err := db.Exec(`INSERT INTO leads(n, created, json) VALUES (?, ?, ?) ON CONFLICT(n) DO UPDATE SET created = excluded.created, json = excluded.json`, n, created, raw)
	return err
}

func writeAdminJS(root, raw string) error {
	safe := strings.ReplaceAll(raw, "<", `\u003c`)
	text := "window.KD_ADMIN_FILE = " + safe + ";\n"
	return os.WriteFile(filepath.Join(root, "data", "admin.js"), []byte(text), 0o644)
}

func writeJSON(w http.ResponseWriter, code int, raw []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_, _ = w.Write(raw)
}

func readLimited(r *http.Request, max int64) ([]byte, error) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > max {
		return nil, errors.New("too big")
	}
	return raw, nil
}

func validLeadID(n string) bool {
	if n == "" || utf8.RuneCountInString(n) > 32 {
		return false
	}
	return leadID.MatchString(n)
}

func serveStatic(root string, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if rel == "" || rel == "." {
		rel = "index.html"
	}
	if hiddenFile(rel) {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(root, filepath.FromSlash(rel))
	if !inside(root, full) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if info.IsDir() {
		full = filepath.Join(full, "index.html")
		if !inside(root, full) {
			http.NotFound(w, r)
			return
		}
		info, err = os.Stat(full)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
	}
	if r.URL.RawQuery != "" {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, full)
}

func inside(root, full string) bool {
	root = filepath.Clean(root)
	full = filepath.Clean(full)
	if strings.EqualFold(full, root) {
		return true
	}
	return strings.HasPrefix(strings.ToLower(full), strings.ToLower(root+string(os.PathSeparator)))
}

func hiddenFile(rel string) bool {
	base := strings.ToLower(filepath.Base(rel))
	switch base {
	case "shop.db", "shop.db-wal", "shop.db-shm", "kd-server.exe":
		return true
	default:
		return false
	}
}

func newToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func randomText(n int) (string, error) {
	const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	buf := make([]byte, n)
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	for i := range buf {
		buf[i] = alphabet[int(raw[i])%len(alphabet)]
	}
	return string(buf), nil
}

func clientIP(r *http.Request) string {
	host, _, err := splitHost(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func splitHost(addr string) (string, string, error) {
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i], addr[i+1:], nil
		}
	}
	return "", "", errors.New("addr")
}

func lockedOut(r *http.Request) bool {
	failsMu.Lock()
	defer failsMu.Unlock()
	state := fails[clientIP(r)]
	return time.Now().Before(state.until)
}

func noteFail(r *http.Request) {
	failsMu.Lock()
	defer failsMu.Unlock()
	ip := clientIP(r)
	state := fails[ip]
	if time.Now().Before(state.until) {
		return
	}
	state.n++
	if state.n >= 8 {
		state.n = 0
		state.until = time.Now().Add(time.Minute)
	}
	fails[ip] = state
}

func clearFails(r *http.Request) {
	failsMu.Lock()
	delete(fails, clientIP(r))
	failsMu.Unlock()
}

func compressMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ae := r.Header.Get("Accept-Encoding")
		enc := ""
		if strings.Contains(ae, "br") {
			enc = "br"
		} else if strings.Contains(ae, "gzip") {
			enc = "gzip"
		}
		if enc == "" {
			next.ServeHTTP(w, r)
			return
		}
		cw := &compressWriter{w: w, enc: enc}
		defer cw.Close()
		next.ServeHTTP(cw, r)
	})
}

type compressWriter struct {
	w           http.ResponseWriter
	enc         string
	cw          io.WriteCloser
	wroteHeader bool
	status      int
	noCompress  bool
}

func (cw *compressWriter) Header() http.Header { return cw.w.Header() }

func (cw *compressWriter) WriteHeader(code int) {
	if cw.wroteHeader {
		return
	}
	cw.wroteHeader = true
	cw.status = code
	if cw.noCompress || cw.w.Header().Get("Content-Encoding") != "" || !compressible(cw.w.Header().Get("Content-Type"), code) {
		cw.noCompress = true
		cw.w.WriteHeader(code)
		return
	}
	cw.w.Header().Set("Content-Encoding", cw.enc)
	cw.w.Header().Add("Vary", "Accept-Encoding")
	cw.w.Header().Del("Content-Length")
	cw.w.WriteHeader(code)
	switch cw.enc {
	case "br":
		cw.cw = brotli.NewWriter(cw.w)
	default:
		gw, err := gzip.NewWriterLevel(cw.w, gzip.DefaultCompression)
		if err != nil {
			cw.noCompress = true
			return
		}
		cw.cw = gw
	}
}

func (cw *compressWriter) Write(p []byte) (int, error) {
	if !cw.wroteHeader {
		cw.WriteHeader(http.StatusOK)
	}
	if cw.noCompress || cw.cw == nil {
		cw.noCompress = true
		return cw.w.Write(p)
	}
	return cw.cw.Write(p)
}

func (cw *compressWriter) Close() error {
	if cw.cw != nil {
		return cw.cw.Close()
	}
	return nil
}

func compressible(ct string, code int) bool {
	ct = strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	switch ct {
	case "text/html", "text/css", "text/plain", "text/javascript", "text/xml", "text/csv",
		"application/json", "application/javascript", "application/xml", "application/rss+xml",
		"application/atom+xml", "image/svg+xml", "application/wasm", "application/manifest+json":
		return true
	}
	if strings.HasPrefix(ct, "text/") {
		return true
	}
	if strings.HasPrefix(ct, "application/") &&
		(strings.Contains(ct, "json") || strings.Contains(ct, "xml") || strings.Contains(ct, "javascript") || strings.Contains(ct, "wasm")) {
		return true
	}
	return false
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func requestLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
	})
}
