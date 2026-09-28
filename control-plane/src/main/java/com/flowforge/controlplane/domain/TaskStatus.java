package com.flowforge.controlplane.domain;

public enum TaskStatus {
    PENDING,   // waiting on upstream dependencies
    READY,     // dependencies satisfied, eligible to be leased by a worker
    RUNNING,   // leased by a worker, lease_expires_at governs timeout
    SUCCEEDED,
    FAILED,
    SKIPPED    // never ran because an upstream task in its chain failed
}
