package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := openDB(filepath.Join(t.TempDir(), "shop.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := ensureStaff(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func authCookie(t *testing.T, id int64) *http.Cookie {
	t.Helper()
	token, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	sessionsMu.Lock()
	sessions[token] = session{Expires: time.Now().Add(time.Hour), ID: id}
	sessionsMu.Unlock()
	t.Cleanup(func() {
		sessionsMu.Lock()
		delete(sessions, token)
		sessionsMu.Unlock()
	})
	return &http.Cookie{Name: "kd_admin", Value: token}
}

func TestMigrateAdminUser(t *testing.T) {
	db, err := openDB(filepath.Join(t.TempDir(), "shop.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	salt, hash, err := hashPassword("legacy-pass-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO admin_user(id, username, salt, hash) VALUES (1, ?, ?, ?)`, "legacy", salt, hash); err != nil {
		t.Fatal(err)
	}
	if err := ensureStaff(db); err != nil {
		t.Fatal(err)
	}
	row, ok := loginStaff(db, "Legacy", "legacy-pass-1")
	if !ok || row.Role != "admin" || row.Name != "legacy" {
		t.Fatalf("migrated admin login failed: %+v %v", row, ok)
	}
	if err := ensureStaff(db); err != nil {
		t.Fatal(err)
	}
	list, err := listStaff(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("staff count %d", len(list))
	}
}

func TestStaffRoles(t *testing.T) {
	db := testDB(t)
	admin, err := createStaff(db, "Админ склада", "boss", "admin-pass-1", "admin")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := createStaff(db, "Мария", "maria", "manager-pass-1", "manager")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := loginStaff(db, "maria", "manager-pass-1"); !ok {
		t.Fatal("manager login")
	}
	if _, ok := loginStaff(db, "maria", "wrong-pass-1"); ok {
		t.Fatal("wrong password accepted")
	}
	if _, err := createStaff(db, "Другая Мария", "Maria", "manager-pass-2", "manager"); err == nil {
		t.Fatal("duplicate login accepted")
	}
	if _, err := createStaff(db, "Короткий", "short", "1234567", "manager"); err == nil {
		t.Fatal("short password accepted")
	}

	adminReq := httptest.NewRequest(http.MethodGet, "/api/staff", nil)
	adminReq.AddCookie(authCookie(t, admin.ID))
	adminRec := httptest.NewRecorder()
	handleStaff(db, adminRec, adminReq)
	if adminRec.Code != http.StatusOK {
		t.Fatalf("admin list %d %s", adminRec.Code, adminRec.Body.String())
	}
	if strings.Contains(adminRec.Body.String(), "manager-pass-1") || strings.Contains(adminRec.Body.String(), "hash") {
		t.Fatal("staff list leaked a password")
	}
	var listed []staffRow
	if err := json.Unmarshal(adminRec.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 || listed[0].Role != "admin" {
		t.Fatalf("list %#v", listed)
	}

	mgrReq := httptest.NewRequest(http.MethodGet, "/api/staff", nil)
	mgrReq.AddCookie(authCookie(t, manager.ID))
	mgrRec := httptest.NewRecorder()
	handleStaff(db, mgrRec, mgrReq)
	if mgrRec.Code != http.StatusForbidden {
		t.Fatalf("manager staff %d", mgrRec.Code)
	}
	siteReq := httptest.NewRequest(http.MethodGet, "/api/admin", nil)
	siteReq.AddCookie(authCookie(t, manager.ID))
	siteRec := httptest.NewRecorder()
	if !requireAuth(db, siteRec, siteReq) {
		t.Fatalf("manager cannot open the site api: %d", siteRec.Code)
	}

	if err := updateStaff(db, admin.ID, manager.ID, "Мария Склад", "manager", false, ""); err != nil {
		t.Fatal(err)
	}
	if _, ok := loginStaff(db, "maria", "manager-pass-1"); ok {
		t.Fatal("disabled manager still logs in")
	}
	offReq := httptest.NewRequest(http.MethodGet, "/api/admin", nil)
	offReq.AddCookie(authCookie(t, manager.ID))
	offRec := httptest.NewRecorder()
	if requireAuth(db, offRec, offReq) {
		t.Fatal("disabled session still works")
	}

	if err := updateStaff(db, admin.ID, manager.ID, "Мария Склад", "manager", true, "manager-pass-2"); err != nil {
		t.Fatal(err)
	}
	if _, ok := loginStaff(db, "maria", "manager-pass-1"); ok {
		t.Fatal("old password still works")
	}
	if _, ok := loginStaff(db, "maria", "manager-pass-2"); !ok {
		t.Fatal("new password rejected")
	}

	self := httptest.NewRequest(http.MethodDelete, "/api/staff?id="+itoa(admin.ID), nil)
	self.AddCookie(authCookie(t, admin.ID))
	selfRec := httptest.NewRecorder()
	handleStaff(db, selfRec, self)
	if selfRec.Code != http.StatusBadRequest {
		t.Fatalf("delete self %d %s", selfRec.Code, selfRec.Body.String())
	}
	last := httptest.NewRequest(http.MethodDelete, "/api/staff?id="+itoa(admin.ID), nil)
	last.AddCookie(authCookie(t, manager.ID))
	lastRec := httptest.NewRecorder()
	handleStaff(db, lastRec, last)
	if lastRec.Code != http.StatusForbidden {
		t.Fatalf("manager delete %d", lastRec.Code)
	}
	if err := deleteStaff(db, admin.ID, admin.ID); err == nil {
		t.Fatal("deleted the only admin")
	}

	other, err := createStaff(db, "Второй", "second", "admin-pass-2", "admin")
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteStaff(db, other.ID, admin.ID); err != nil {
		t.Fatal(err)
	}
	if err := deleteStaff(db, manager.ID, other.ID); err == nil {
		t.Fatal("removed the last admin")
	}
	body := []byte(`{"name":"Второй","role":"manager","active":true,"password":""}`)
	put := httptest.NewRequest(http.MethodPut, "/api/staff?id="+itoa(other.ID), bytes.NewReader(body))
	put.AddCookie(authCookie(t, other.ID))
	putRec := httptest.NewRecorder()
	handleStaff(db, putRec, put)
	if putRec.Code != http.StatusBadRequest {
		t.Fatalf("demote last admin %d %s", putRec.Code, putRec.Body.String())
	}
}

func TestEnvPasswordKeepsManagers(t *testing.T) {
	db := testDB(t)
	if _, err := createStaff(db, "Админ склада", "boss", "admin-pass-1", "admin"); err != nil {
		t.Fatal(err)
	}
	if _, err := createStaff(db, "Мария", "maria", "manager-pass-1", "manager"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KD_ADMIN_USER", "boss")
	t.Setenv("KD_ADMIN_PASSWORD", "admin-pass-9")
	if err := loadAuth(db); err != nil {
		t.Fatal(err)
	}
	if _, ok := loginStaff(db, "boss", "admin-pass-9"); !ok {
		t.Fatal("env password was not applied")
	}
	if _, ok := loginStaff(db, "maria", "manager-pass-1"); !ok {
		t.Fatal("env password removed the manager")
	}
	list, err := listStaff(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("staff count %d", len(list))
	}
}

func itoa(id int64) string {
	return strconv.FormatInt(id, 10)
}
