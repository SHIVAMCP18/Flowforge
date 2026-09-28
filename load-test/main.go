// FlowForge stress test: submits a fixed workflow definition, fires N
// concurrent runs at the control plane, then polls each run to completion
// and reports throughput and latency — the numbers behind the "validated
// throughput under production-like load" claim.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"time"
)

type taskSpec struct {
	Name           string   `json:"name"`
	DependsOn      []string `json:"dependsOn"`
	Command        string   `json:"command"`
	TimeoutSeconds int      `json:"timeoutSeconds"`
	MaxRetries     int      `json:"maxRetries"`
}

type definitionRequest struct {
	Name  string     `json:"name"`
	Tasks []taskSpec `json:"tasks"`
}

type definitionResponse struct {
	ID string `json:"id"`
}

type runResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func main() {
	baseURL := flag.String("url", "http://localhost:8080", "control plane base URL")
	runs := flag.Int("runs", 200, "number of workflow runs to submit")
	concurrency := flag.Int("concurrency", 50, "concurrent in-flight run submissions")
	pollTimeout := flag.Duration("poll-timeout", 2*time.Minute, "max time to wait for a run to finish")
	flag.Parse()

	client := &http.Client{Timeout: 10 * time.Second}

	defID, err := registerDefinition(client, *baseURL)
	if err != nil {
		fmt.Println("failed to register workflow definition:", err)
		return
	}
	fmt.Printf("registered definition %s\n", defID)

	latencies := make([]time.Duration, *runs)
	var succeeded, failed int
	var mu sync.Mutex

	sem := make(chan struct{}, *concurrency)
	var wg sync.WaitGroup

	start := time.Now()
	for i := 0; i < *runs; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()

			t0 := time.Now()
			status, err := submitAndWait(client, *baseURL, defID, *pollTimeout)
			elapsed := time.Since(t0)

			mu.Lock()
			latencies[idx] = elapsed
			if err == nil && status == "SUCCEEDED" {
				succeeded++
			} else {
				failed++
			}
			mu.Unlock()
		}(i)
	}
	wg.Wait()
	total := time.Since(start)

	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	p50 := latencies[len(latencies)*50/100]
	p95 := latencies[min(len(latencies)*95/100, len(latencies)-1)]
	p99 := latencies[min(len(latencies)*99/100, len(latencies)-1)]

	fmt.Println("\n--- FlowForge load test results ---")
	fmt.Printf("runs submitted:     %d\n", *runs)
	fmt.Printf("concurrency:        %d\n", *concurrency)
	fmt.Printf("succeeded:          %d\n", succeeded)
	fmt.Printf("failed/timed out:   %d\n", failed)
	fmt.Printf("total wall time:    %s\n", total)
	fmt.Printf("throughput:         %.2f runs/sec\n", float64(*runs)/total.Seconds())
	fmt.Printf("run latency p50:    %s\n", p50)
	fmt.Printf("run latency p95:    %s\n", p95)
	fmt.Printf("run latency p99:    %s\n", p99)
}

func registerDefinition(client *http.Client, baseURL string) (string, error) {
	req := definitionRequest{
		Name: fmt.Sprintf("loadtest-%d", time.Now().UnixNano()),
		Tasks: []taskSpec{
			{Name: "extract", Command: "echo extracting", TimeoutSeconds: 10, MaxRetries: 1},
			{Name: "transform", DependsOn: []string{"extract"}, Command: "echo transforming", TimeoutSeconds: 10, MaxRetries: 1},
			{Name: "load", DependsOn: []string{"transform"}, Command: "echo loading", TimeoutSeconds: 10, MaxRetries: 1},
		},
	}
	body, _ := json.Marshal(req)
	resp, err := client.Post(baseURL+"/api/workflows", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("status %s: %s", resp.Status, string(b))
	}
	var out definitionResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.ID, nil
}

func submitAndWait(client *http.Client, baseURL, defID string, timeout time.Duration) (string, error) {
	resp, err := client.Post(fmt.Sprintf("%s/api/workflows/%s/runs", baseURL, defID), "application/json", nil)
	if err != nil {
		return "", err
	}
	var run runResponse
	err = json.NewDecoder(resp.Body).Decode(&run)
	resp.Body.Close()
	if err != nil {
		return "", err
	}

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		r, err := client.Get(fmt.Sprintf("%s/api/workflows/runs/%s", baseURL, run.ID))
		if err != nil {
			return "", err
		}
		var polled runResponse
		decodeErr := json.NewDecoder(r.Body).Decode(&polled)
		r.Body.Close()
		if decodeErr != nil {
			return "", decodeErr
		}
		if polled.Status == "SUCCEEDED" || polled.Status == "FAILED" {
			return polled.Status, nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return "TIMEOUT", fmt.Errorf("run %s did not finish within %s", run.ID, timeout)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
