package main

import (
	"context"
	"errors"
	"log"
	"os/signal"
	"strconv"
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
		workerID = cfg.WorkerID + "-" + strconv.Itoa(slot)
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
		result := executor.Run(lease.Command, lease.TimeoutSeconds, executor.Context{
			WorkflowRunID:       lease.WorkflowRunID,
			TaskRunID:           lease.TaskRunID,
			TaskName:            lease.TaskName,
			WorkerID:            workerID,
			Attempt:             lease.Attempt,
			UpstreamCheckpoints: lease.UpstreamCheckpoints,
		})

		if result.Err != nil {
			msg := result.Err.Error()
			if result.Output != "" {
				msg = msg + ": " + result.Output
			}
			if err := cp.FailTask(lease.TaskRunID, msg); err != nil {
				logCallbackError(workerID, lease.TaskName, "failure", err)
			}
			log.Printf("[%s] task=%s failed after %s: %v", workerID, lease.TaskName, result.Duration.Round(time.Millisecond), result.Err)
			continue
		}

		if err := cp.CompleteTask(lease.TaskRunID, result.Output); err != nil {
			logCallbackError(workerID, lease.TaskName, "completion", err)
			continue
		}
		log.Printf("[%s] task=%s succeeded in %s", workerID, lease.TaskName, result.Duration.Round(time.Millisecond))
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

func logCallbackError(workerID, taskName, kind string, err error) {
	if errors.Is(err, client.ErrLeaseLost) {
		log.Printf("[%s] task=%s %s discarded: lease was reclaimed or run cancelled", workerID, taskName, kind)
		return
	}
	log.Printf("[%s] task=%s failed to report %s: %v", workerID, taskName, kind, err)
}
