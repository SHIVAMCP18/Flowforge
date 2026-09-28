package client

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// TaskLease mirrors control-plane's TaskLeaseResponse DTO.
type TaskLease struct {
	TaskRunID           string            `json:"taskRunId"`
	WorkflowRunID       string            `json:"workflowRunId"`
	TaskName            string            `json:"taskName"`
	Command             string            `json:"command"`
	TimeoutSeconds      int               `json:"timeoutSeconds"`
	Attempt             int               `json:"attempt"`
	UpstreamCheckpoints map[string]string `json:"upstreamCheckpoints"`
}

// ErrLeaseLost means the control plane no longer considers this worker the
// owner of the task (the lease expired and was reclaimed, or the run was
// cancelled). The result is discarded; there is nothing to retry.
var ErrLeaseLost = errors.New("lease no longer held")

type ControlPlaneClient struct {
	BaseURL string
	HTTP    *http.Client
}

func New(baseURL string) *ControlPlaneClient {
	return &ControlPlaneClient{
		BaseURL: baseURL,
		HTTP:    &http.Client{Timeout: 10 * time.Second},
	}
}

// LeaseTask asks the control plane for one unit of work. A 204 means there's
// currently nothing READY to run, which is a normal, frequent outcome — not
// an error — so the caller just backs off and polls again.
func (c *ControlPlaneClient) LeaseTask(workerID string) (*TaskLease, error) {
	url := fmt.Sprintf("%s/api/workers/%s/lease", c.BaseURL, workerID)
	resp, err := c.HTTP.Post(url, "application/json", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("lease request failed: %s: %s", resp.Status, string(body))
	}

	var lease TaskLease
	if err := json.NewDecoder(resp.Body).Decode(&lease); err != nil {
		return nil, err
	}
	return &lease, nil
}

func (c *ControlPlaneClient) CompleteTask(taskRunID, checkpointData string) error {
	return c.report(taskRunID, "complete", map[string]string{"checkpointData": checkpointData})
}

func (c *ControlPlaneClient) FailTask(taskRunID, errorMessage string) error {
	return c.report(taskRunID, "fail", map[string]string{"errorMessage": errorMessage})
}

func (c *ControlPlaneClient) report(taskRunID, action string, body map[string]string) error {
	payload, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/api/tasks/%s/%s", c.BaseURL, taskRunID, action)
	resp, err := c.HTTP.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusConflict {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%w: %s", ErrLeaseLost, string(msg))
	}
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s callback failed: %s: %s", action, resp.Status, string(msg))
	}
	return nil
}
