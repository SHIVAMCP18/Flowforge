package com.flowforge.controlplane.web;

import com.flowforge.controlplane.dto.*;
import com.flowforge.controlplane.service.WorkflowService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/workflows")
public class WorkflowController {

    private final WorkflowService workflowService;

    public WorkflowController(WorkflowService workflowService) {
        this.workflowService = workflowService;
    }

    @PostMapping
    public ResponseEntity<WorkflowDefinitionResponse> register(@Valid @RequestBody WorkflowDefinitionRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workflowService.registerDefinition(request));
    }

    @PostMapping("/{definitionId}/runs")
    public ResponseEntity<WorkflowRunView> startRun(@PathVariable UUID definitionId) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workflowService.startRun(definitionId));
    }

    @GetMapping("/runs/{runId}")
    public WorkflowRunView getRun(@PathVariable UUID runId) {
        return workflowService.getRun(runId);
    }
}
