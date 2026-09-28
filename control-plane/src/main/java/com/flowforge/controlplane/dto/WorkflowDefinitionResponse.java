package com.flowforge.controlplane.dto;

import java.util.UUID;

public record WorkflowDefinitionResponse(UUID id, String name, int version) {}
