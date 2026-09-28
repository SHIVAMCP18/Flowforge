package com.flowforge.controlplane.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.controlplane.domain.TaskRun;
import com.flowforge.controlplane.domain.TaskStatus;
import com.flowforge.controlplane.domain.WorkflowRun;
import com.flowforge.controlplane.domain.WorkflowRunStatus;
import com.flowforge.controlplane.dto.*;
import com.flowforge.controlplane.repository.TaskRunRepository;
import com.flowforge.controlplane.repository.WorkflowRunRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

/**
 * Owns every state transition in the task_runs / workflow_runs tables. This
 * is the "custom scheduler": task readiness, leasing, retries with backoff,
 * timeout handling, and cascade failure all live here. Because every
 * transition is a single transactional write against Postgres, a crashed
 * control-plane instance loses no state — any instance (or a fresh one) can
 * resume by re-reading these tables, and the reaper reclaims any lease that
 * a dead worker never released.
 */
@Service
public class SchedulerService {

    private final TaskRunRepository taskRunRepo;
    private final WorkflowRunRepository runRepo;
    private final ObjectMapper objectMapper;

    @Value("${flowforge.scheduler.retry-backoff-seconds}")
    private int retryBackoffSeconds;

    public SchedulerService(TaskRunRepository taskRunRepo, WorkflowRunRepository runRepo, ObjectMapper objectMapper) {
        this.taskRunRepo = taskRunRepo;
        this.runRepo = runRepo;
        this.objectMapper = objectMapper;
    }

    /** Atomically claim one READY task for the given worker, or empty if there's no work. */
    @Transactional
    public Optional<TaskLeaseResponse> leaseTask(String workerId) {
        Optional<TaskRun> claimed = taskRunRepo.claimNextReadyTask(Instant.now());
        if (claimed.isEmpty()) return Optional.empty();

        TaskRun task = claimed.get();
        task.setStatus(TaskStatus.RUNNING);
        task.setWorkerId(workerId);
        task.setAttempt(task.getAttempt() + 1);
        task.setStartedAt(Instant.now());
        task.setLeaseExpiresAt(Instant.now().plusSeconds(task.getTimeoutSeconds()));
        task.setUpdatedAt(Instant.now());
        taskRunRepo.save(task);

        Map<String, String> upstreamCheckpoints = new HashMap<>();
        for (String depName : readNames(task.getDependsOnJson())) {
            taskRunRepo.findByWorkflowRunId(task.getWorkflowRunId()).stream()
                    .filter(t -> t.getTaskName().equals(depName))
                    .findFirst()
                    .ifPresent(dep -> upstreamCheckpoints.put(depName, dep.getCheckpointData()));
        }

        return Optional.of(new TaskLeaseResponse(
                task.getId(), task.getWorkflowRunId(), task.getTaskName(), task.getCommand(),
                task.getTimeoutSeconds(), task.getAttempt(), upstreamCheckpoints));
    }

    @Transactional
    public void completeTask(UUID taskRunId, String checkpointData) {
        TaskRun task = taskRunRepo.findById(taskRunId)
                .orElseThrow(() -> new NoSuchElementException("Unknown task run: " + taskRunId));

        task.setStatus(TaskStatus.SUCCEEDED);
        task.setCheckpointData(checkpointData);
        task.setCompletedAt(Instant.now());
        task.setUpdatedAt(Instant.now());
        task.setErrorMessage(null);
        taskRunRepo.save(task);

        promoteReadyTasks(task.getWorkflowRunId());
        maybeFinalizeRun(task.getWorkflowRunId());
    }

    @Transactional
    public void failTask(UUID taskRunId, String errorMessage) {
        TaskRun task = taskRunRepo.findById(taskRunId)
                .orElseThrow(() -> new NoSuchElementException("Unknown task run: " + taskRunId));
        applyFailure(task, errorMessage);
    }

    /** Called by the reaper for tasks whose lease expired without a complete/fail callback. */
    @Transactional
    public void reclaimExpiredLease(TaskRun task) {
        applyFailure(task, "Task exceeded its " + task.getTimeoutSeconds() + "s timeout on worker " + task.getWorkerId());
    }

    private void applyFailure(TaskRun task, String errorMessage) {
        task.setErrorMessage(errorMessage);
        task.setUpdatedAt(Instant.now());

        if (task.getAttempt() < task.getMaxRetries()) {
            // Retry with linear backoff. A real system might use exponential
            // backoff + jitter here; linear keeps the demo/load-test predictable.
            long backoff = (long) retryBackoffSeconds * task.getAttempt();
            task.setStatus(TaskStatus.READY);
            task.setWorkerId(null);
            task.setLeaseExpiresAt(null);
            task.setNextAttemptAt(Instant.now().plusSeconds(backoff));
            taskRunRepo.save(task);
        } else {
            task.setStatus(TaskStatus.FAILED);
            task.setCompletedAt(Instant.now());
            taskRunRepo.save(task);
            cascadeSkip(task.getWorkflowRunId());
            failRun(task.getWorkflowRunId());
        }
    }

    /** Promote any PENDING task whose upstream dependencies have all SUCCEEDED. */
    private void promoteReadyTasks(UUID workflowRunId) {
        List<TaskRun> all = taskRunRepo.findByWorkflowRunId(workflowRunId);
        Map<String, TaskStatus> statusByName = new HashMap<>();
        for (TaskRun t : all) statusByName.put(t.getTaskName(), t.getStatus());

        for (TaskRun t : all) {
            if (t.getStatus() != TaskStatus.PENDING) continue;
            List<String> deps = readNames(t.getDependsOnJson());
            boolean allSucceeded = deps.stream().allMatch(d -> statusByName.get(d) == TaskStatus.SUCCEEDED);
            if (allSucceeded) {
                t.setStatus(TaskStatus.READY);
                t.setUpdatedAt(Instant.now());
                taskRunRepo.save(t);
            }
        }
    }

    /** Once a task FAILs permanently, anything still PENDING/READY downstream can never run. */
    private void cascadeSkip(UUID workflowRunId) {
        List<TaskRun> all = taskRunRepo.findByWorkflowRunId(workflowRunId);
        for (TaskRun t : all) {
            if (t.getStatus() == TaskStatus.PENDING || t.getStatus() == TaskStatus.READY) {
                t.setStatus(TaskStatus.SKIPPED);
                t.setUpdatedAt(Instant.now());
                taskRunRepo.save(t);
            }
        }
    }

    private void maybeFinalizeRun(UUID workflowRunId) {
        List<TaskRun> all = taskRunRepo.findByWorkflowRunId(workflowRunId);
        boolean allDone = all.stream().allMatch(t ->
                t.getStatus() == TaskStatus.SUCCEEDED || t.getStatus() == TaskStatus.SKIPPED || t.getStatus() == TaskStatus.FAILED);
        if (!allDone) return;

        boolean anyFailed = all.stream().anyMatch(t -> t.getStatus() == TaskStatus.FAILED);
        WorkflowRun run = runRepo.findById(workflowRunId).orElseThrow();
        run.setStatus(anyFailed ? WorkflowRunStatus.FAILED : WorkflowRunStatus.SUCCEEDED);
        run.setCompletedAt(Instant.now());
        runRepo.save(run);
    }

    private void failRun(UUID workflowRunId) {
        WorkflowRun run = runRepo.findById(workflowRunId).orElseThrow();
        if (run.getStatus() == WorkflowRunStatus.RUNNING) {
            run.setStatus(WorkflowRunStatus.FAILED);
            run.setCompletedAt(Instant.now());
            runRepo.save(run);
        }
    }

    public WorkflowRunView getRunView(UUID runId) {
        WorkflowRun run = runRepo.findById(runId)
                .orElseThrow(() -> new NoSuchElementException("Unknown workflow run: " + runId));
        List<TaskRunView> tasks = taskRunRepo.findByWorkflowRunId(runId).stream()
                .map(t -> new TaskRunView(t.getId(), t.getTaskName(), t.getStatus().name(), t.getAttempt(),
                        t.getMaxRetries(), t.getWorkerId(), t.getErrorMessage(), t.getStartedAt(), t.getCompletedAt()))
                .toList();
        return new WorkflowRunView(run.getId(), run.getWorkflowDefinitionId(), run.getStatus().name(),
                run.getStartedAt(), run.getCompletedAt(), tasks);
    }

    private List<String> readNames(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (JsonProcessingException e) {
            return List.of();
        }
    }
}
