package com.flowforge.controlplane.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record TaskRunView(
        UUID id,
        String taskName,
        String status,
        List<String> dependsOn,
        String command,
        int attempt,
        int maxRetries,
        int timeoutSeconds,
        String workerId,
        String checkpointData,
        String errorMessage,
        Instant nextAttemptAt,
        Instant startedAt,
        Instant completedAt
) {}
