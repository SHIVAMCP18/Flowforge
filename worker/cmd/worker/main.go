package main

import (
	"context"
	"log"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/flowforge/worker/internal/client"
	"github.com/flowforge/worker/internal/config"
	"github.com/flowforge/worker/internal/executor"
)

func main() {
	cfg := config.Load()
	cp := client.New(cfg.ControlPlaneURL)

	log.Printf("flowforge-worker starting: id=%s pool_size=%d control_plane=%s",
		cfg.WorkerID, cfg.PoolSize, cfg.ControlPlaneURL)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var wg sync.WaitGroup
	for i := 0; i < cfg.PoolSize; i++ {
		wg.Add(1)
		// Each goroutine is an independent lease-execute-report loop. This is
		// the "autoscaling worker pool" at the process level; the deployment
		// scales the same loop horizontally across pods via the K8s HPA.
		go func(slot int) {
			defer wg.Done()
			runLoop(ctx, cp, cfg, slot)
		}(i)
	}

	wg.Wait()
	log.Println("flowforge-worker shut down cleanly")
}

func runLoop(ctx context.Context, cp *client.ControlPlaneClient, cfg config.Config, slot int) {
	pollInterval := time.Duration(cfg.PollIntervalMs) * time.Millisecond
	workerID := cfg.WorkerID
	if cfg.PoolSize > 1 {
		workerID = cfg.WorkerID + "-" + itoa(slot)
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		lease, err := cp.LeaseTask(workerID)
		if err != nil {
			log.Printf("[%s] lease error: %v", workerID, err)
			sleep(ctx, pollInterval)
			continue
		}
		if lease == nil {
			sleep(ctx, pollInterval)
			continue
		}

		log.Printf("[%s] leased task=%s attempt=%d timeout=%ds", workerID, lease.TaskName, lease.Attempt, lease.TimeoutSeconds)
		result := executor.Run(lease.Command, lease.TimeoutSeconds)

		if result.Err != nil {
			msg := result.Err.Error()
			if result.Output != "" {
				msg = msg + ": " + result.Output
			}
			if err := cp.FailTask(lease.TaskRunID, msg); err != nil {
				log.Printf("[%s] failed to report failure: %v", workerID, err)
			}
			log.Printf("[%s] task=%s failed: %v", workerID, lease.TaskName, result.Err)
			continue
		}

		if err := cp.CompleteTask(lease.TaskRunID, result.Output); err != nil {
			log.Printf("[%s] failed to report completion: %v", workerID, err)
			continue
		}
		log.Printf("[%s] task=%s succeeded", workerID, lease.TaskName)
	}
}

func sleep(ctx context.Context, d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := []byte{}
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if neg {
		return "-" + string(digits)
	}
	return string(digits)
}
