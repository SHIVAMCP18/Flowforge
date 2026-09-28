package com.flowforge.controlplane.dto;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** Lightweight row for run listings: no per-task payloads, just status counts. */
public record WorkflowRunSummary(
        UUID id,
        UUID workflowDefinitionId,
        String workflowName,
        int workflowVersion,
        String status,
        Instant startedAt,
        Instant completedAt,
        int totalTasks,
        Map<String, Long> taskCounts
) {}
