package com.flowforge.controlplane.dto;

import java.time.Instant;
import java.util.UUID;

public record TaskRunView(
        UUID id,
        String taskName,
        String status,
        int attempt,
        int maxRetries,
        String workerId,
        String errorMessage,
        Instant startedAt,
        Instant completedAt
) {}
