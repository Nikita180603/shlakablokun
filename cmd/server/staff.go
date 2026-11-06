package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var staffUser = regexp.MustCompile(`^[\p{L}][\p{L}\p{N}._-]{2,31}$`)

type staffRow struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Active   bool   `json:"active"`
	salt     []byte
	hash     []byte
}

type staffError struct {
	Status int
	Msg    string
}

func (e *staffError) Error() string { return e.Msg }

func staffErr(status int, msg string) *staffError {
	return &staffError{Status: status, Msg: msg}
}

func ensureStaff(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS staff (
		id INTEGER PRIMARY KEY,
		username TEXT NOT NULL COLLATE NOCASE UNIQUE,
		name TEXT NOT NULL,
		role TEXT NOT NULL CHECK (role IN ('admin', 'manager')),
		active INTEGER NOT NULL DEFAULT 1,
		salt BLOB NOT NULL,
		hash BLOB NOT NULL
	)`); err != nil {
		return err
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM staff`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	var user string
	var salt, hash []byte
	err := db.QueryRow(`SELECT username, salt, hash FROM admin_user WHERE id = 1`).Scan(&user, &salt, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = db.Exec(`INSERT INTO staff(username, name, role, active, salt, hash) VALUES (?, ?, 'admin', 1, ?, ?)`, user, user, salt, hash)
	return err
}

func loadAuth(db *sql.DB) error {
	if err := ensureStaff(db); err != nil {
		return err
	}
	userEnv := strings.TrimSpace(os.Getenv("KD_ADMIN_USER"))
	passEnv := os.Getenv("KD_ADMIN_PASSWORD")
	if passEnv != "" {
		user := userEnv
		if user == "" {
			user = "admin"
		}
		return upsertEnvAdmin(db, user, passEnv)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM staff`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	user := userEnv
	if user == "" {
		created, err := randomText(8)
		if err != nil {
			return err
		}
		user = created
	}
	pass, err := randomText(16)
	if err != nil {
		return err
	}
	logCreatedAdmin(user, pass)
	_, err = insertStaff(db, user, user, pass, "admin", true)
	return err
}

func logCreatedAdmin(user, pass string) {
	log.Printf("admin credentials created once user=%s password=%s", user, pass)
}

func upsertEnvAdmin(db *sql.DB, user, password string) error {
	row, err := staffByUsername(db, user)
	if err == nil {
		if err := setPassword(db, row.ID, password); err != nil {
			return err
		}
		if _, err = db.Exec(`UPDATE staff SET role = 'admin', active = 1 WHERE id = ?`, row.ID); err != nil {
			return err
		}
		log.Printf("admin password taken from KD_ADMIN_PASSWORD")
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err = insertStaff(db, user, user, password, "admin", true); err != nil {
		return err
	}
	log.Printf("admin password taken from KD_ADMIN_PASSWORD")
	return nil
}

func stretch(salt []byte, password string) []byte {
	mac := sha256.New()
	mac.Write(salt)
	_, _ = mac.Write([]byte(password))
	sum := mac.Sum(nil)
	for i := 0; i < 150000; i++ {
		mac.Reset()
		mac.Write(sum)
		mac.Write(salt)
		sum = mac.Sum(nil)
	}
	return sum
}

func hashPassword(password string) ([]byte, []byte, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, nil, err
	}
	return salt, stretch(salt, password), nil
}

func loginStaff(db *sql.DB, user, password string) (staffRow, bool) {
	row, err := staffByUsername(db, strings.TrimSpace(user))
	if err != nil || !row.Active || len(row.salt) == 0 || len(row.hash) == 0 {
		return staffRow{}, false
	}
	got := stretch(row.salt, password)
	if subtle.ConstantTimeCompare(got, row.hash) != 1 {
		return staffRow{}, false
	}
	return row, true
}

func listStaff(db *sql.DB) ([]staffRow, error) {
	rows, err := db.Query(`SELECT id, username, name, role, active FROM staff
		ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name COLLATE NOCASE, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []staffRow{}
	for rows.Next() {
		var row staffRow
		var active int
		if err := rows.Scan(&row.ID, &row.Username, &row.Name, &row.Role, &active); err != nil {
			return nil, err
		}
		row.Active = active == 1
		out = append(out, row)
	}
	return out, rows.Err()
}

func staffBy(db *sql.DB, column string, value any) (staffRow, error) {
	var row staffRow
	var active int
	err := db.QueryRow(`SELECT id, username, name, role, active, salt, hash FROM staff WHERE `+column+` = ?`, value).
		Scan(&row.ID, &row.Username, &row.Name, &row.Role, &active, &row.salt, &row.hash)
	row.Active = active == 1
	return row, err
}

func staffByID(db *sql.DB, id int64) (staffRow, error) {
	return staffBy(db, "id", id)
}

func staffByUsername(db *sql.DB, username string) (staffRow, error) {
	return staffBy(db, "username", username)
}

func createStaff(db *sql.DB, name, username, password, role string) (staffRow, error) {
	name, err := validateName(name)
	if err != nil {
		return staffRow{}, err
	}
	username, err = validateUsername(username)
	if err != nil {
		return staffRow{}, err
	}
	if err := validatePassword(password, true); err != nil {
		return staffRow{}, err
	}
	role, err = validateRole(role, true)
	if err != nil {
		return staffRow{}, err
	}
	id, err := insertStaff(db, username, name, password, role, true)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return staffRow{}, staffErr(http.StatusConflict, "Логин уже занят.")
		}
		return staffRow{}, err
	}
	return staffByID(db, id)
}

func insertStaff(db *sql.DB, username, name, password, role string, active bool) (int64, error) {
	salt, hash, err := hashPassword(password)
	if err != nil {
		return 0, err
	}
	res, err := db.Exec(`INSERT INTO staff(username, name, role, active, salt, hash) VALUES (?, ?, ?, ?, ?, ?)`,
		username, name, role, bit(active), salt, hash)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func updateStaff(db *sql.DB, actorID, id int64, name, role string, active bool, password string) error {
	row, err := staffByID(db, id)
	if errors.Is(err, sql.ErrNoRows) {
		return staffErr(http.StatusNotFound, "Нет такого человека.")
	}
	if err != nil {
		return err
	}
	name, err = validateName(name)
	if err != nil {
		return err
	}
	role, err = validateRole(role, false)
	if err != nil {
		return err
	}
	if err := validatePassword(password, false); err != nil {
		return err
	}
	if actorID == id && !active {
		return staffErr(http.StatusBadRequest, "Нельзя отключить свою учётную запись.")
	}
	if err := checkLastAdmin(db, row, role, active); err != nil {
		return err
	}
	if password != "" {
		if err := setPassword(db, id, password); err != nil {
			return err
		}
	}
	_, err = db.Exec(`UPDATE staff SET name = ?, role = ?, active = ? WHERE id = ?`, name, role, bit(active), id)
	return err
}

func deleteStaff(db *sql.DB, actorID, id int64) error {
	if actorID == id {
		return staffErr(http.StatusBadRequest, "Нельзя удалить свою учётную запись.")
	}
	row, err := staffByID(db, id)
	if errors.Is(err, sql.ErrNoRows) {
		return staffErr(http.StatusNotFound, "Нет такого человека.")
	}
	if err != nil {
		return err
	}
	if err := checkLastAdmin(db, row, "", false); err != nil {
		return err
	}
	_, err = db.Exec(`DELETE FROM staff WHERE id = ?`, id)
	return err
}

func setPassword(db *sql.DB, id int64, password string) error {
	salt, hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE staff SET salt = ?, hash = ? WHERE id = ?`, salt, hash, id)
	return err
}

func checkLastAdmin(db *sql.DB, row staffRow, role string, active bool) error {
	if row.Role == "admin" && row.Active && (role != "admin" || !active) {
		n, err := activeAdmins(db)
		if err != nil {
			return err
		}
		if n <= 1 {
			return staffErr(http.StatusBadRequest, "Должен остаться хотя бы один активный администратор.")
		}
	}
	return nil
}

func activeAdmins(db *sql.DB) (int, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM staff WHERE role = 'admin' AND active = 1`).Scan(&n)
	return n, err
}

func validateName(name string) (string, error) {
	name = strings.TrimSpace(name)
	n := utf8.RuneCountInString(name)
	if n < 2 || n > 80 {
		return "", staffErr(http.StatusBadRequest, "Имя: от 2 до 80 символов.")
	}
	return name, nil
}

func validateUsername(username string) (string, error) {
	username = strings.TrimSpace(username)
	if !staffUser.MatchString(username) {
		return "", staffErr(http.StatusBadRequest, "Логин: 3–32 символа, начинается с буквы.")
	}
	return username, nil
}

func validatePassword(password string, required bool) error {
	if password == "" && !required {
		return nil
	}
	n := utf8.RuneCountInString(password)
	if n < 8 || n > 72 {
		return staffErr(http.StatusBadRequest, "Пароль: от 8 до 72 символов.")
	}
	return nil
}

func validateRole(role string, allowEmpty bool) (string, error) {
	if role == "" && allowEmpty {
		return "manager", nil
	}
	if role != "admin" && role != "manager" {
		return "", staffErr(http.StatusBadRequest, "Роль: администратор или менеджер.")
	}
	return role, nil
}

func bit(v bool) int {
	if v {
		return 1
	}
	return 0
}

func currentSession(db *sql.DB, r *http.Request) (staffRow, bool) {
	c, err := r.Cookie("kd_admin")
	if err != nil || c.Value == "" {
		return staffRow{}, false
	}
	sessionsMu.Lock()
	s, ok := sessions[c.Value]
	if !ok || s.ID == 0 || time.Now().After(s.Expires) {
		delete(sessions, c.Value)
		sessionsMu.Unlock()
		return staffRow{}, false
	}
	sessionsMu.Unlock()
	row, err := staffByID(db, s.ID)
	if err != nil || !row.Active {
		return staffRow{}, false
	}
	return row, true
}

func requireAuth(db *sql.DB, w http.ResponseWriter, r *http.Request) bool {
	if _, ok := currentSession(db, r); ok {
		return true
	}
	http.Error(w, "unauthorized", http.StatusUnauthorized)
	return false
}

func writeStaffPublic(w http.ResponseWriter, code int, row staffRow) {
	raw, err := json.Marshal(row)
	if err != nil {
		http.Error(w, "json", http.StatusInternalServerError)
		return
	}
	writeJSON(w, code, raw)
}

func writeStaffErr(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	var se *staffError
	if errors.As(err, &se) {
		http.Error(w, se.Msg, se.Status)
		return true
	}
	http.Error(w, "Не удалось сохранить.", http.StatusInternalServerError)
	return true
}

func handleStaff(db *sql.DB, w http.ResponseWriter, r *http.Request) {
	actor, ok := currentSession(db, r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if actor.Role != "admin" {
		http.Error(w, "Только администратор управляет людьми.", http.StatusForbidden)
		return
	}
	switch r.Method {
	case http.MethodGet:
		list, err := listStaff(db)
		if err != nil {
			http.Error(w, "Не удалось прочитать список.", http.StatusInternalServerError)
			return
		}
		raw, err := json.Marshal(list)
		if err != nil {
			http.Error(w, "json", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, raw)
	case http.MethodPost:
		raw, err := readLimited(r, 8_000)
		if err != nil {
			http.Error(w, "too big", http.StatusRequestEntityTooLarge)
			return
		}
		var body struct {
			Username string `json:"username"`
			Name     string `json:"name"`
			Password string `json:"password"`
			Role     string `json:"role"`
		}
		if json.Unmarshal(raw, &body) != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		row, err := createStaff(db, body.Name, body.Username, body.Password, body.Role)
		if writeStaffErr(w, err) {
			return
		}
		row.salt, row.hash = nil, nil
		writeStaffPublic(w, http.StatusCreated, row)
	case http.MethodPut:
		id, ok := staffID(w, r)
		if !ok {
			return
		}
		raw, err := readLimited(r, 8_000)
		if err != nil {
			http.Error(w, "too big", http.StatusRequestEntityTooLarge)
			return
		}
		var body struct {
			Name     string `json:"name"`
			Role     string `json:"role"`
			Active   bool   `json:"active"`
			Password string `json:"password"`
		}
		if json.Unmarshal(raw, &body) != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		if writeStaffErr(w, updateStaff(db, actor.ID, id, body.Name, body.Role, body.Active, body.Password)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodDelete:
		id, ok := staffID(w, r)
		if !ok {
			return
		}
		if writeStaffErr(w, deleteStaff(db, actor.ID, id)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method", http.StatusMethodNotAllowed)
	}
}

func staffID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "Нет такого человека.", http.StatusBadRequest)
		return 0, false
	}
	return id, true
}
