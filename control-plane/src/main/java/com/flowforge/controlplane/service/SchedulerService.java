package com.flowforge.controlplane.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.controlplane.domain.TaskRun;
import com.flowforge.controlplane.domain.TaskStatus;
import com.flowforge.controlplane.domain.WorkflowRun;
import com.flowforge.controlplane.domain.WorkflowRunStatus;
import com.flowforge.controlplane.dto.*;
import com.flowforge.controlplane.exception.ConflictException;
import com.flowforge.controlplane.repository.TaskRunRepository;
import com.flowforge.controlplane.repository.WorkflowDefinitionRepository;
import com.flowforge.controlplane.repository.WorkflowRunRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

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

    private static final Logger log = LoggerFactory.getLogger(SchedulerService.class);
    private static final int REAP_BATCH_SIZE = 100;

    private final TaskRunRepository taskRunRepo;
    private final WorkflowRunRepository runRepo;
    private final WorkflowDefinitionRepository definitionRepo;
    private final ObjectMapper objectMapper;

    @Value("${flowforge.scheduler.retry-backoff-seconds}")
    private int retryBackoffSeconds;

    public SchedulerService(TaskRunRepository taskRunRepo,
                            WorkflowRunRepository runRepo,
                            WorkflowDefinitionRepository definitionRepo,
                            ObjectMapper objectMapper) {
        this.taskRunRepo = taskRunRepo;
        this.runRepo = runRepo;
        this.definitionRepo = definitionRepo;
        this.objectMapper = objectMapper;
    }

    /** Atomically claim one READY task for the given worker, or empty if there's no work. */
    @Transactional
    public Optional<TaskLeaseResponse> leaseTask(String workerId) {
        Optional<TaskRun> claimed = taskRunRepo.claimNextReadyTask(Instant.now());
        if (claimed.isEmpty()) return Optional.empty();

        TaskRun task = claimed.get();
        Instant now = Instant.now();
        task.setStatus(TaskStatus.RUNNING);
        task.setWorkerId(workerId);
        task.setAttempt(task.getAttempt() + 1);
        task.setStartedAt(now);
        task.setLeaseExpiresAt(now.plusSeconds(task.getTimeoutSeconds()));
        task.setUpdatedAt(now);
        taskRunRepo.save(task);

        Map<String, TaskRun> siblings = taskRunRepo.findByWorkflowRunId(task.getWorkflowRunId()).stream()
                .collect(Collectors.toMap(TaskRun::getTaskName, Function.identity()));
        Map<String, String> upstreamCheckpoints = new LinkedHashMap<>();
        for (String depName : readNames(task.getDependsOnJson())) {
            TaskRun dep = siblings.get(depName);
            if (dep != null) upstreamCheckpoints.put(depName, dep.getCheckpointData());
        }

        return Optional.of(new TaskLeaseResponse(
                task.getId(), task.getWorkflowRunId(), task.getTaskName(), task.getCommand(),
                task.getTimeoutSeconds(), task.getAttempt(), upstreamCheckpoints));
    }

    @Transactional
    public void completeTask(UUID taskRunId, String checkpointData) {
        TaskRun task = requireRunningTask(taskRunId, "complete");

        task.setStatus(TaskStatus.SUCCEEDED);
        task.setCheckpointData(checkpointData);
        task.setCompletedAt(Instant.now());
        task.setUpdatedAt(Instant.now());
        task.setLeaseExpiresAt(null);
        task.setErrorMessage(null);
        taskRunRepo.save(task);

        promoteReadyTasks(task.getWorkflowRunId());
        maybeFinalizeRun(task.getWorkflowRunId());
    }

    @Transactional
    public void failTask(UUID taskRunId, String errorMessage) {
        applyFailure(requireRunningTask(taskRunId, "fail"), errorMessage);
    }

    /**
     * Reclaims every lease that expired without a complete/fail callback.
     * Rows are locked with SKIP LOCKED, so control-plane replicas running the
     * reaper concurrently split the work instead of double-processing it.
     */
    @Transactional
    public int reapExpiredLeases() {
        List<TaskRun> expired = taskRunRepo.claimExpiredLeases(Instant.now(), REAP_BATCH_SIZE);
        for (TaskRun task : expired) {
            log.warn("Reclaiming expired lease: task={} run={} worker={}",
                    task.getTaskName(), task.getWorkflowRunId(), task.getWorkerId());
            applyFailure(task, "Task exceeded its " + task.getTimeoutSeconds() + "s timeout on worker " + task.getWorkerId());
        }
        return expired.size();
    }

    /** Stops a run: unfinished tasks are cancelled and late worker callbacks are rejected. */
    @Transactional
    public WorkflowRunView cancelRun(UUID runId) {
        WorkflowRun run = requireRun(runId);
        if (run.getStatus() != WorkflowRunStatus.RUNNING) {
            throw new ConflictException("Run " + runId + " is already " + run.getStatus());
        }
        Instant now = Instant.now();
        for (TaskRun t : taskRunRepo.findByWorkflowRunId(runId)) {
            if (t.getStatus().isTerminal()) continue;
            t.setStatus(TaskStatus.CANCELLED);
            t.setLeaseExpiresAt(null);
            t.setCompletedAt(now);
            t.setUpdatedAt(now);
            taskRunRepo.save(t);
        }
        run.setStatus(WorkflowRunStatus.CANCELLED);
        run.setCompletedAt(now);
        runRepo.save(run);
        return getRunView(runId);
    }

    /**
     * Resumes a failed or cancelled run from where it stopped. Succeeded tasks
     * keep their checkpoints and are not re-executed; everything else is reset
     * and re-scheduled as its dependencies allow.
     */
    @Transactional
    public WorkflowRunView retryRun(UUID runId) {
        WorkflowRun run = requireRun(runId);
        if (run.getStatus() == WorkflowRunStatus.RUNNING || run.getStatus() == WorkflowRunStatus.SUCCEEDED) {
            throw new ConflictException("Only FAILED or CANCELLED runs can be retried; run is " + run.getStatus());
        }
        Instant now = Instant.now();
        for (TaskRun t : taskRunRepo.findByWorkflowRunId(runId)) {
            if (t.getStatus() == TaskStatus.SUCCEEDED) continue;
            t.setStatus(TaskStatus.PENDING);
            t.setAttempt(0);
            t.setWorkerId(null);
            t.setLeaseExpiresAt(null);
            t.setNextAttemptAt(now);
            t.setCheckpointData(null);
            t.setErrorMessage(null);
            t.setStartedAt(null);
            t.setCompletedAt(null);
            t.setUpdatedAt(now);
            taskRunRepo.save(t);
        }
        run.setStatus(WorkflowRunStatus.RUNNING);
        run.setCompletedAt(null);
        runRepo.save(run);

        promoteReadyTasks(runId);
        return getRunView(runId);
    }

    private TaskRun requireRunningTask(UUID taskRunId, String action) {
        TaskRun task = taskRunRepo.findById(taskRunId)
                .orElseThrow(() -> new NoSuchElementException("Unknown task run: " + taskRunId));
        // A worker whose lease was reaped (or whose run was cancelled) may still
        // call back later. Accepting that would overwrite the newer attempt's state.
        if (task.getStatus() != TaskStatus.RUNNING) {
            throw new ConflictException("Cannot " + action + " task '" + task.getTaskName()
                    + "': it is " + task.getStatus() + ", not RUNNING (stale or reclaimed lease)");
        }
        return task;
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
            task.setLeaseExpiresAt(null);
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
        boolean allDone = all.stream().allMatch(t -> t.getStatus().isTerminal());
        if (!allDone) return;

        WorkflowRun run = requireRun(workflowRunId);
        if (run.getStatus() != WorkflowRunStatus.RUNNING) return;
        boolean anyFailed = all.stream().anyMatch(t -> t.getStatus() == TaskStatus.FAILED);
        run.setStatus(anyFailed ? WorkflowRunStatus.FAILED : WorkflowRunStatus.SUCCEEDED);
        run.setCompletedAt(Instant.now());
        runRepo.save(run);
    }

    private void failRun(UUID workflowRunId) {
        WorkflowRun run = requireRun(workflowRunId);
        if (run.getStatus() == WorkflowRunStatus.RUNNING) {
            run.setStatus(WorkflowRunStatus.FAILED);
            run.setCompletedAt(Instant.now());
            runRepo.save(run);
        }
    }

    private WorkflowRun requireRun(UUID runId) {
        return runRepo.findById(runId)
                .orElseThrow(() -> new NoSuchElementException("Unknown workflow run: " + runId));
    }

    public WorkflowRunView getRunView(UUID runId) {
        WorkflowRun run = requireRun(runId);
        var definition = definitionRepo.findById(run.getWorkflowDefinitionId());
        List<TaskRunView> tasks = taskRunRepo.findByWorkflowRunId(runId).stream()
                .map(t -> new TaskRunView(t.getId(), t.getTaskName(), t.getStatus().name(),
                        readNames(t.getDependsOnJson()), t.getCommand(), t.getAttempt(), t.getMaxRetries(),
                        t.getTimeoutSeconds(), t.getWorkerId(), t.getCheckpointData(), t.getErrorMessage(),
                        t.getNextAttemptAt(), t.getStartedAt(), t.getCompletedAt()))
                .toList();
        return new WorkflowRunView(run.getId(), run.getWorkflowDefinitionId(),
                definition.map(d -> d.getName()).orElse(null),
                definition.map(d -> d.getVersion()).orElse(0),
                run.getStatus().name(), run.getStartedAt(), run.getCompletedAt(), tasks);
    }

    private List<String> readNames(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (JsonProcessingException e) {
            return List.of();
        }
    }
}
