package config

import (
	"os"
	"strconv"
)

// Config is entirely env-driven so the same image runs unmodified in
// docker-compose and in a Kubernetes Deployment, with pool size tuned per
// environment via ConfigMap/env vars rather than a rebuild.
type Config struct {
	ControlPlaneURL string
	WorkerID        string
	PoolSize        int
	PollIntervalMs  int
}

func Load() Config {
	return Config{
		ControlPlaneURL: getEnv("CONTROL_PLANE_URL", "http://localhost:8080"),
		WorkerID:        getEnv("WORKER_ID", hostnameOrRandom()),
		PoolSize:        getEnvInt("POOL_SIZE", 4),
		PollIntervalMs:  getEnvInt("POLL_INTERVAL_MS", 500),
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func hostnameOrRandom() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "worker-unknown"
	}
	return h
}
