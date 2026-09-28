//go:build !unix

package executor

import "os/exec"

func configureProcessGroup(cmd *exec.Cmd) {}
