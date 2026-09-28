package executor

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// maxOutputBytes caps what gets stored as checkpoint data so one chatty task
// can't bloat the task_runs table.
const maxOutputBytes = 4000

// Result is what gets reported back to the control plane as durable
// checkpoint data — enough for a downstream task (or a human debugging a
// failed run) to see exactly what happened without re-running anything.
type Result struct {
	Output   string
	Err      error
	Duration time.Duration
}

// Context describes the task being run. It is exposed to the command as
// FLOWFORGE_* environment variables so tasks can read their upstream
// dependencies' output without any extra plumbing.
type Context struct {
	WorkflowRunID       string
	TaskRunID           string
	TaskName            string
	WorkerID            string
	Attempt             int
	UpstreamCheckpoints map[string]string
}

var nonIdentChars = regexp.MustCompile(`[^A-Z0-9]+`)

// EnvName turns a task name into the suffix used for its checkpoint variable:
// "fetch-data" -> "FETCH_DATA", so the output is in $FLOWFORGE_UPSTREAM_FETCH_DATA.
func EnvName(taskName string) string {
	return strings.Trim(nonIdentChars.ReplaceAllString(strings.ToUpper(taskName), "_"), "_")
}

// Env builds the FLOWFORGE_* variables for a task, sorted for stable output.
func (c Context) Env() []string {
	env := []string{
		"FLOWFORGE_RUN_ID=" + c.WorkflowRunID,
		"FLOWFORGE_TASK_RUN_ID=" + c.TaskRunID,
		"FLOWFORGE_TASK_NAME=" + c.TaskName,
		"FLOWFORGE_WORKER_ID=" + c.WorkerID,
		"FLOWFORGE_ATTEMPT=" + strconv.Itoa(c.Attempt),
	}
	names := make([]string, 0, len(c.UpstreamCheckpoints))
	for name := range c.UpstreamCheckpoints {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		env = append(env, "FLOWFORGE_UPSTREAM_"+EnvName(name)+"="+c.UpstreamCheckpoints[name])
	}
	upstream := c.UpstreamCheckpoints
	if upstream == nil {
		upstream = map[string]string{}
	}
	if payload, err := json.Marshal(upstream); err == nil {
		env = append(env, "FLOWFORGE_UPSTREAM_JSON="+string(payload))
	}
	return env
}

// Run executes a task's shell command with a hard timeout matching the
// lease the control plane granted. If the command outlives the timeout the
// whole process group is killed (so `sh -c "a; b"` can't leave orphans
// holding the output pipe open), the task reports failure, and the control
// plane's own lease-expiry reaper would have caught it anyway — this just
// fails fast instead of waiting for the reaper sweep.
func Run(command string, timeoutSeconds int, task Context) Result {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Env = append(os.Environ(), task.Env()...)
	configureProcessGroup(cmd)
	cmd.WaitDelay = 2 * time.Second

	start := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(start)

	trimmed := strings.TrimSpace(string(output))
	if len(trimmed) > maxOutputBytes {
		trimmed = trimmed[:maxOutputBytes] + "...(truncated)"
	}

	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return Result{Output: trimmed, Err: context.DeadlineExceeded, Duration: duration}
	}
	return Result{Output: trimmed, Err: err, Duration: duration}
}
