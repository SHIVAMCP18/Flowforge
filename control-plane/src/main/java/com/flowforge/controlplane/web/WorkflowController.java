package com.flowforge.controlplane.web;

import com.flowforge.controlplane.dto.*;
import com.flowforge.controlplane.service.SchedulerService;
import com.flowforge.controlplane.service.WorkflowService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workflows")
public class WorkflowController {

    private final WorkflowService workflowService;
    private final SchedulerService schedulerService;

    public WorkflowController(WorkflowService workflowService, SchedulerService schedulerService) {
        this.workflowService = workflowService;
        this.schedulerService = schedulerService;
    }

    @GetMapping
    public List<WorkflowDefinitionView> listDefinitions() {
        return workflowService.listDefinitions();
    }

    @PostMapping
    public ResponseEntity<WorkflowDefinitionResponse> register(@Valid @RequestBody WorkflowDefinitionRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workflowService.registerDefinition(request));
    }

    @PostMapping("/validate")
    public DagValidationResponse validate(@Valid @RequestBody WorkflowDefinitionRequest request) {
        return workflowService.validate(request);
    }

    @GetMapping("/{definitionId}")
    public WorkflowDefinitionView getDefinition(@PathVariable UUID definitionId) {
        return workflowService.getDefinition(definitionId);
    }

    @PostMapping("/{definitionId}/runs")
    public ResponseEntity<WorkflowRunView> startRun(@PathVariable UUID definitionId) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workflowService.startRun(definitionId));
    }

    @GetMapping("/runs")
    public List<WorkflowRunSummary> listRuns(@RequestParam(required = false) String status,
                                             @RequestParam(required = false) UUID definitionId,
                                             @RequestParam(defaultValue = "50") int limit) {
        return workflowService.listRuns(status, definitionId, limit);
    }

    @GetMapping("/runs/{runId}")
    public WorkflowRunView getRun(@PathVariable UUID runId) {
        return workflowService.getRun(runId);
    }

    @PostMapping("/runs/{runId}/cancel")
    public WorkflowRunView cancelRun(@PathVariable UUID runId) {
        return schedulerService.cancelRun(runId);
    }

    @PostMapping("/runs/{runId}/retry")
    public WorkflowRunView retryRun(@PathVariable UUID runId) {
        return schedulerService.retryRun(runId);
    }
}
