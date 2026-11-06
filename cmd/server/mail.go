package main

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"mime"
	"net"
	"net/smtp"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const orderMailUnconfigured = "Почта сервера не настроена."

var (
	customerMail = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	deliverMail  = smtpDeliver

	orderMailMu   sync.Mutex
	orderMailHits = map[string][]time.Time{}
)

type mailEvent struct {
	Status string `json:"status"`
	To     string `json:"to,omitempty"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	At     string `json:"at"`
}

func orderStatusText(status string) (string, bool) {
	switch status {
	case "Принят":
		return "Заказ принят на складе. Перезвоним и подтвердим наличие.", true
	case "Собран":
		return "Заказ собран и ждёт отгрузку.", true
	case "Отгружен":
		return "Заказ отгружен.", true
	default:
		return "", false
	}
}

func validCustomerMail(s string) bool {
	s = strings.TrimSpace(s)
	return utf8.RuneCountInString(s) <= 120 && customerMail.MatchString(s)
}

func jsonString(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return strings.TrimSpace(s)
}

func isOrderDoc(m map[string]any) bool {
	if jsonString(m, "kind") == "order" {
		return true
	}
	_, ok := m["summary"].(string)
	return ok && jsonString(m, "summary") != ""
}

func mailLogOf(raw []byte) []mailEvent {
	if len(raw) == 0 {
		return nil
	}
	var doc struct {
		MailLog []mailEvent `json:"mailLog"`
	}
	if json.Unmarshal(raw, &doc) != nil {
		return nil
	}
	return doc.MailLog
}

func hasMailEvent(log []mailEvent, status string, okOnly bool) bool {
	for _, event := range log {
		if event.Status == status && (!okOnly || event.OK) {
			return true
		}
	}
	return false
}

func moneyText(v any) string {
	n, ok := v.(float64)
	if !ok {
		return ""
	}
	if n == float64(int64(n)) {
		return strconv.FormatInt(int64(n), 10)
	}
	return strconv.FormatFloat(n, 'f', 2, 64)
}

func clipRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	out := make([]rune, 0, n)
	for _, r := range s {
		if len(out) == n {
			break
		}
		out = append(out, r)
	}
	return string(out) + "…"
}

func orderLetter(n, name, status, summary, comment, phone, total string) (string, string) {
	line, _ := orderStatusText(status)
	subject := "Заказ " + n + " — " + strings.ToLower(status)
	var b strings.Builder
	if name != "" {
		b.WriteString("Здравствуйте, " + name + ".\n\n")
	}
	b.WriteString("Заказ " + n + ": " + strings.ToLower(status) + ".\n")
	b.WriteString(line + "\n")
	if summary != "" {
		b.WriteString("\nСостав: " + summary + "\n")
	}
	if total != "" {
		b.WriteString("Сумма: " + total + " ₽\n")
	}
	if comment != "" {
		b.WriteString("Комментарий: " + comment + "\n")
	}
	b.WriteString("\nКаменный двор")
	if phone != "" {
		b.WriteString("\n" + phone)
	}
	return subject, b.String()
}

func mailErrText(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.TrimSpace(strings.ReplaceAll(err.Error(), "\n", " "))
	if strings.Contains(msg, orderMailUnconfigured) {
		return orderMailUnconfigured
	}
	if utf8.RuneCountInString(msg) > 160 {
		msg = clipRunes(msg, 160)
	}
	return "Не удалось отправить письмо. " + msg
}

func allowOrderMail(ip string, now time.Time) bool {
	orderMailMu.Lock()
	defer orderMailMu.Unlock()
	cut := now.Add(-10 * time.Minute)
	kept := orderMailHits[ip][:0]
	for _, at := range orderMailHits[ip] {
		if at.After(cut) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= 8 {
		orderMailHits[ip] = kept
		return false
	}
	orderMailHits[ip] = append(kept, now)
	return true
}

func shouldSend(log []mailEvent, status, email string) bool {
	if _, ok := orderStatusText(status); !ok || hasMailEvent(log, status, true) {
		return false
	}
	if validCustomerMail(email) {
		return true
	}
	return !hasMailEvent(log, status, false)
}

func stampOrderMail(prev, next []byte, staff bool, now time.Time, ip, phone string, send func(to, subject, body string) error) ([]byte, error) {
	var doc map[string]any
	if err := json.Unmarshal(next, &doc); err != nil || doc == nil {
		return nil, errors.New("bad lead")
	}
	if !isOrderDoc(doc) {
		return next, nil
	}
	status := jsonString(doc, "status")
	if !staff {
		status = "Принят"
		doc["status"] = status
	}
	log := mailLogOf(prev)
	to := jsonString(doc, "mail")
	if shouldSend(log, status, to) {
		at := now.UTC().Format(time.RFC3339)
		switch {
		case !validCustomerMail(to):
			log = append(log, mailEvent{Status: status, OK: false, Error: "У заказа нет почты клиента.", At: at})
		case !staff && !allowOrderMail(ip, now):
			log = append(log, mailEvent{Status: status, To: to, OK: false, Error: "Слишком много писем с этого адреса. Повторите позже.", At: at})
		default:
			subject, body := orderLetter(jsonString(doc, "n"), jsonString(doc, "name"), status, jsonString(doc, "summary"), clipRunes(jsonString(doc, "comment"), 200), phone, moneyText(doc["total"]))
			err := send(to, subject, body)
			event := mailEvent{Status: status, To: to, OK: err == nil, At: at}
			if err != nil {
				event.Error = mailErrText(err)
			}
			log = append(log, event)
		}
	}
	if len(log) > 12 {
		log = log[len(log)-12:]
	}
	doc["mailLog"] = log
	out, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func cleanHeader(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' {
			return -1
		}
		return r
	}, s)
}

func smtpDeliver(to, subject, body string) error {
	host := strings.TrimSpace(os.Getenv("KD_SMTP_HOST"))
	port := strings.TrimSpace(os.Getenv("KD_SMTP_PORT"))
	user := strings.TrimSpace(os.Getenv("KD_SMTP_USER"))
	pass := os.Getenv("KD_SMTP_PASSWORD")
	from := strings.TrimSpace(os.Getenv("KD_SMTP_FROM"))
	if host == "" || user == "" || pass == "" {
		return errors.New(orderMailUnconfigured)
	}
	if port == "" {
		port = "587"
	}
	if from == "" {
		from = user
	}
	to = cleanHeader(to)
	from = cleanHeader(from)
	subject = mime.QEncoding.Encode("utf-8", cleanHeader(subject))
	addr := net.JoinHostPort(host, port)
	var msg strings.Builder
	msg.WriteString("From: " + from + "\r\n")
	msg.WriteString("To: " + to + "\r\n")
	msg.WriteString("Subject: " + subject + "\r\n")
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	msg.WriteString("\r\n")
	msg.WriteString(strings.ReplaceAll(body, "\n", "\r\n"))
	auth := smtp.PlainAuth("", user, pass, host)
	if port == "465" {
		return sendMailTLS(addr, host, auth, from, to, []byte(msg.String()))
	}
	return smtp.SendMail(addr, auth, from, []string{to}, []byte(msg.String()))
}

func sendMailTLS(addr, host string, auth smtp.Auth, from, to string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
	if err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer client.Close()
	if err := client.Auth(auth); err != nil {
		return err
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}
