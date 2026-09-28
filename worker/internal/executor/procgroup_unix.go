//go:build unix

package executor

import (
	"os/exec"
	"syscall"
)

// configureProcessGroup runs the command in its own process group and makes
// cancellation kill the entire group, not just the top-level shell.
func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
