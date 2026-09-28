package executor

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRunCapturesOutput(t *testing.T) {
	res := Run(`echo hello; echo world >&2`, 5, Context{})
	if res.Err != nil {
		t.Fatalf("unexpected error: %v", res.Err)
	}
	if res.Output != "hello\nworld" {
		t.Fatalf("output = %q", res.Output)
	}
}

func TestRunReportsNonZeroExit(t *testing.T) {
	res := Run(`echo broken; exit 3`, 5, Context{})
	if res.Err == nil {
		t.Fatal("expected an error for exit code 3")
	}
	if !strings.Contains(res.Err.Error(), "exit status 3") {
		t.Fatalf("err = %v", res.Err)
	}
	if res.Output != "broken" {
		t.Fatalf("output = %q", res.Output)
	}
}

func TestRunKillsWholeProcessGroupOnTimeout(t *testing.T) {
	start := time.Now()
	// The trailing echo keeps sh alive as a parent of sleep; without killing
	// the process group, sleep would hold the pipe open for 30s.
	res := Run(`sleep 30; echo never`, 1, Context{})
	if !errors.Is(res.Err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want deadline exceeded", res.Err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("timeout took %s; child process was not killed", elapsed)
	}
}

func TestRunExposesTaskContextAsEnv(t *testing.T) {
	ctx := Context{
		WorkflowRunID: "run-1",
		TaskRunID:     "task-9",
		TaskName:      "load",
		WorkerID:      "w-0",
		Attempt:       2,
		UpstreamCheckpoints: map[string]string{
			"fetch-data": "rows=10",
			"transform":  "ok",
		},
	}
	res := Run(`echo "$FLOWFORGE_RUN_ID|$FLOWFORGE_TASK_NAME|$FLOWFORGE_ATTEMPT|$FLOWFORGE_UPSTREAM_FETCH_DATA|$FLOWFORGE_UPSTREAM_TRANSFORM|$FLOWFORGE_UPSTREAM_JSON"`, 5, ctx)
	if res.Err != nil {
		t.Fatalf("unexpected error: %v", res.Err)
	}
	want := `run-1|load|2|rows=10|ok|{"fetch-data":"rows=10","transform":"ok"}`
	if res.Output != want {
		t.Fatalf("output = %q\nwant     %q", res.Output, want)
	}
}

func TestRunTruncatesLargeOutput(t *testing.T) {
	res := Run(`head -c 10000 /dev/zero | tr '\0' 'x'`, 5, Context{})
	if !strings.HasSuffix(res.Output, "...(truncated)") || len(res.Output) != maxOutputBytes+len("...(truncated)") {
		t.Fatalf("unexpected output length %d", len(res.Output))
	}
}

func TestEnvName(t *testing.T) {
	cases := map[string]string{
		"extract":       "EXTRACT",
		"fetch-data":    "FETCH_DATA",
		"render.pdf v2": "RENDER_PDF_V2",
		"--odd--":       "ODD",
	}
	for in, want := range cases {
		if got := EnvName(in); got != want {
			t.Errorf("EnvName(%q) = %q, want %q", in, got, want)
		}
	}
}
