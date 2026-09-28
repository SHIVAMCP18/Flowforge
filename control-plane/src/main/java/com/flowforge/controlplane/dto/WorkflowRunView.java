package com.flowforge.controlplane.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record WorkflowRunView(
        UUID id,
        UUID workflowDefinitionId,
        String status,
        Instant startedAt,
        Instant completedAt,
        List<TaskRunView> tasks
) {}
