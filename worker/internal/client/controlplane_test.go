package client

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLeaseTaskReturnsNilWhenNoWork(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/workers/w-1/lease" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	lease, err := New(srv.URL).LeaseTask("w-1")
	if err != nil || lease != nil {
		t.Fatalf("lease=%v err=%v, want nil, nil", lease, err)
	}
}

func TestLeaseTaskDecodesLease(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"taskRunId": "t1", "workflowRunId": "r1", "taskName": "load", "command": "echo hi",
			"timeoutSeconds": 30, "attempt": 2, "upstreamCheckpoints": map[string]string{"transform": "ok"},
		})
	}))
	defer srv.Close()

	lease, err := New(srv.URL).LeaseTask("w-1")
	if err != nil {
		t.Fatal(err)
	}
	if lease.TaskName != "load" || lease.Attempt != 2 || lease.UpstreamCheckpoints["transform"] != "ok" {
		t.Fatalf("unexpected lease %+v", lease)
	}
}

func TestCallbacksSendPayloadAndMapConflictToErrLeaseLost(t *testing.T) {
	var got map[string]string
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(status)
	}))
	defer srv.Close()
	c := New(srv.URL)

	if err := c.CompleteTask("t1", "rows=5"); err != nil {
		t.Fatal(err)
	}
	if got["checkpointData"] != "rows=5" {
		t.Fatalf("payload = %v", got)
	}

	status = http.StatusConflict
	if err := c.FailTask("t1", "boom"); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("err = %v, want ErrLeaseLost", err)
	}
	if got["errorMessage"] != "boom" {
		t.Fatalf("payload = %v", got)
	}

	status = http.StatusInternalServerError
	if err := c.CompleteTask("t1", ""); err == nil || errors.Is(err, ErrLeaseLost) {
		t.Fatalf("err = %v, want generic error", err)
	}
}
