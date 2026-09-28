package com.flowforge.controlplane.web;

import com.flowforge.controlplane.dto.TaskCompletionRequest;
import com.flowforge.controlplane.dto.TaskFailureRequest;
import com.flowforge.controlplane.dto.TaskLeaseResponse;
import com.flowforge.controlplane.service.SchedulerService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Optional;
import java.util.UUID;

/** The worker-facing surface: lease work, report completion or failure. */
@RestController
@RequestMapping("/api")
public class TaskController {

    private final SchedulerService schedulerService;

    public TaskController(SchedulerService schedulerService) {
        this.schedulerService = schedulerService;
    }

    @PostMapping("/workers/{workerId}/lease")
    public ResponseEntity<TaskLeaseResponse> lease(@PathVariable String workerId) {
        Optional<TaskLeaseResponse> task = schedulerService.leaseTask(workerId);
        return task.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/tasks/{taskRunId}/complete")
    public ResponseEntity<Void> complete(@PathVariable UUID taskRunId, @RequestBody(required = false) TaskCompletionRequest body) {
        String checkpoint = body != null ? body.getCheckpointData() : null;
        schedulerService.completeTask(taskRunId, checkpoint);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/tasks/{taskRunId}/fail")
    public ResponseEntity<Void> fail(@PathVariable UUID taskRunId, @RequestBody(required = false) TaskFailureRequest body) {
        String error = body != null ? body.getErrorMessage() : "unspecified error";
        schedulerService.failTask(taskRunId, error);
        return ResponseEntity.ok().build();
    }
}
