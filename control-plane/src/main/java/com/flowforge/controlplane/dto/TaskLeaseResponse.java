package com.flowforge.controlplane.dto;

import java.util.Map;
import java.util.UUID;

/** Handed to a worker when it successfully leases a READY task. */
public record TaskLeaseResponse(
        UUID taskRunId,
        UUID workflowRunId,
        String taskName,
        String command,
        int timeoutSeconds,
        int attempt,
        Map<String, String> upstreamCheckpoints
) {}
