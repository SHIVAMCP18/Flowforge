package com.flowforge.controlplane.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record WorkflowDefinitionView(
        UUID id,
        String name,
        int version,
        Instant createdAt,
        List<TaskSpec> tasks
) {}
