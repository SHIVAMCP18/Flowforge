package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// TaskLease mirrors control-plane's TaskLeaseResponse DTO.
type TaskLease struct {
	TaskRunID          string            `json:"taskRunId"`
	WorkflowRunID      string            `json:"workflowRunId"`
	TaskName           string            `json:"taskName"`
	Command            string            `json:"command"`
	TimeoutSeconds     int               `json:"timeoutSeconds"`
	Attempt            int               `json:"attempt"`
	UpstreamCheckpoints map[string]string `json:"upstreamCheckpoints"`
}

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
	payload, _ := json.Marshal(map[string]string{"checkpointData": checkpointData})
	url := fmt.Sprintf("%s/api/tasks/%s/complete", c.BaseURL, taskRunID)
	resp, err := c.HTTP.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("complete callback failed: %s: %s", resp.Status, string(body))
	}
	return nil
}

func (c *ControlPlaneClient) FailTask(taskRunID, errorMessage string) error {
	payload, _ := json.Marshal(map[string]string{"errorMessage": errorMessage})
	url := fmt.Sprintf("%s/api/tasks/%s/fail", c.BaseURL, taskRunID)
	resp, err := c.HTTP.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fail callback failed: %s: %s", resp.Status, string(body))
	}
	return nil
}
