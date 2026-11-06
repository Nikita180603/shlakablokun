package main

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func resetMailHits() {
	orderMailMu.Lock()
	orderMailHits = map[string][]time.Time{}
	orderMailMu.Unlock()
}

func TestOrderMailStages(t *testing.T) {
	resetMailHits()
	now := time.Date(2026, 11, 3, 9, 0, 0, 0, time.UTC)
	var sent []string
	send := func(to, subject, body string) error {
		sent = append(sent, to+"|"+subject+"|"+body)
		return nil
	}
	raw := []byte(`{"kind":"order","n":"КД-1","name":"Иван","mail":"ivan@example.com","summary":"Плита — 1 м²","total":740,"status":"Принят","comment":"к воротам"}`)
	accepted, err := stampOrderMail(nil, raw, false, now, "10.0.0.1", "+7 900", send)
	if err != nil {
		t.Fatal(err)
	}
	if len(sent) != 1 || !strings.Contains(sent[0], "ivan@example.com") || !strings.Contains(sent[0], "принят") || !strings.Contains(sent[0], "Плита") || !strings.Contains(sent[0], "740") {
		t.Fatalf("accepted letter: %v", sent)
	}
	again, err := stampOrderMail(accepted, accepted, true, now, "10.0.0.1", "+7 900", send)
	if err != nil || len(sent) != 1 {
		t.Fatalf("duplicate принят: %v %v", err, sent)
	}
	var doc map[string]any
	if json.Unmarshal(again, &doc) != nil {
		t.Fatal("json")
	}
	doc["status"] = "Собран"
	packed, _ := json.Marshal(doc)
	built, err := stampOrderMail(again, packed, true, now, "10.0.0.1", "+7 900", send)
	if err != nil || len(sent) != 2 || !strings.Contains(sent[1], "собран") {
		t.Fatalf("собран: %v %v", err, sent)
	}
	doc["status"] = "Отгружен"
	json.Unmarshal(built, &doc)
	doc["status"] = "Отгружен"
	packed, _ = json.Marshal(doc)
	shipped, err := stampOrderMail(built, packed, true, now, "10.0.0.1", "+7 900", send)
	if err != nil || len(sent) != 3 || !strings.Contains(sent[2], "отгружен") {
		t.Fatalf("отгружен: %v %v", err, sent)
	}
	json.Unmarshal(shipped, &doc)
	doc["status"] = "Отменён"
	packed, _ = json.Marshal(doc)
	if _, err := stampOrderMail(shipped, packed, true, now, "10.0.0.1", "+7 900", send); err != nil || len(sent) != 3 {
		t.Fatalf("отмена не должна писать письмо: %v", sent)
	}
}

func TestPublicOrderStaysAccepted(t *testing.T) {
	resetMailHits()
	var subjects []string
	send := func(_, subject, _ string) error {
		subjects = append(subjects, subject)
		return nil
	}
	raw := []byte(`{"kind":"order","n":"КД-2","mail":"a@b.co","status":"Собран","summary":"блок"}`)
	out, err := stampOrderMail(nil, raw, false, time.Now(), "10.0.0.2", "", send)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if json.Unmarshal(out, &doc) != nil || doc["status"] != "Принят" || len(subjects) != 1 || !strings.Contains(subjects[0], "принят") {
		t.Fatalf("public status %#v %v", doc["status"], subjects)
	}
}

func TestMissingMailIsRememberedOnce(t *testing.T) {
	resetMailHits()
	send := func(string, string, string) error { t.Fatal("send"); return nil }
	raw := []byte(`{"kind":"order","n":"КД-3","status":"Принят","summary":"песок"}`)
	now := time.Now()
	first, err := stampOrderMail(nil, raw, true, now, "10.0.0.3", "", send)
	if err != nil {
		t.Fatal(err)
	}
	second, err := stampOrderMail(first, first, true, now, "10.0.0.3", "", send)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(second), "У заказа нет почты клиента.") != 1 {
		t.Fatalf("log: %s", second)
	}
}

func TestMailRetriesAfterFailure(t *testing.T) {
	resetMailHits()
	calls := 0
	send := func(string, string, string) error {
		calls++
		if calls == 1 {
			return errors.New("dial tcp: refused")
		}
		return nil
	}
	raw := []byte(`{"kind":"order","n":"КД-4","mail":"ok@example.com","status":"Собран","summary":"бордюр"}`)
	now := time.Now()
	failed, err := stampOrderMail(nil, raw, true, now, "10.0.0.4", "", send)
	if err != nil || calls != 1 || !strings.Contains(string(failed), "Не удалось отправить письмо.") {
		t.Fatalf("fail %v %s", err, failed)
	}
	sent, err := stampOrderMail(failed, failed, true, now, "10.0.0.4", "", send)
	if err != nil || calls != 2 {
		t.Fatal(err, calls)
	}
	var doc struct {
		MailLog []mailEvent `json:"mailLog"`
	}
	if json.Unmarshal(sent, &doc) != nil || len(doc.MailLog) != 2 || !doc.MailLog[1].OK {
		t.Fatalf("retry log %#v", doc.MailLog)
	}
}

func TestCallbackSkipsMail(t *testing.T) {
	raw := []byte(`{"n":"КД-5","name":"Анна","phone":"7900","status":"Новая"}`)
	out, err := stampOrderMail(nil, raw, true, time.Now(), "10.0.0.5", "", func(string, string, string) error {
		t.Fatal("callback mailed")
		return nil
	})
	if err != nil || string(out) != string(raw) {
		t.Fatalf("%v %s", err, out)
	}
}
