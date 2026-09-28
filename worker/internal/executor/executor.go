package executor

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// Result is what gets reported back to the control plane as durable
// checkpoint data — enough for a downstream task (or a human debugging a
// failed run) to see exactly what happened without re-running anything.
type Result struct {
	Output string
	Err    error
}

// Run executes a task's shell command with a hard timeout matching the
// lease the control plane granted. If the command outlives the timeout the
// context kills it, the task reports failure, and the control plane's own
// lease-expiry reaper would have caught it anyway — this just fails fast
// instead of waiting for the reaper sweep.
func Run(command string, timeoutSeconds int) Result {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	output, err := cmd.CombinedOutput()

	trimmed := strings.TrimSpace(string(output))
	if len(trimmed) > 4000 {
		trimmed = trimmed[:4000] + "...(truncated)"
	}

	if ctx.Err() == context.DeadlineExceeded {
		return Result{Output: trimmed, Err: context.DeadlineExceeded}
	}
	return Result{Output: trimmed, Err: err}
}
